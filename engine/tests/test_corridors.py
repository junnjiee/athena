"""Grouping axes into the corridors a commander would name.

A corridor is a bundle of axes: the set that together forms one approach. Axes
belong together when they run close, point the same way, and can be crossed
between along their length. Shared tarmac is emphatically not the test.
"""

from athena.corridors import (
    axis_heading_difference_degrees,
    cluster_into_corridors,
    lateral_detour_ratio,
)
from athena.graph import RoadGraph
from athena.routing import Route, find_diverse_routes

from .conftest import edge, node


def route_over(graph: RoadGraph, edge_ids: list[str]) -> Route:
    """A route down named edges of a fixture graph, in the order given."""
    by_id = {e.id: e for e in graph.edges}
    edges = tuple(by_id[edge_id] for edge_id in edge_ids)
    nodes = (edges[0].from_node,) + tuple(e.to_node for e in edges)
    return Route(
        edges=edges,
        nodes=nodes,
        seconds=sum(e.length_meters for e in edges) / 10,
        length_meters=sum(e.length_meters for e in edges),
    )


NORTH = ["10:0", "10:1", "10:2"]
SOUTH = ["20:0", "20:1", "20:2"]


# Grouping


def test_parallel_axes_sharing_no_edges_are_one_corridor(parallel_axes) -> None:
    north = route_over(parallel_axes, NORTH)
    south = route_over(parallel_axes, SOUTH)

    corridors = cluster_into_corridors([north, south], parallel_axes)

    assert len(corridors) == 1


def test_axes_that_only_meet_far_away_are_separate_corridors(severed_axes) -> None:
    north = route_over(severed_axes, ["10:0", "10:1", "10:2", "10:3"])
    south = route_over(severed_axes, ["20:0", "20:1", "20:2", "20:3"])

    corridors = cluster_into_corridors([north, south], severed_axes)

    assert len(corridors) == 2


def test_axes_far_apart_are_separate_however_well_connected(corridor_pair) -> None:
    routes = find_diverse_routes(corridor_pair, 1, 9, k=8, max_stretch=10.0)

    corridors = cluster_into_corridors(routes, corridor_pair)

    # The two arms are 200 km apart -- connectivity cannot rescue that.
    assert len(corridors) == 2


def test_close_connected_axes_crossing_at_right_angles_are_separate() -> None:
    crossing = RoadGraph(
        nodes=(
            node(1, -0.02, 0), node(2, 0, 0), node(3, 0.02, 0),
            node(4, 0, -0.02), node(5, 0, 0.02),
        ),
        edges=(
            edge("40:0", 1, 2, 2226), edge("40:1", 2, 3, 2226),
            edge("50:0", 4, 2, 2226), edge("50:1", 2, 5, 2226),
        ),
    )
    horizontal = route_over(crossing, ["40:0", "40:1"])
    vertical = route_over(crossing, ["50:0", "50:1"])

    assert axis_heading_difference_degrees(horizontal, vertical, crossing.nodes_by_id()) == 90
    assert len(cluster_into_corridors([horizontal, vertical], crossing)) == 2


def test_opposite_travel_directions_are_not_one_approach(parallel_axes) -> None:
    eastbound = route_over(parallel_axes, NORTH)
    westbound = Route(
        edges=tuple(reversed(eastbound.edges)),
        nodes=tuple(reversed(eastbound.nodes)),
        seconds=eastbound.seconds,
        length_meters=eastbound.length_meters,
    )

    assert axis_heading_difference_degrees(eastbound, westbound, parallel_axes.nodes_by_id()) == 180
    assert len(cluster_into_corridors([eastbound, westbound], parallel_axes)) == 2


def test_no_routes_makes_no_corridors(parallel_axes) -> None:
    assert cluster_into_corridors([], parallel_axes) == []


def test_corridors_come_back_fastest_first(severed_axes) -> None:
    north = route_over(severed_axes, ["10:0", "10:1", "10:2", "10:3"])
    slow_south = route_over(severed_axes, ["20:0", "20:1", "20:2", "20:3"])
    object.__setattr__(slow_south, "seconds", north.seconds * 2)

    corridors = cluster_into_corridors([slow_south, north], severed_axes)

    assert corridors[0].fastest_seconds < corridors[1].fastest_seconds


# The obstacle test


def test_a_rung_between_two_roads_is_a_short_way_round(parallel_axes) -> None:
    north = route_over(parallel_axes, NORTH)
    south = route_over(parallel_axes, SOUTH)

    assert lateral_detour_ratio(north, south, parallel_axes) < 2.0


def test_water_with_no_road_across_it_is_a_long_way_round(severed_axes) -> None:
    north = route_over(severed_axes, ["10:0", "10:1", "10:2", "10:3"])
    south = route_over(severed_axes, ["20:0", "20:1", "20:2", "20:3"])

    assert lateral_detour_ratio(north, south, severed_axes) > 10.0


# Identity


def test_a_corridor_id_is_derived_from_the_ground_it_covers(parallel_axes) -> None:
    first = cluster_into_corridors([route_over(parallel_axes, NORTH)], parallel_axes)
    second = cluster_into_corridors([route_over(parallel_axes, NORTH)], parallel_axes)

    assert first[0].id == second[0].id


def test_different_ground_gets_a_different_id(parallel_axes) -> None:
    one = cluster_into_corridors([route_over(parallel_axes, NORTH)], parallel_axes)
    two = cluster_into_corridors([route_over(parallel_axes, SOUTH)], parallel_axes)

    assert one[0].id != two[0].id


def test_identity_survives_the_routes_arriving_in_another_order(parallel_axes) -> None:
    north = route_over(parallel_axes, NORTH)
    south = route_over(parallel_axes, SOUTH)

    forward = cluster_into_corridors([north, south], parallel_axes)
    backward = cluster_into_corridors([south, north], parallel_axes)

    assert forward[0].id == backward[0].id


# Choke points


def test_the_choke_point_is_the_ground_every_axis_must_cross(parallel_axes) -> None:
    straight = route_over(parallel_axes, ["10:0", "10:1", "10:2"])
    crossing = route_over(parallel_axes, ["10:0", "30:0", "20:1", "20:2"])

    corridors = cluster_into_corridors([straight, crossing], parallel_axes)

    assert len(corridors) == 1
    # both leave down 10:0; only that is unavoidable
    assert corridors[0].choke_edge_ids == ("10:0",)


def test_a_corridor_of_one_axis_is_wholly_its_own_choke_point(parallel_axes) -> None:
    corridors = cluster_into_corridors([route_over(parallel_axes, NORTH)], parallel_axes)

    assert set(corridors[0].choke_edge_ids) == set(NORTH)


def test_axes_in_one_corridor_sharing_no_ground_have_no_choke_point(parallel_axes) -> None:
    """The case that motivates coverage over concentration.

    Two roads through the same gap are one corridor, but there is nowhere a
    single block sits astride both. Reported empty rather than invented.
    """
    north = route_over(parallel_axes, NORTH)
    south = route_over(parallel_axes, SOUTH)

    corridors = cluster_into_corridors([north, south], parallel_axes)

    assert corridors[0].choke_edge_ids == ()
