import json
from uuid import UUID

from fastapi.testclient import TestClient

from athena.hosted.api import HostedRuntime, _sse, create_app
from athena.hosted.database import BatchEvent
from datetime import datetime, timezone


def _payload_bytes() -> bytes:
    return json.dumps(
        {
            "terrain": {
                "bbox": {"west": 0, "south": 0, "east": 1, "north": 1},
                "width": 1,
                "height": 1,
                "cellMeters": 1,
                "classNames": {"0": "Open Ground"},
                "cells": {"elevation": [0], "cls": [0]},
            },
            "units": [],
            "objectives": [],
        }
    ).encode()


class FakeRepository:
    def __init__(self) -> None:
        self.batch = None

    async def create_batch(self, **values) -> None:
        self.batch = values

    async def fail_batch_enqueue(self, *_args) -> None:
        raise AssertionError("queue should be available")


class FakeQueue:
    def __init__(self) -> None:
        self.simulation_ids = []

    async def enqueue(self, simulation_id) -> None:
        self.simulation_ids.append(simulation_id)


class FakeStorage:
    def __init__(self) -> None:
        self.objects = {}

    async def upload_file(self, path, key, **_metadata) -> None:
        self.objects[key] = path.read_bytes()

    def presigned_get_url(self, key: str) -> str:
        return f"https://storage.test/{key}"


def test_submit_batch_uploads_payload_and_enqueues_each_simulation() -> None:
    repository = FakeRepository()
    queue = FakeQueue()
    storage = FakeStorage()
    app = create_app(
        runtime=HostedRuntime(repository=repository, queue=queue, storage=storage)
    )

    with TestClient(app) as client:
        response = client.post(
            "/v1/simulation-batches",
            files={"payload": ("payload.json", _payload_bytes(), "application/json")},
            data={"simulationCount": "3", "ticks": "4"},
        )

    assert response.status_code == 202
    body = response.json()
    assert UUID(body["batchId"])
    assert body["simulationCount"] == 3
    assert body["eventsUrl"].endswith(f"/{body['batchId']}/events")
    assert repository.batch["ticks"] == 4
    assert len(queue.simulation_ids) == 3
    assert len(storage.objects) == 1


def test_completed_event_replaces_private_key_with_fresh_replay_url() -> None:
    storage = FakeStorage()
    event = BatchEvent(
        id=7,
        event_type="simulation.completed",
        data={"simulationId": "sim-1", "replayKey": "replays/result.json.gz"},
        created_at=datetime.now(timezone.utc),
    )

    encoded = _sse(event, storage)

    assert "id: 7" in encoded
    assert "event: simulation.completed" in encoded
    assert "replayKey" not in encoded
    assert "https://storage.test/replays/result.json.gz" in encoded
