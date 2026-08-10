"""Redis-backed simulation job producer."""

from uuid import UUID

from arq import create_pool
from arq.connections import ArqRedis, RedisSettings


class SimulationQueue:
    def __init__(self, redis: ArqRedis) -> None:
        self.redis = redis

    @classmethod
    async def connect(cls, redis_url: str) -> "SimulationQueue":
        redis = await create_pool(RedisSettings.from_dsn(redis_url))
        return cls(redis)

    async def close(self) -> None:
        await self.redis.aclose()

    async def enqueue(self, simulation_id: UUID) -> None:
        job = await self.redis.enqueue_job(
            "run_simulation",
            str(simulation_id),
            _job_id=str(simulation_id),
        )
        if job is None:
            raise RuntimeError(f"simulation job {simulation_id} was not enqueued")
