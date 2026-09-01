"""FastAPI boundary for submitting batches and streaming their results."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
import gzip
import json
import os
from pathlib import Path
import shutil
from tempfile import TemporaryDirectory
from typing import Annotated, Any
from uuid import UUID, uuid4

from secrets import compare_digest

from fastapi import (
    Depends,
    FastAPI,
    File,
    Form,
    Header,
    HTTPException,
    Request,
    UploadFile,
    status,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from athena.hosted.config import HostedSettings
from athena.hosted.database import BatchEvent, BatchRepository
from athena.hosted.queue import SimulationQueue
from athena.hosted.storage import BucketStorage
from athena.loaders.terrain_payload import (
    PayloadError,
    import_diagnostics,
    load_payload,
)


@dataclass
class HostedRuntime:
    repository: Any
    queue: Any
    storage: Any


class SubmitBatchResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    batch_id: UUID = Field(alias="batchId")
    simulation_count: int = Field(alias="simulationCount")
    events_url: str = Field(alias="eventsUrl")
    # Ground problems worth knowing before the batch runs, not after. Absent on
    # the planId path, which never parses a payload here.
    diagnostics: dict[str, int] | None = None


def _copy_upload(upload: UploadFile, destination: Path) -> None:
    upload.file.seek(0)
    with destination.open("wb") as output:
        shutil.copyfileobj(upload.file, output)


def _prepare_payload(
    upload_path: Path,
    validation_path: Path,
) -> tuple[bool, dict[str, int]]:
    with upload_path.open("rb") as source:
        compressed = source.read(2) == b"\x1f\x8b"
    if compressed:
        with gzip.open(upload_path, "rb") as source, validation_path.open("wb") as output:
            shutil.copyfileobj(source, output)
    else:
        shutil.copyfile(upload_path, validation_path)
    return compressed, import_diagnostics(load_payload(validation_path))


def _require_token(expected: str | None) -> Any:
    """Guard for /v1 routes: a bearer token matching the shared secret.

    The engine has no user model -- the only caller is the terrain service, so
    this is service-to-service auth, not a login. `expected` is None only when
    settings are injected without a token (tests, local runs); from_env()
    requires one, so a deployed API is always closed.
    """

    async def check(authorization: Annotated[str | None, Header()] = None) -> None:
        if expected is None:
            return
        scheme, _, presented = (authorization or "").partition(" ")
        if scheme.lower() != "bearer" or not compare_digest(presented, expected):
            # 401 rather than 403: the caller may retry with a correct token.
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="invalid or missing bearer token",
                headers={"WWW-Authenticate": "Bearer"},
            )

    return check


async def _enqueue_all(
    hosted: HostedRuntime,
    batch_id: UUID,
    simulation_ids: list[UUID],
) -> None:
    """Queue every simulation, failing the whole batch if the queue is down."""
    try:
        for simulation_id in simulation_ids:
            await hosted.queue.enqueue(simulation_id)
    except Exception as exc:
        await hosted.repository.fail_batch_enqueue(batch_id, str(exc))
        raise HTTPException(
            status_code=503, detail="simulation queue unavailable"
        ) from exc


def _sse(event: BatchEvent, storage: Any) -> str:
    data = dict(event.data)
    replay_key = data.pop("replayKey", None)
    if replay_key is not None:
        data["replayUrl"] = storage.presigned_get_url(replay_key)
    return (
        f"id: {event.id}\n"
        f"event: {event.event_type}\n"
        f"data: {json.dumps(data, separators=(',', ':'))}\n\n"
    )


def create_app(
    *,
    runtime: HostedRuntime | None = None,
    settings: HostedSettings | None = None,
) -> FastAPI:
    external_runtime = runtime

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        if external_runtime is not None:
            app.state.runtime = external_runtime
            yield
            return

        effective_settings = settings or HostedSettings.from_env()
        repository = await BatchRepository.connect(effective_settings.database_url)
        queue = await SimulationQueue.connect(effective_settings.redis_url)
        app.state.runtime = HostedRuntime(
            repository=repository,
            queue=queue,
            storage=BucketStorage(effective_settings),
        )
        try:
            yield
        finally:
            await queue.close()
            await repository.close()

    app = FastAPI(title="Athena Engine API", version="1.0.0", lifespan=lifespan)
    configured_origins = (
        settings.allowed_origins
        if settings is not None
        else tuple(
            origin.strip()
            for origin in os.getenv("ALLOWED_ORIGINS", "").split(",")
            if origin.strip()
        )
    )
    if configured_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=list(configured_origins),
            allow_methods=["GET", "POST"],
            allow_headers=["Authorization", "Content-Type", "Last-Event-ID"],
        )

    configured_token = (
        settings.api_token
        if settings is not None
        else (os.getenv("API_TOKEN") or "").strip() or None
    )
    authenticated = [Depends(_require_token(configured_token))]

    configured_terrain_service = (
        settings.terrain_service_url
        if settings is not None
        else (os.getenv("TERRAIN_SERVICE_URL") or "").strip() or None
    )

    @app.get("/healthz", include_in_schema=False)
    async def health() -> dict[str, bool]:
        return {"ok": True}

    @app.post(
        "/v1/simulation-batches",
        response_model=SubmitBatchResponse,
        status_code=status.HTTP_202_ACCEPTED,
        dependencies=authenticated,
    )
    async def submit_batch(
        request: Request,
        simulation_count: Annotated[int, Form(alias="simulationCount", gt=0)],
        payload: Annotated[UploadFile | None, File()] = None,
        plan_id: Annotated[str | None, Form(alias="planId")] = None,
        ticks: Annotated[int, Form(gt=0)] = 60,
        model: Annotated[str | None, Form()] = None,
    ) -> SubmitBatchResponse:
        hosted: HostedRuntime = request.app.state.runtime
        batch_id = uuid4()
        simulation_ids = [uuid4() for _ in range(simulation_count)]
        if model is not None:
            model = model.strip() or None
        plan_id = (plan_id or "").strip() or None

        # A batch names its scenario exactly one way.
        if (payload is None) == (plan_id is None):
            raise HTTPException(
                status_code=422,
                detail="provide exactly one of payload or planId",
            )

        if plan_id is not None:
            if configured_terrain_service is None:
                raise HTTPException(
                    status_code=503,
                    detail="planId submissions need TERRAIN_SERVICE_URL configured",
                )
            await hosted.repository.create_batch(
                batch_id=batch_id,
                simulation_ids=simulation_ids,
                ticks=ticks,
                model=model,
                plan_id=plan_id,
            )
            await _enqueue_all(hosted, batch_id, simulation_ids)
            return SubmitBatchResponse(
                batch_id=batch_id,
                simulation_count=simulation_count,
                events_url=f"/v1/simulation-batches/{batch_id}/events",
            )

        try:
            with TemporaryDirectory(prefix="athena-upload-") as directory:
                directory_path = Path(directory)
                upload_path = directory_path / "payload.upload"
                validation_path = directory_path / "payload.json"
                await asyncio.to_thread(_copy_upload, payload, upload_path)
                compressed, diagnostics = await asyncio.to_thread(
                    _prepare_payload,
                    upload_path,
                    validation_path,
                )
                suffix = ".json.gz" if compressed else ".json"
                payload_key = f"payloads/{batch_id}/payload{suffix}"
                await hosted.storage.upload_file(
                    upload_path,
                    payload_key,
                    content_type="application/json",
                    content_encoding="gzip" if compressed else None,
                )
        except (
            PayloadError,
            ValidationError,
            ValueError,
            json.JSONDecodeError,
            gzip.BadGzipFile,
            UnicodeDecodeError,
        ) as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

        await hosted.repository.create_batch(
            batch_id=batch_id,
            simulation_ids=simulation_ids,
            ticks=ticks,
            model=model,
            payload_key=payload_key,
        )
        await _enqueue_all(hosted, batch_id, simulation_ids)

        return SubmitBatchResponse(
            batch_id=batch_id,
            simulation_count=simulation_count,
            events_url=f"/v1/simulation-batches/{batch_id}/events",
            diagnostics=diagnostics,
        )

    @app.post("/v1/payload-diagnostics", dependencies=authenticated)
    async def payload_diagnostics(
        payload: Annotated[UploadFile, File()],
    ) -> dict[str, Any]:
        """Check a scenario without queueing anything.

        The same checks the submit path runs, available before committing to a
        batch. An objective on the far side of a river with no crossing is not a
        hard plan but an impossible one, and finding that out from an
        "inconclusive" result after a full tick budget is the worst possible way
        to learn it.
        """
        try:
            with TemporaryDirectory(prefix="athena-check-") as directory:
                directory_path = Path(directory)
                upload_path = directory_path / "payload.upload"
                validation_path = directory_path / "payload.json"
                await asyncio.to_thread(_copy_upload, payload, upload_path)
                _, diagnostics = await asyncio.to_thread(
                    _prepare_payload, upload_path, validation_path
                )
        except (
            PayloadError,
            ValidationError,
            ValueError,
            json.JSONDecodeError,
            gzip.BadGzipFile,
            UnicodeDecodeError,
        ) as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc

        return diagnostics

    @app.get("/v1/simulation-batches", dependencies=authenticated)
    async def list_batches(
        request: Request,
        limit: int = 25,
        offset: int = 0,
    ) -> dict[str, Any]:
        """Recent batches, newest first.

        The event stream is consumed once; this is how a batch is read back
        afterwards. Everything here is a read over tables the queue already
        maintains.
        """
        hosted: HostedRuntime = request.app.state.runtime
        rows = await hosted.repository.list_batches(max(1, min(limit, 100)), max(0, offset))
        return {
            "batches": [
                {
                    "batchId": str(row["id"]),
                    "simulationCount": row["simulation_count"],
                    "ticks": row["ticks"],
                    "model": row["model"],
                    "planId": row["plan_id"],
                    "status": row["status"],
                    "completed": row["completed"],
                    "failed": row["failed"],
                    "createdAt": row["created_at"].isoformat(),
                    "completedAt": (
                        row["completed_at"].isoformat() if row["completed_at"] else None
                    ),
                }
                for row in rows
            ]
        }

    @app.get("/v1/simulation-batches/{batch_id}", dependencies=authenticated)
    async def batch_detail(batch_id: UUID, request: Request) -> dict[str, Any]:
        """One batch with every run's stored outcome and a fresh replay URL.

        Replay URLs are presigned at read time rather than stored, because a
        stored one expires while the batch it describes does not.
        """
        hosted: HostedRuntime = request.app.state.runtime
        detail = await hosted.repository.batch_detail(batch_id)
        if detail is None:
            raise HTTPException(status_code=404, detail="unknown simulation batch")

        batch = detail["batch"]
        return {
            "batchId": str(batch["id"]),
            "simulationCount": batch["simulation_count"],
            "ticks": batch["ticks"],
            "model": batch["model"],
            "planId": batch["plan_id"],
            "status": batch["status"],
            "createdAt": batch["created_at"].isoformat(),
            "completedAt": (
                batch["completed_at"].isoformat() if batch["completed_at"] else None
            ),
            "runs": [
                {
                    "simulationId": str(run["id"]),
                    "simulationIndex": run["simulation_index"],
                    "status": run["status"],
                    "outcome": run["outcome"],
                    "error": run["error"],
                    "replayUrl": (
                        hosted.storage.presigned_get_url(run["replay_key"])
                        if run["replay_key"]
                        else None
                    ),
                }
                for run in detail["runs"]
            ],
        }

    @app.get("/v1/simulation-batches/{batch_id}/events", dependencies=authenticated)
    async def batch_events(batch_id: UUID, request: Request) -> StreamingResponse:
        hosted: HostedRuntime = request.app.state.runtime
        if await hosted.repository.batch_status(batch_id) is None:
            raise HTTPException(status_code=404, detail="unknown simulation batch")
        try:
            cursor = int(request.headers.get("last-event-id", "0"))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="invalid Last-Event-ID") from exc

        async def stream() -> AsyncIterator[str]:
            nonlocal cursor
            idle_polls = 0
            while True:
                if await request.is_disconnected():
                    return
                events = await hosted.repository.events_after(batch_id, cursor)
                for event in events:
                    cursor = event.id
                    yield _sse(event, hosted.storage)
                    if event.event_type == "batch.completed":
                        return
                if events:
                    idle_polls = 0
                else:
                    idle_polls += 1
                    if idle_polls % 15 == 0:
                        yield ": keep-alive\n\n"
                await asyncio.sleep(1)

        return StreamingResponse(
            stream(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    return app


app = create_app()
