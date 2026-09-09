"""The search that turns a road graph into candidate approaches."""

import pytest

from athena.graph import RoadGraph
from athena.routing import (
    Route,
    edge_travel_seconds,
    find_diverse_routes,
    find_diverse_routes_to_any,
    shortest_route,
    shortest_route_to_any,
)

from .conftest import edge, node


def ids(route: Route) -> list[str]:
    return [e.id for e in route.edges]


# Cost model


def test_a_faster_road_class_costs_less_over_the_same_distance() -> None:
    trunk = edge("1:0", 1, 2, 1000, "trunk")
    track = edge("2:0", 1, 2, 1000, "track")
    nodes = {1: node(1, 0), 2: node(2, 1)}

    assert edge_travel_seconds(trunk, nodes) < edge_travel_seconds(track, nodes)


def test_climbing_costs_more_than_the_same_road_on_the_flat() -> None:
    flat_nodes = {1: node(1, 0), 2: node(2, 1)}
    hill_nodes = {1: node(1, 0), 2: node(2, 1, elevation=100)}
    road = edge("1:0", 1, 2, 1000)

    assert edge_travel_seconds(road, hill_nodes) > edge_travel_seconds(road, flat_nodes)


def test_a_descent_is_not_credited_as_time_gained() -> None:
    """A loaded column brakes downhill; it does not make up time."""
    downhill = {1: node(1, 0, elevation=100), 2: node(2, 1)}
    flat = {1: node(1, 0), 2: node(2, 1)}
    road = edge("1:0", 1, 2, 1000)

    assert edge_travel_seconds(road, downhill) == edge_travel_seconds(road, flat)


def test_a_grade_past_the_limit_is_impassable() -> None:
    cliff = {1: node(1, 0), 2: node(2, 1, elevation=500)}
    road = edge("1:0", 1, 2, 1000)

    assert edge_travel_seconds(road, cliff) is None


def test_a_slope_can_be_impassable_uphill_and_legal_down() -> None:
    nodes = {1: node(1, 0), 2: node(2, 1, elevation=500)}
    road = edge("1:0", 1, 2, 1000)

    assert edge_travel_seconds(road, nodes) is None
    assert edge_travel_seconds(road, nodes, reverse=True) is not None


# Shortest route


def test_finds_the_quickest_way_through(ladder: RoadGraph) -> None:
    route = shortest_route(ladder, 1, 4)

    assert route is not None
    assert ids(route) == ["1:0", "1:1", "1:2"]
    assert route.length_meters == 3000


def test_returns_nothing_when_no_route_exists() -> None:
    split = RoadGraph(
        nodes=(node(1, 0), node(2, 1), node(3, 5), node(4, 6)),
        edges=(edge("1:0", 1, 2, 100), edge("2:0", 3, 4, 100)),
    )

    assert shortest_route(split, 1, 4) is None


def test_an_unknown_node_yields_no_route(ladder: RoadGraph) -> None:
    assert shortest_route(ladder, 1, 999) is None


def test_start_and_end_together_is_an_empty_route(ladder: RoadGraph) -> None:
    route = shortest_route(ladder, 1, 1)

    assert route is not None
    assert route.edges == ()
    assert route.seconds == 0


def test_multi_goal_search_stops_at_the_fastest_reachable_objective_junction() -> None:
    graph = RoadGraph(
        nodes=(node(1, 0), node(2, 1), node(3, 2)),
        edges=(edge("1:0", 1, 2, 1000), edge("2:0", 1, 3, 100)),
    )

    route = shortest_route_to_any(graph, 1, frozenset({2, 3}))
    diverse = find_diverse_routes_to_any(graph, 1, frozenset({2, 3}), k=2)

    assert route is not None
    assert route.nodes[-1] == 3
    assert ids(route) == ["2:0"]
    assert diverse[0].nodes[-1] == 3


# Diverse routes


def test_finds_both_arms_of_a_ladder(ladder: RoadGraph) -> None:
    routes = find_diverse_routes(ladder, 1, 4, k=4)

    assert len(routes) >= 2
    # the fastest is the northern arm; something using the southern arm follows
    assert ids(routes[0]) == ["1:0", "1:1", "1:2"]
    assert any("2:" in e for route in routes[1:] for e in ids(route))


def test_every_route_is_returned_fastest_first(corridor_pair: RoadGraph) -> None:
    routes = find_diverse_routes(corridor_pair, 1, 9, k=4)

    assert [r.seconds for r in routes] == sorted(r.seconds for r in routes)


def test_no_route_exceeds_the_stretch_bound(corridor_pair: RoadGraph) -> None:
    routes = find_diverse_routes(corridor_pair, 1, 9, k=8, max_stretch=1.2)
    fastest = routes[0].seconds

    assert all(route.seconds <= fastest * 1.2 + 1e-9 for route in routes)


def test_a_generous_stretch_bound_admits_the_slow_arm(corridor_pair: RoadGraph) -> None:
    # the track arm is far slower than the trunk arm; only a loose bound keeps it
    routes = find_diverse_routes(corridor_pair, 1, 9, k=8, max_stretch=10.0)

    assert len(routes) == 2


def test_accepted_routes_do_not_overlap_beyond_the_sharing_bound(ladder: RoadGraph) -> None:
    routes = find_diverse_routes(ladder, 1, 4, k=6, max_sharing=0.5, max_stretch=5.0)

    for i, route in enumerate(routes):
        for other in routes[:i]:
            shared = sum(
                e.length_meters for e in route.edges if e.id in {o.id for o in other.edges}
            )
            assert shared / route.length_meters < 0.5 + 1e-9


def test_never_returns_more_than_k(corridor_pair: RoadGraph) -> None:
    assert len(find_diverse_routes(corridor_pair, 1, 9, k=1, max_stretch=10.0)) == 1


def test_terminates_when_the_graph_cannot_supply_k_routes(corridor_pair: RoadGraph) -> None:
    # only two genuinely distinct approaches exist, however many are asked for
    routes = find_diverse_routes(corridor_pair, 1, 9, k=20, max_stretch=10.0)

    assert len(routes) == 2


def test_is_deterministic(corridor_pair: RoadGraph) -> None:
    first = find_diverse_routes(corridor_pair, 1, 9, k=8, max_stretch=10.0)
    second = find_diverse_routes(corridor_pair, 1, 9, k=8, max_stretch=10.0)

    assert [ids(r) for r in first] == [ids(r) for r in second]


def test_an_unreachable_objective_yields_nothing() -> None:
    split = RoadGraph(
        nodes=(node(1, 0), node(2, 1), node(3, 5), node(4, 6)),
        edges=(edge("1:0", 1, 2, 100), edge("2:0", 3, 4, 100)),
    )

    assert find_diverse_routes(split, 1, 4, k=4) == []


# Operator overrides


def test_an_excluded_edge_is_not_used(ladder: RoadGraph) -> None:
    """A dropped bridge is an edge the operator marked, not a rule the engine knows."""
    route = shortest_route(ladder, 1, 4, excluded=frozenset({"1:1"}))

    assert route is not None
    assert "1:1" not in ids(route)


def test_excluding_the_only_way_through_leaves_no_route() -> None:
    line = RoadGraph(
        nodes=(node(1, 0), node(2, 1), node(3, 2)),
        edges=(edge("1:0", 1, 2, 100), edge("1:1", 2, 3, 100)),
    )

    assert shortest_route(line, 1, 3, excluded=frozenset({"1:1"})) is None


def test_diverse_search_respects_exclusions(corridor_pair: RoadGraph) -> None:
    routes = find_diverse_routes(
        corridor_pair, 1, 9, k=8, max_stretch=10.0, excluded=frozenset({"10:0"})
    )

    assert routes
    assert all("10:0" not in ids(route) for route in routes)
