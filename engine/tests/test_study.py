"""Marked ground in, corridors out."""

from athena.graph import RoadGraph, nearest_node
from athena.study import Mark, run_study

from .conftest import edge, node


def test_snaps_a_mark_to_the_closest_junction(ladder: RoadGraph) -> None:
    # just east of node 2 at lon 1
    found = nearest_node(ladder, 1.05, 0.0)

    assert found is not None
    assert found.id == 2


def test_snapping_an_empty_graph_finds_nothing() -> None:
    assert nearest_node(RoadGraph(nodes=(), edges=()), 0, 0) is None


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
