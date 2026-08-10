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

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from athena.hosted.config import HostedSettings
from athena.hosted.database import BatchEvent, BatchRepository
from athena.hosted.queue import SimulationQueue
from athena.hosted.storage import BucketStorage
from athena.loaders.terrain_payload import PayloadError, load_payload


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


def _copy_upload(upload: UploadFile, destination: Path) -> None:
    upload.file.seek(0)
    with destination.open("wb") as output:
        shutil.copyfileobj(upload.file, output)


def _prepare_payload(upload_path: Path, validation_path: Path) -> bool:
    with upload_path.open("rb") as source:
        compressed = source.read(2) == b"\x1f\x8b"
    if compressed:
        with gzip.open(upload_path, "rb") as source, validation_path.open("wb") as output:
            shutil.copyfileobj(source, output)
    else:
        shutil.copyfile(upload_path, validation_path)
    load_payload(validation_path)
    return compressed


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
            allow_headers=["Content-Type", "Last-Event-ID"],
        )

    @app.get("/healthz", include_in_schema=False)
    async def health() -> dict[str, bool]:
        return {"ok": True}

    @app.post(
        "/v1/simulation-batches",
        response_model=SubmitBatchResponse,
        status_code=status.HTTP_202_ACCEPTED,
    )
    async def submit_batch(
        request: Request,
        payload: Annotated[UploadFile, File()],
        simulation_count: Annotated[int, Form(alias="simulationCount", gt=0)],
        ticks: Annotated[int, Form(gt=0)] = 60,
        model: Annotated[str | None, Form()] = None,
    ) -> SubmitBatchResponse:
        hosted: HostedRuntime = request.app.state.runtime
        batch_id = uuid4()
        simulation_ids = [uuid4() for _ in range(simulation_count)]
        if model is not None:
            model = model.strip() or None

        try:
            with TemporaryDirectory(prefix="athena-upload-") as directory:
                directory_path = Path(directory)
                upload_path = directory_path / "payload.upload"
                validation_path = directory_path / "payload.json"
                await asyncio.to_thread(_copy_upload, payload, upload_path)
                compressed = await asyncio.to_thread(
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
        try:
            for simulation_id in simulation_ids:
                await hosted.queue.enqueue(simulation_id)
        except Exception as exc:
            await hosted.repository.fail_batch_enqueue(batch_id, str(exc))
            raise HTTPException(status_code=503, detail="simulation queue unavailable") from exc

        return SubmitBatchResponse(
            batch_id=batch_id,
            simulation_count=simulation_count,
            events_url=f"/v1/simulation-batches/{batch_id}/events",
        )

    @app.get("/v1/simulation-batches/{batch_id}/events")
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
