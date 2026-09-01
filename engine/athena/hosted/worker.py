"""Railway worker entry point for queued Athena simulations."""

import asyncio
import gzip
import os
import time
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any
from uuid import UUID

from arq.connections import RedisSettings

from athena.hosted.config import HostedSettings
from athena.hosted.database import BatchRepository, SimulationJob
from athena.hosted.runner import run_payload_simulation, run_plan_simulation
from athena.hosted.storage import BucketStorage


async def startup(ctx: dict[str, Any]) -> None:
    settings = HostedSettings.from_env()
    ctx["repository"] = await BatchRepository.connect(settings.database_url)
    ctx["storage"] = BucketStorage(settings)
    ctx["terrain_service_url"] = settings.terrain_service_url


async def shutdown(ctx: dict[str, Any]) -> None:
    await ctx["repository"].close()


PROGRESS_INTERVAL_SECONDS = 1.0
"""How often a run in flight reports where it has got to.

Every tick would be one database write per tick per simulation, which for a
large batch is most of what the database does. One a second is well under what
an operator perceives as live, and the first and last tick are always sent so a
run visibly starts and visibly finishes.
"""


def _progress_reporter(
    repository: BatchRepository,
    job: SimulationJob,
    loop: asyncio.AbstractEventLoop,
) -> Any:
    """Throttled progress writes, callable from the run without awaiting."""
    last = 0.0

    def report(data: dict[str, Any]) -> None:
        nonlocal last
        now = time.monotonic()
        final = data.get("tick") == data.get("ticks")
        if not final and now - last < PROGRESS_INTERVAL_SECONDS:
            return
        last = now
        payload = {
            "simulationId": str(job.simulation_id),
            "simulationIndex": job.simulation_index,
            **data,
        }
        # Fire and forget: a run must never wait on its own telemetry, and a
        # failed progress write is not a failed simulation.
        task = loop.create_task(repository.record_progress(job.batch_id, payload))
        task.add_done_callback(lambda done: done.exception())

    return report


async def run_simulation(ctx: dict[str, Any], simulation_id: str) -> None:
    repository: BatchRepository = ctx["repository"]
    storage: BucketStorage = ctx["storage"]
    job = await repository.claim_simulation(UUID(simulation_id))
    if job is None:
        return

    on_progress = _progress_reporter(repository, job, asyncio.get_running_loop())

    try:
        if job.plan_id is not None:
            # Pulled scenario: no bucket round trip, the worker reads the plan
            # straight from the terrain service.
            terrain_service_url = ctx["terrain_service_url"]
            if terrain_service_url is None:
                raise RuntimeError(
                    "batch names a plan id but TERRAIN_SERVICE_URL is not set"
                )
            replay, outcome = await run_plan_simulation(
                terrain_service_url,
                job.plan_id,
                ticks=job.ticks,
                model=job.model,
                seed=_seed_for(job),
                on_progress=on_progress,
            )
        else:
            replay, outcome = await _run_uploaded_payload(storage, job, on_progress)

        replay_bytes = gzip.compress(f"{replay.model_dump_json()}\n".encode("utf-8"))
        replay_key = (
            f"replays/{job.batch_id}/{job.simulation_index}-"
            f"{job.simulation_id}.json.gz"
        )
        await storage.put_bytes(
            replay_bytes,
            replay_key,
            content_type="application/json",
            content_encoding="gzip",
        )
        await repository.complete_simulation(job, replay_key, outcome.as_event_data())
    except Exception as exc:
        await repository.fail_simulation(job, str(exc))
        raise


def _seed_for(job: Any) -> int:
    """A stable, distinct seed per simulation in a batch.

    Derived from the batch id and the simulation's index rather than randomly
    chosen, so re-running the same batch id reproduces the same set of runs while
    the runs within it still differ from one another.
    """
    return (job.batch_id.int + job.simulation_index) % (2**31)


async def _run_uploaded_payload(storage: Any, job: Any, on_progress: Any = None) -> Any:
    """Run a batch whose scenario was uploaded as a payload file."""
    with TemporaryDirectory(prefix="athena-simulation-") as directory:
        directory_path = Path(directory)
        stored_payload = directory_path / "payload.upload"
        await storage.download_file(job.payload_key, stored_payload)

        payload_path = stored_payload
        if job.payload_key.endswith(".gz"):
            payload_path = directory_path / "payload.json"
            with gzip.open(stored_payload, "rb") as source, payload_path.open(
                "wb"
            ) as output:
                while chunk := source.read(1024 * 1024):
                    output.write(chunk)

        return await run_payload_simulation(
            payload_path,
            ticks=job.ticks,
            model=job.model,
            seed=_seed_for(job),
            on_progress=on_progress,
        )


class WorkerSettings:
    functions = [run_simulation]
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = RedisSettings.from_dsn(
        os.getenv("REDIS_URL", "redis://localhost:6379")
    )
    max_jobs = max(1, int(os.getenv("WORKER_CONCURRENCY", "2")))
    # A normal engine/provider exception is recorded as failed and cannot be
    # claimed again. The second allowance exists only so ARQ can re-run a job
    # left in "running" when a worker is terminated during a deployment.
    max_tries = 2
    retry_jobs = True
    job_timeout = 24 * 60 * 60
    keep_result = 0
