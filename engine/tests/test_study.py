"""Marked ground in, corridors out."""

import pytest

from athena.graph import RoadGraph, nearest_node
from athena.routing import edge_travel_seconds
from athena.study import (
    AggressorEchelon,
    CompositionModifier,
    IntelligenceStatus,
    Mark,
    MarkBounds,
    PlatformCount,
    ReserveLevel,
    ReserveTiming,
    TaskOrganizationElement,
    run_study,
)

from .conftest import edge, node


def test_snaps_a_mark_to_the_closest_junction(ladder: RoadGraph) -> None:
    # just east of node 2 at lon 1
    found = nearest_node(ladder, 1.05, 0.0)

    assert found is not None
    assert found.id == 2


def test_snapping_an_empty_graph_finds_nothing() -> None:
    assert nearest_node(RoadGraph(nodes=(), edges=()), 0, 0) is None


def test_a_reserve_carries_its_deployment_intelligence() -> None:
    reserve = Mark(
        id="res1",
        name="302 Div Res 1",
        lon=1,
        lat=2,
        level=ReserveLevel.DIVISION_RESERVE,
        owning_formation="301 Div",
        intelligence_status=IntelligenceStatus.ASSESSED,
        intelligence_evidence=[
            {
                "source_document_id": "sitrep",
                "source_document_name": "SITREP.txt",
                "excerpt": "302 Div Res 1 remains IVO TOMA 1b",
            }
        ],
        locality="TOMA 1b",
    )

    assert reserve.model_dump(mode="json") == {
        "id": "res1",
        "name": "302 Div Res 1",
        "lon": 1.0,
        "lat": 2.0,
        "level": "K4",
        "owning_formation": "301 Div",
        "intelligence_status": "assessed",
        "intelligence_evidence": [
            {
                "source_document_id": "sitrep",
                "source_document_name": "SITREP.txt",
                "excerpt": "302 Div Res 1 remains IVO TOMA 1b",
            }
        ],
        "locality": "TOMA 1b",
        "task_organization": [],
        "timing": None,
        "bbox": None,
    }


def test_a_reserve_rejects_duplicate_evidence_identities() -> None:
    evidence = {
        "source_document_id": "sitrep",
        "source_document_name": "SITREP.txt",
        "excerpt": "Reserve seen",
    }
    with pytest.raises(ValueError, match="source ids must be unique"):
        Mark(
            id="res1",
            name="Reserve 1",
            lon=1,
            lat=2,
            intelligence_evidence=[evidence, {**evidence, "excerpt": "Repeated"}],
        )


def test_composition_modifiers_are_exact_thirds_without_changing_echelon() -> None:
    element = TaskOrganizationElement(
        id="abg",
        designation="ABG",
        echelon=AggressorEchelon.BATTALION,
        modifier=CompositionModifier.MINUS,
        order_of_move=2,
        platforms=[PlatformCount(id="btr", platform="BTR-90", establishment_count=10)],
    )

    assert element.echelon is AggressorEchelon.BATTALION
    assert element.platforms[0].effective_fraction(element.modifier) == (20, 3)


def test_reserve_timing_keeps_unknown_stages_out_of_the_arithmetic() -> None:
    incomplete = ReserveTiming(decision_minutes=10, deployment_minutes=5)

    assert incomplete.commencement_minutes() is None
    assert incomplete.task_complete_minutes(600) is None


def test_reserve_timing_combines_doctrinal_stages_with_route_movement() -> None:
    timing = ReserveTiming(
        decision_minutes=10,
        readiness_minutes=20,
        deployment_minutes=15,
    )

    assert timing.commencement_minutes() == 30
    assert timing.task_complete_minutes(900) == 60


def test_a_tie_always_snaps_to_the_same_junction() -> None:
    graph = RoadGraph(
        nodes=(node(7, -1), node(3, 1)),
        edges=(edge("1:0", 7, 3, 100),),
    )

    assert nearest_node(graph, 0, 0).id == 3


def test_produces_corridors_between_a_reserve_and_an_objective(
    corridor_pair: RoadGraph,
) -> None:
    result = run_study(
        corridor_pair,
        reserves=[Mark(id="res1", name="Assembly area", lon=0, lat=0)],
        objectives=[Mark(id="obj1", name="Bridge", lon=4, lat=0)],
        max_stretch=10.0,
    )

    assert len(result.corridors) == 2
    assert result.unreachable == []


def test_every_route_says_which_pair_it_serves(corridor_pair: RoadGraph) -> None:
    result = run_study(
        corridor_pair,
        reserves=[Mark(id="res1", name="Assembly area", lon=0, lat=0)],
        objectives=[Mark(id="obj1", name="Bridge", lon=4, lat=0)],
        max_stretch=10.0,
    )

    for corridor in result.corridors:
        for route in corridor.routes:
            assert route.reserve_id == "res1"
            assert route.objective_id == "obj1"


def test_corridors_are_ordered_fastest_first(corridor_pair: RoadGraph) -> None:
    result = run_study(
        corridor_pair,
        reserves=[Mark(id="res1", name="Assembly", lon=0, lat=0)],
        objectives=[Mark(id="obj1", name="Bridge", lon=4, lat=0)],
        max_stretch=10.0,
    )

    seconds = [c.fastest_seconds for c in result.corridors]
    assert seconds == sorted(seconds)


def test_an_unreachable_objective_is_reported_not_dropped() -> None:
    """'We found no way in' is a finding; silence would read as 'no threat'."""
    split = RoadGraph(
        nodes=(node(1, 0), node(2, 1), node(3, 50), node(4, 51)),
        edges=(edge("1:0", 1, 2, 100), edge("2:0", 3, 4, 100)),
    )

    result = run_study(
        split,
        reserves=[Mark(id="res1", name="Assembly", lon=0, lat=0)],
        objectives=[Mark(id="obj1", name="Bridge", lon=51, lat=0)],
    )

    assert result.corridors == []
    assert len(result.unreachable) == 1
    assert result.unreachable[0].reserve_id == "res1"


def test_an_area_objective_routes_to_reachable_ground_inside_its_bounds() -> None:
    split = RoadGraph(
        nodes=(node(1, 0), node(2, 1), node(3, 2), node(4, 3)),
        edges=(edge("1:0", 1, 2, 100), edge("2:0", 3, 4, 100)),
    )

    point_result = run_study(
        split,
        reserves=[Mark(id="res1", name="Assembly", lon=0, lat=0)],
        objectives=[Mark(id="obj1", name="Point", lon=3, lat=0)],
    )
    area_result = run_study(
        split,
        reserves=[Mark(id="res1", name="Assembly", lon=0, lat=0)],
        objectives=[
            Mark(
                id="obj1",
                name="Area",
                lon=3,
                lat=0,
                bbox={"west": 0.5, "south": -1, "east": 3.1, "north": 1},
            )
        ],
    )

    assert len(point_result.unreachable) == 1
    assert area_result.unreachable == []
    assert area_result.corridors[0].routes[0].node_ids[-1] == 2


def test_an_area_objective_stops_where_a_long_edge_enters_its_bounds() -> None:
    road = edge("9:0", 1, 2, 1000)
    road = road.model_copy(update={"points": ((0.0, 0.0), (10.0, 0.0))})
    graph = RoadGraph(nodes=(node(1, 0), node(2, 10)), edges=(road,))

    result = run_study(
        graph,
        reserves=[Mark(id="res1", name="Assembly", lon=0, lat=0)],
        objectives=[
            Mark(
                id="obj1",
                name="Area",
                lon=5,
                lat=0,
                bbox={"west": 4, "south": -1, "east": 6, "north": 1},
            )
        ],
    )

    route = result.corridors[0].routes[0]
    assert route.edge_ids == ["9:0"]
    assert route.node_ids == [1]
    assert route.terminal is not None
    assert route.terminal.model_dump() == {
        "edge_id": "9:0",
        "lon": 4.0,
        "lat": 0.0,
        "edge_fraction": pytest.approx(0.4),
    }
    assert route.length_meters == pytest.approx(400)
    full_seconds = edge_travel_seconds(road, graph.nodes_by_id())
    assert full_seconds is not None
    assert route.seconds == pytest.approx(full_seconds * 0.4)

    reverse_result = run_study(
        graph,
        reserves=[Mark(id="res2", name="Other side", lon=10, lat=0)],
        objectives=[
            Mark(
                id="obj1",
                name="Area",
                lon=5,
                lat=0,
                bbox={"west": 4, "south": -1, "east": 6, "north": 1},
            )
        ],
    )
    reverse_route = reverse_result.corridors[0].routes[0]
    assert reverse_route.node_ids == [2]
    assert reverse_route.terminal is not None
    assert reverse_route.terminal.lon == pytest.approx(6)
    assert reverse_route.terminal.edge_fraction == pytest.approx(0.6)
    assert reverse_route.length_meters == pytest.approx(400)


def test_objective_bounds_must_have_positive_latitude_and_longitude_extent() -> None:
    with pytest.raises(ValueError, match="north must be above south"):
        Mark(
            id="obj1",
            name="Area",
            lon=0,
            lat=0,
            bbox={"west": 0, "south": 1, "east": 2, "north": 1},
        )
    with pytest.raises(ValueError, match="longitude width"):
        Mark(
            id="obj1",
            name="Area",
            lon=0,
            lat=0,
            bbox={"west": 1, "south": 0, "east": 1, "north": 2},
        )


def test_objective_bounds_clip_the_short_way_across_the_antimeridian() -> None:
    bounds = MarkBounds(west=179.5, south=-1, east=-179.5, north=1)

    assert bounds.clip_segment((179, 0), (-179, 0)) == pytest.approx((0.25, 0.75))


def test_two_reserves_into_one_valley_share_a_corridor(corridor_pair: RoadGraph) -> None:
    """A commander blocking that ground blocks both, so it is one approach."""
    result = run_study(
        corridor_pair,
        reserves=[
            Mark(id="res1", name="North", lon=0, lat=0),
            Mark(id="res2", name="Also north", lon=0.01, lat=0),
        ],
        objectives=[Mark(id="obj1", name="Bridge", lon=4, lat=0)],
        max_stretch=10.0,
    )

    served = {r.reserve_id for c in result.corridors for r in c.routes}
    assert served == {"res1", "res2"}
    # both reserves snap to node 1, so they use the same two approaches
    assert len(result.corridors) == 2


def test_is_deterministic(corridor_pair: RoadGraph) -> None:
    args = {
        "reserves": [Mark(id="res1", name="Assembly", lon=0, lat=0)],
        "objectives": [Mark(id="obj1", name="Bridge", lon=4, lat=0)],
        "max_stretch": 10.0,
    }
    first = run_study(corridor_pair, **args)
    second = run_study(corridor_pair, **args)

    assert [c.id for c in first.corridors] == [c.id for c in second.corridors]
