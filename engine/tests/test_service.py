"""The HTTP surface. The search itself is covered elsewhere."""

import pytest
from fastapi.testclient import TestClient

from athena.service import app

from .conftest import edge, node

client = TestClient(app)

GRAPH = {
    "nodes": [
        {"id": 1, "lon": 0.0, "lat": 0.0, "elevation": 0.0},
        {"id": 2, "lon": 1.0, "lat": 0.0, "elevation": 0.0},
    ],
    "edges": [
        {
            "id": "1:0",
            "wayId": 1,
            "from": 1,
            "to": 2,
            "roadClass": "secondary",
            "nodes": [1, 2],
            "points": [[0.0, 0.0], [1.0, 0.0]],
            "lengthMeters": 1000.0,
        }
    ],
}

RESERVE = {"id": "res1", "name": "Assembly", "lon": 0.0, "lat": 0.0}
OBJECTIVE = {"id": "obj1", "name": "Bridge", "lon": 1.0, "lat": 0.0}


def test_health_reports_ok() -> None:
    assert client.get("/health").json() == {"ok": True}


def test_runs_a_study_over_a_supplied_graph() -> None:
    response = client.post(
        "/v1/route-study",
        json={"graph": GRAPH, "reserves": [RESERVE], "objectives": [OBJECTIVE]},
    )

    assert response.status_code == 200
    body = response.json()
    assert len(body["corridors"]) == 1
    assert body["corridors"][0]["routes"][0]["edge_ids"] == ["1:0"]


def test_a_study_needs_ground_to_run_over() -> None:
    response = client.post(
        "/v1/route-study",
        json={"reserves": [RESERVE], "objectives": [OBJECTIVE]},
    )

    assert response.status_code == 400


def test_a_study_needs_an_enemy_reserve() -> None:
    response = client.post(
        "/v1/route-study",
        json={"graph": GRAPH, "reserves": [], "objectives": [OBJECTIVE]},
    )

    assert response.status_code == 400


def test_a_study_needs_an_objective() -> None:
    response = client.post(
        "/v1/route-study",
        json={"graph": GRAPH, "reserves": [RESERVE], "objectives": []},
    )

    assert response.status_code == 400


def test_an_unfetchable_area_is_a_bad_gateway_not_an_empty_study() -> None:
    response = client.post(
        "/v1/route-study",
        json={"area_id": "does-not-exist", "reserves": [RESERVE], "objectives": [OBJECTIVE]},
    )

    assert response.status_code == 502
