import asyncio
import gzip
from pathlib import Path
from uuid import uuid4

import pytest

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


def test_worker_pulls_a_plan_scenario_without_touching_the_bucket(monkeypatch) -> None:
    job = SimulationJob(
        simulation_id=uuid4(),
        batch_id=uuid4(),
        simulation_index=0,
        ticks=7,
        model="some/model",
        payload_key=None,
        plan_id="plan-1",
    )
    repository = FakeRepository(job)
    storage = FakeStorage()

    async def refuse_download(*_args, **_kwargs):
        raise AssertionError("a pulled scenario must not download a payload")

    storage.download_file = refuse_download

    async def fake_run(base_url, plan_id, *, ticks, model):
        assert base_url == "http://terrain.test"
        assert plan_id == "plan-1"
        assert ticks == 7
        assert model == "some/model"
        return FakeReplay()

    monkeypatch.setattr(worker, "run_plan_simulation", fake_run)
    asyncio.run(
        worker.run_simulation(
            {
                "repository": repository,
                "storage": storage,
                "terrain_service_url": "http://terrain.test",
            },
            str(job.simulation_id),
        )
    )

    assert repository.failed is None
    assert repository.completed[0] == job


def test_worker_fails_a_plan_scenario_when_no_terrain_service_is_configured() -> None:
    job = SimulationJob(
        simulation_id=uuid4(),
        batch_id=uuid4(),
        simulation_index=0,
        ticks=5,
        model=None,
        payload_key=None,
        plan_id="plan-1",
    )
    repository = FakeRepository(job)

    with pytest.raises(RuntimeError, match="TERRAIN_SERVICE_URL"):
        asyncio.run(
            worker.run_simulation(
                {
                    "repository": repository,
                    "storage": FakeStorage(),
                    "terrain_service_url": None,
                },
                str(job.simulation_id),
            )
        )

    assert repository.failed is not None


def test_worker_claims_runs_uploads_and_completes(monkeypatch) -> None:
    job = SimulationJob(
        simulation_id=uuid4(),
        batch_id=uuid4(),
        simulation_index=2,
        ticks=5,
        model=None,
        payload_key="payloads/batch/payload.json",
        plan_id=None,
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
