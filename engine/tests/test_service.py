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


def test_an_operator_override_removes_ground_from_the_study() -> None:
    """The only road is marked impassable, so there is no longer a way in."""
    response = client.post(
        "/v1/route-study",
        json={
            "graph": GRAPH,
            "reserves": [RESERVE],
            "objectives": [OBJECTIVE],
            "excluded_edge_ids": ["1:0"],
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["corridors"] == []
    assert len(body["unreachable"]) == 1


ORBAT = {
    "units": [
        {
            "unit_id": "sec1",
            "name": "1 Section",
            "echelon": "section",
            "lon": 0.0,
            "lat": 0.0,
            "strength": 7,
        }
    ]
}


def block_request(**overrides: object) -> dict[str, object]:
    body = {
        "graph": GRAPH,
        "corridors": [
            {
                "id": "cor_a",
                "routes": [
                    {
                        "reserve_id": "res1",
                        "objective_id": "obj1",
                        "edge_ids": ["1:0"],
                        "node_ids": [1, 2],
                        "seconds": 600.0,
                        "length_meters": 1000.0,
                    }
                ],
                "choke_edge_ids": ["1:0"],
                "fastest_seconds": 600.0,
            }
        ],
        "orbat": ORBAT,
        "ceiling": "section",
    }
    body.update(overrides)
    return body


def test_offers_a_block_force_against_a_corridor() -> None:
    response = client.post("/v1/block-forces", json=block_request())

    assert response.status_code == 200
    body = response.json()
    assert body["allocation"][0]["unit_id"] == "sec1"
    assert body["corridors"][0]["choke_edge_ids"] == ["1:0"]


def test_block_forces_need_ground_to_answer_over() -> None:
    request = block_request()
    del request["graph"]

    assert client.post("/v1/block-forces", json=request).status_code == 400


def test_a_ceiling_below_the_force_leaves_the_corridor_unblockable() -> None:
    company_only = {"units": [{**ORBAT["units"][0], "echelon": "company"}]}
    response = client.post("/v1/block-forces", json=block_request(orbat=company_only))

    assert response.status_code == 200
    body = response.json()
    assert body["allocation"] == []
    assert len(body["unblockable"]) == 1


def test_an_invalid_orbat_tree_is_rejected() -> None:
    broken = {
        "units": [
            {**ORBAT["units"][0], "unit_id": "a", "echelon": "section", "parent_id": "ghost"}
        ]
    }
    response = client.post("/v1/block-forces", json=block_request(orbat=broken))

    assert response.status_code == 422
