import asyncio
import gzip
from pathlib import Path
from uuid import uuid4

from athena.hosted.database import SimulationJob
from athena.hosted import worker


class FakeReplay:
    def model_dump_json(self) -> str:
        return '{"schema_version":3}'


class FakeRepository:
    def __init__(self, job: SimulationJob) -> None:
        self.job = job
        self.completed = None
        self.failed = None

    async def claim_simulation(self, _simulation_id):
        return self.job

    async def complete_simulation(self, job, replay_key) -> None:
        self.completed = (job, replay_key)

    async def fail_simulation(self, job, error) -> None:
        self.failed = (job, error)


class FakeStorage:
    def __init__(self) -> None:
        self.replay = None

    async def download_file(self, _key: str, path: Path) -> None:
        path.write_text("{}", encoding="utf-8")

    async def put_bytes(self, data: bytes, key: str, **_metadata) -> None:
        self.replay = (gzip.decompress(data), key)


def test_worker_claims_runs_uploads_and_completes(monkeypatch) -> None:
    job = SimulationJob(
        simulation_id=uuid4(),
        batch_id=uuid4(),
        simulation_index=2,
        ticks=5,
        model=None,
        payload_key="payloads/batch/payload.json",
    )
    repository = FakeRepository(job)
    storage = FakeStorage()

    async def fake_run(_path, *, ticks, model):
        assert ticks == 5
        assert model is None
        return FakeReplay()

    monkeypatch.setattr(worker, "run_payload_simulation", fake_run)
    asyncio.run(
        worker.run_simulation(
            {"repository": repository, "storage": storage},
            str(job.simulation_id),
        )
    )

    assert repository.failed is None
    assert repository.completed[0] == job
    assert storage.replay[0] == b'{"schema_version":3}\n'
    assert storage.replay[1] == repository.completed[1]
