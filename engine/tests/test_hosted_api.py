import json
from uuid import UUID, uuid4

from fastapi import FastAPI
from fastapi.testclient import TestClient

from athena.hosted.api import HostedRuntime, _sse, create_app
from athena.hosted.config import HostedSettings
from athena.hosted.database import BatchEvent
from datetime import datetime, timezone


def _settings(**overrides) -> HostedSettings:
    """Minimal settings; only the fields the API itself reads are meaningful."""
    return HostedSettings(
        database_url="postgres://unused",
        redis_url="redis://unused",
        bucket_name="unused",
        bucket_endpoint="https://unused",
        bucket_access_key_id="unused",
        bucket_secret_access_key="unused",
        **overrides,
    )


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


def test_submit_batch_accepts_a_plan_id_instead_of_an_upload() -> None:
    repository = FakeRepository()
    queue = FakeQueue()
    storage = FakeStorage()
    app = create_app(
        runtime=HostedRuntime(repository=repository, queue=queue, storage=storage),
        settings=_settings(terrain_service_url="http://terrain.test"),
    )

    with TestClient(app) as client:
        response = client.post(
            "/v1/simulation-batches",
            data={"planId": "plan-1", "simulationCount": "2", "ticks": "9"},
        )

    assert response.status_code == 202
    assert repository.batch["plan_id"] == "plan-1"
    assert repository.batch["ticks"] == 9
    # Pulled scenarios never touch the bucket.
    assert repository.batch.get("payload_key") is None
    assert storage.objects == {}
    assert len(queue.simulation_ids) == 2


def test_plan_id_submission_needs_a_configured_terrain_service() -> None:
    queue = FakeQueue()
    app = create_app(
        runtime=HostedRuntime(
            repository=FakeRepository(), queue=queue, storage=FakeStorage()
        ),
        settings=_settings(),
    )

    with TestClient(app) as client:
        response = client.post(
            "/v1/simulation-batches",
            data={"planId": "plan-1", "simulationCount": "1"},
        )

    assert response.status_code == 503
    assert queue.simulation_ids == []


def test_submit_batch_names_its_scenario_exactly_one_way() -> None:
    app = create_app(
        runtime=HostedRuntime(
            repository=FakeRepository(), queue=FakeQueue(), storage=FakeStorage()
        ),
        settings=_settings(terrain_service_url="http://terrain.test"),
    )

    with TestClient(app) as client:
        neither = client.post(
            "/v1/simulation-batches", data={"simulationCount": "1"}
        )
        both = client.post(
            "/v1/simulation-batches",
            files={"payload": ("payload.json", _payload_bytes(), "application/json")},
            data={"planId": "plan-1", "simulationCount": "1"},
        )

    assert neither.status_code == 422
    assert both.status_code == 422


def _authenticated_app(token: str) -> tuple[FastAPI, FakeQueue]:
    queue = FakeQueue()
    return (
        create_app(
            runtime=HostedRuntime(
                repository=FakeRepository(), queue=queue, storage=FakeStorage()
            ),
            settings=_settings(api_token=token),
        ),
        queue,
    )


def test_submit_batch_requires_a_bearer_token_when_one_is_configured() -> None:
    app, queue = _authenticated_app("s3cret")

    with TestClient(app) as client:
        response = client.post(
            "/v1/simulation-batches",
            files={"payload": ("payload.json", _payload_bytes(), "application/json")},
            data={"simulationCount": "1"},
        )

    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"
    # Rejected before any work is queued.
    assert queue.simulation_ids == []


def test_submit_batch_rejects_a_wrong_or_malformed_token() -> None:
    app, queue = _authenticated_app("s3cret")

    with TestClient(app) as client:
        for header in ("Bearer wrong", "s3cret", "Basic s3cret", "Bearer"):
            response = client.post(
                "/v1/simulation-batches",
                files={
                    "payload": ("payload.json", _payload_bytes(), "application/json")
                },
                data={"simulationCount": "1"},
                headers={"Authorization": header},
            )
            assert response.status_code == 401, header

    assert queue.simulation_ids == []


def test_submit_batch_accepts_the_configured_token() -> None:
    app, queue = _authenticated_app("s3cret")

    with TestClient(app) as client:
        response = client.post(
            "/v1/simulation-batches",
            files={"payload": ("payload.json", _payload_bytes(), "application/json")},
            data={"simulationCount": "2"},
            headers={"Authorization": "Bearer s3cret"},
        )

    assert response.status_code == 202
    assert len(queue.simulation_ids) == 2


def test_event_stream_is_authenticated_too() -> None:
    app, _ = _authenticated_app("s3cret")

    with TestClient(app) as client:
        response = client.get(f"/v1/simulation-batches/{uuid4()}/events")

    assert response.status_code == 401


def test_health_stays_open_so_the_platform_can_probe_it() -> None:
    app, _ = _authenticated_app("s3cret")

    with TestClient(app) as client:
        assert client.get("/healthz").status_code == 200


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
