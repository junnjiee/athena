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


def test_platform_catalogue_is_available_as_reference_data() -> None:
    response = client.get("/v1/platform-catalogue")

    assert response.status_code == 200
    by_name = {entry["name"]: entry for entry in response.json()}
    assert by_name["BTR-90"]["hardness"] == "hard_skin_light"
    assert by_name["Truck"]["hardness"] == "soft_skin"
    assert by_name["DRAGON"]["hardness"] is None


def test_weapon_target_match_is_an_explicit_deterministic_gate() -> None:
    response = client.post(
        "/v1/weapon-target-match",
        json={"weapon": "LAW", "target": "hard_skin_heavy", "effect": "destroy"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "weapon": "LAW",
        "target": "hard_skin_heavy",
        "effect": "destroy",
        "quality": "conditional",
        "conditions": ["flank or rear aspect"],
        "rationale": "light anti-armour fire requires a flank or rear aspect",
    }


def test_document_intelligence_returns_grounded_reserve_proposals() -> None:
    from athena.intelligence import DraftReserveClaims
    from athena.service import get_claim_generator

    def generator(system: str, prompt: str) -> DraftReserveClaims:
        return DraftReserveClaims.model_validate(
            {
                "claims": [
                    {
                        "source_document_id": "sitrep",
                        "name": "Reserve 1",
                        "locality": "Kranji",
                        "evidence": "Reserve 1 IVO Kranji",
                    }
                ]
            }
        )

    app.dependency_overrides[get_claim_generator] = lambda: generator
    try:
        response = client.post(
            "/v1/document-intelligence",
            json={
                "documents": [
                    {"id": "sitrep", "name": "SITREP", "text": "Reserve 1 IVO Kranji"}
                ]
            },
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    proposal = response.json()["proposals"][0]
    assert proposal["intelligence_status"] == "assessed"
    assert proposal["source_document_ids"] == ["sitrep"]


def test_document_intelligence_caps_aggregate_source_text() -> None:
    response = client.post(
        "/v1/document-intelligence",
        json={
            "documents": [
                {"id": f"source-{index}", "name": "SITREP", "text": "x" * 100_000}
                for index in range(6)
            ]
        },
    )

    assert response.status_code == 413


def test_runs_a_study_over_a_supplied_graph() -> None:
    response = client.post(
        "/v1/route-study",
        json={"graph": GRAPH, "reserves": [RESERVE], "objectives": [OBJECTIVE]},
    )

    assert response.status_code == 200
    body = response.json()
    assert len(body["corridors"]) == 1
    assert body["corridors"][0]["routes"][0]["edge_ids"] == ["1:0"]


def test_corridor_heading_limit_is_a_bounded_request_parameter() -> None:
    response = client.post(
        "/v1/route-study",
        json={
            "graph": GRAPH,
            "reserves": [RESERVE],
            "objectives": [OBJECTIVE],
            "corridor_max_heading_degrees": 181,
        },
    )

    assert response.status_code == 422


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
    }
    body.update(overrides)
    return body


def test_offers_a_block_force_against_a_corridor() -> None:
    response = client.post("/v1/block-forces", json=block_request())

    assert response.status_code == 200
    body = response.json()
    assert body["allocation"][0]["unit_id"] == "sec1"
    assert body["inlets"][0]["edge_ids"] == ["1:0"]
    assert body["inlets"][0]["inlet_number"] == 1


def test_block_forces_need_ground_to_answer_over() -> None:
    request = block_request()
    del request["graph"]

    assert client.post("/v1/block-forces", json=request).status_code == 400


def test_a_company_can_be_offered_without_an_artificial_ceiling() -> None:
    company_only = {"units": [{**ORBAT["units"][0], "echelon": "company"}]}
    response = client.post("/v1/block-forces", json=block_request(orbat=company_only))

    assert response.status_code == 200
    body = response.json()
    assert body["allocation"][0]["unit_id"] == "sec1"


def test_block_candidates_measure_weapon_holdings_not_personnel() -> None:
    armed = {
        "units": [
            {
                **ORBAT["units"][0],
                "weapons": [
                    {"id": "atgm", "weapon": "ATGM", "count": 2},
                    {"id": "law", "weapon": "LAW", "count": 3},
                ],
            }
        ]
    }

    response = client.post("/v1/block-forces", json=block_request(orbat=armed))

    assert response.status_code == 200
    candidate = response.json()["inlets"][0]["candidates"][0]
    assert candidate["weapons"] == [
        {"weapon": "ATGM", "count": 2},
        {"weapon": "LAW", "count": 3},
    ]
    assert "strength" not in candidate


def test_block_force_response_assesses_sealing_against_the_reserve() -> None:
    armed = {
        "units": [
            {
                **ORBAT["units"][0],
                "weapons": [{"id": "atgm", "weapon": "ATGM", "count": 3}],
            }
        ]
    }
    reserve = {
        **RESERVE,
        "task_organization": [
            {
                "id": "element-1",
                "designation": "Motor Rifle Company",
                "echelon": "company",
                "modifier": "=",
                "order_of_move": 1,
                "platforms": [
                    {"id": "platform-1", "platform": "BTR-90", "establishment_count": 10}
                ],
            }
        ],
    }

    response = client.post(
        "/v1/block-forces",
        json=block_request(orbat=armed, reserves=[reserve]),
    )

    assert response.status_code == 200
    assessment = response.json()["sealing"][0]
    assert assessment["outcome"] == "delayed_and_attrited"
    assert assessment["target_platform_count"] == {"numerator": 10, "denominator": 3}
    assert assessment["remaining_platform_count"] == {"numerator": 1, "denominator": 3}
    assert assessment["effective_weapons"] == [{"weapon": "ATGM", "count": 3}]
    assert assessment["reaction"]["remnant_continued"] is True
    assert assessment["reaction"]["objective_outcome"] == "reached"
    assert "delay duration is not assessed" in assessment["reaction"]["unknowns"]


def test_an_invalid_orbat_tree_is_rejected() -> None:
    broken = {
        "units": [
            {**ORBAT["units"][0], "unit_id": "a", "echelon": "section", "parent_id": "ghost"}
        ]
    }
    response = client.post("/v1/block-forces", json=block_request(orbat=broken))

    assert response.status_code == 422


# Enemy courses of action


CORRIDOR = {
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


def courses_request(**overrides: object) -> dict[str, object]:
    body = {
        "corridors": [CORRIDOR],
        "reserves": [RESERVE],
        "objectives": [OBJECTIVE],
        "intent": {"objective_ids": ["obj1"], "narrative": "They want the bridge."},
    }
    body.update(overrides)
    return body


def stub_courses(courses: list[dict[str, object]]):
    from athena.eca import DraftCourses

    def generator(system: str, prompt: str) -> DraftCourses:
        return DraftCourses.model_validate({"courses": courses})

    return lambda: generator


A_COURSE = {
    "name": "Northern push",
    "narrative": "They come north.",
    "efforts": [
        {"kind": "main", "corridor_id": "cor_a", "reserve_id": "res1", "rationale": "fastest"}
    ],
    "likelihood": 0.8,
    "danger": 0.6,
}


def test_returns_ranked_courses_of_action() -> None:
    from athena.service import get_course_generator

    app.dependency_overrides[get_course_generator] = stub_courses([A_COURSE])
    try:
        response = client.post("/v1/enemy-courses-of-action", json=courses_request())
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    body = response.json()
    assert body["most_likely"]["name"] == "Northern push"
    assert body["most_dangerous"]["name"] == "Northern push"


def test_invented_ground_is_reported_rather_than_rendered() -> None:
    from athena.service import get_course_generator

    invented = {
        **A_COURSE,
        "name": "Imaginary",
        "efforts": [
            {
                "kind": "main",
                "corridor_id": "cor_nowhere",
                "reserve_id": "res1",
                "rationale": "-",
            }
        ],
    }
    app.dependency_overrides[get_course_generator] = stub_courses([invented])
    try:
        response = client.post("/v1/enemy-courses-of-action", json=courses_request())
    finally:
        app.dependency_overrides.clear()

    body = response.json()
    assert body["courses"] == []
    assert body["rejected"][0]["corridor_id"] == "cor_nowhere"


def test_a_refusal_is_a_bad_gateway_not_an_empty_assessment() -> None:
    from athena.eca import RefusedError
    from athena.service import get_course_generator

    def refusing():
        def generator(system: str, prompt: str):
            raise RefusedError("declined")

        return generator

    app.dependency_overrides[get_course_generator] = refusing
    try:
        response = client.post("/v1/enemy-courses-of-action", json=courses_request())
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 502


def test_no_corridors_returns_no_courses_without_a_model_call() -> None:
    from athena.service import get_course_generator

    def exploding():
        def generator(system: str, prompt: str):
            raise AssertionError("should not be called")

        return generator

    app.dependency_overrides[get_course_generator] = exploding
    try:
        response = client.post(
            "/v1/enemy-courses-of-action", json=courses_request(corridors=[])
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()["courses"] == []


def test_the_real_model_call_survives_the_endpoint() -> None:
    """The generator every other test here replaces.

    Those stubs are plain functions, so they never reach the one line that
    actually talks to pydantic-ai -- and that line drives its own event loop,
    which an `async def` handler would already be running. Pinning the real
    generator to an offline model exercises the endpoint's plumbing without a
    key or a network, which is the only way this class of failure shows up
    before an operator finds it.
    """
    from pydantic_ai.models.test import TestModel

    from athena.eca import model_generator
    from athena.service import get_course_generator

    app.dependency_overrides[get_course_generator] = lambda: model_generator(TestModel())
    try:
        response = client.post("/v1/enemy-courses-of-action", json=courses_request())
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200


def test_no_model_configured_is_unavailable_not_a_server_error() -> None:
    """A deployment nobody gave a key to must say so, not fall over."""
    from athena.eca import NotConfiguredError
    from athena.service import get_course_generator

    def unconfigured():
        def generator(system: str, prompt: str):
            raise NotConfiguredError("set ATHENA_MODEL and PROVIDER_API_KEY")

        return generator

    app.dependency_overrides[get_course_generator] = unconfigured
    try:
        response = client.post("/v1/enemy-courses-of-action", json=courses_request())
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 503
    assert "PROVIDER_API_KEY" in response.json()["detail"]


# Learned ranking


def test_feedback_moves_the_weights_and_says_why() -> None:
    response = client.post(
        "/v1/preference/feedback",
        json={
            "weights": {},
            "course": {
                "name": "Fast push",
                "narrative": "-",
                "efforts": [
                    {
                        "kind": "main",
                        "corridor_id": "cor_a",
                        "reserve_id": "res1",
                        "rationale": "-",
                    }
                ],
                "likelihood": 0.5,
                "danger": 0.5,
            },
            "corridors": [CORRIDOR],
            "verdict": "accepted",
        },
    )

    assert response.status_code == 200
    body = response.json()
    # the only corridor is the fastest, so accepting raises the speed weight
    assert body["features"]["speed"] == 1.0
    assert body["weights"]["speed"] > 0.5


def test_a_rejection_moves_the_weights_the_other_way() -> None:
    def send(verdict: str) -> float:
        response = client.post(
            "/v1/preference/feedback",
            json={
                "weights": {},
                "course": {
                    "name": "Fast push",
                    "narrative": "-",
                    "efforts": [
                        {
                            "kind": "main",
                            "corridor_id": "cor_a",
                            "reserve_id": "res1",
                            "rationale": "-",
                        }
                    ],
                    "likelihood": 0.5,
                    "danger": 0.5,
                },
                "corridors": [CORRIDOR],
                "verdict": verdict,
            },
        )
        return response.json()["weights"]["speed"]

    assert send("rejected") < 0.5 < send("accepted")


def test_learned_weights_never_displace_the_doctrinal_pair() -> None:
    """Most likely and most dangerous are not preferences to be learned away."""
    from athena.service import get_course_generator

    dangerous = {
        **A_COURSE,
        "name": "Dangerous",
        "likelihood": 0.1,
        "danger": 0.9,
    }
    app.dependency_overrides[get_course_generator] = stub_courses([A_COURSE, dangerous])
    try:
        response = client.post(
            "/v1/enemy-courses-of-action",
            json=courses_request(
                weights={
                    "speed": 0.0,
                    "blockable": 0.0,
                    "complexity": 1.0,
                    "likelihood": 0.0,
                    "danger": 0.0,
                }
            ),
        )
    finally:
        app.dependency_overrides.clear()

    body = response.json()
    assert body["most_likely"]["name"] == "Northern push"
    assert body["most_dangerous"]["name"] == "Dangerous"
