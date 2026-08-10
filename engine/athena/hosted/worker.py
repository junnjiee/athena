"""Railway worker entry point for queued Athena simulations."""

import gzip
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any
from uuid import UUID

from arq.connections import RedisSettings

from athena.hosted.config import HostedSettings
from athena.hosted.database import BatchRepository
from athena.hosted.runner import run_payload_simulation
from athena.hosted.storage import BucketStorage


async def startup(ctx: dict[str, Any]) -> None:
    settings = HostedSettings.from_env()
    ctx["repository"] = await BatchRepository.connect(settings.database_url)
    ctx["storage"] = BucketStorage(settings)


async def shutdown(ctx: dict[str, Any]) -> None:
    await ctx["repository"].close()


async def run_simulation(ctx: dict[str, Any], simulation_id: str) -> None:
    repository: BatchRepository = ctx["repository"]
    storage: BucketStorage = ctx["storage"]
    job = await repository.claim_simulation(UUID(simulation_id))
    if job is None:
        return

    try:
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

            replay = await run_payload_simulation(
                payload_path,
                ticks=job.ticks,
                model=job.model,
            )
            replay_bytes = gzip.compress(
                f"{replay.model_dump_json()}\n".encode("utf-8")
            )
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
            await repository.complete_simulation(job, replay_key)
    except Exception as exc:
        await repository.fail_simulation(job, str(exc))
        raise


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
