import asyncio
import gzip
from pathlib import Path
from uuid import uuid4

import pytest

from athena.hosted.database import SimulationJob
from athena.hosted import worker
from athena.hosted.runner import RunOutcome


class FakeReplay:
    def model_dump_json(self) -> str:
        return '{"schema_version":3}'


OUTCOME = RunOutcome(
    outcome="blue",
    ticks=4,
    blue_alive=3,
    red_alive=0,
    blue_losses=1,
    red_losses=2,
    shots_fired=9,
    hits=2,
    agents=2,
    followers=3,
    seed=7,
)


class FakeRepository:
    def __init__(self, job: SimulationJob) -> None:
        self.job = job
        self.completed = None
        self.failed = None
        self.progress = []

    async def claim_simulation(self, _simulation_id):
        return self.job

    async def record_progress(self, batch_id, data) -> None:
        self.progress.append((batch_id, data))

    async def complete_simulation(self, job, replay_key, outcome=None) -> None:
        self.completed = (job, replay_key, outcome)

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

    async def fake_run(base_url, plan_id, *, ticks, model, seed, on_progress=None):
        assert base_url == "http://terrain.test"
        assert plan_id == "plan-1"
        assert ticks == 7
        assert model == "some/model"
        # Derived from the batch id and index, so a batch reproduces itself.
        assert seed == (job.batch_id.int + job.simulation_index) % (2**31)
        return FakeReplay(), OUTCOME

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

    async def fake_run(_path, *, ticks, model, seed, on_progress=None):
        assert ticks == 5
        assert model is None
        assert seed == (job.batch_id.int + job.simulation_index) % (2**31)
        return FakeReplay(), OUTCOME

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
    # The outcome rides out with the completion, so scoring a batch never has to
    # fetch the replay back.
    assert repository.completed[2] == {
        "outcome": "blue",
        "ticks": 4,
        "blueAlive": 3,
        "redAlive": 0,
        "blueLosses": 1,
        "redLosses": 2,
        "shotsFired": 9,
        "hits": 2,
        "agents": 2,
        "followers": 3,
        "seed": 7,
        "modelCalls": 0,
        "standingOrders": 0,
        "callTicks": 0,
        "providerRequests": 0,
    }
