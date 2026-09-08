"""Grouping routes into the approaches a commander would name."""

from athena.corridors import cluster_into_corridors, route_similarity
from athena.graph import RoadGraph
from athena.routing import Route, find_diverse_routes

from .conftest import edge, node


def route_of(*edges) -> Route:
    return Route(
        edges=tuple(edges),
        nodes=(),
        seconds=sum(e.length_meters for e in edges) / 10,
        length_meters=sum(e.length_meters for e in edges),
    )


A = edge("1:0", 1, 2, 1000)
B = edge("1:1", 2, 3, 1000)
C = edge("2:0", 1, 4, 1000)
D = edge("2:1", 4, 3, 1000)


# Similarity


def test_identical_routes_are_wholly_similar() -> None:
    assert route_similarity(route_of(A, B), route_of(A, B)) == 1.0


def test_disjoint_routes_share_nothing() -> None:
    assert route_similarity(route_of(A, B), route_of(C, D)) == 0.0


def test_similarity_does_not_depend_on_argument_order() -> None:
    one, two = route_of(A, B), route_of(A, C, D)

    assert route_similarity(one, two) == route_similarity(two, one)


# Clustering


def test_routes_down_the_same_ground_form_one_corridor() -> None:
    corridors = cluster_into_corridors([route_of(A, B), route_of(A, D)], similarity=0.4)

    assert len(corridors) == 1
    assert len(corridors[0].routes) == 2


def test_separate_approaches_stay_separate() -> None:
    corridors = cluster_into_corridors([route_of(A, B), route_of(C, D)], similarity=0.4)

    assert len(corridors) == 2


def test_no_routes_makes_no_corridors() -> None:
    assert cluster_into_corridors([]) == []


def test_corridors_come_back_fastest_first() -> None:
    slow = route_of(A, B, C, D)
    fast = route_of(A)
    corridors = cluster_into_corridors([slow, fast], similarity=0.9)

    assert corridors[0].fastest_seconds < corridors[1].fastest_seconds


# Identity


def test_a_corridor_id_is_derived_from_the_ground_it_covers() -> None:
    first = cluster_into_corridors([route_of(A, B)])
    second = cluster_into_corridors([route_of(A, B)])

    assert first[0].id == second[0].id


def test_different_ground_gets_a_different_id() -> None:
    one = cluster_into_corridors([route_of(A, B)])
    two = cluster_into_corridors([route_of(C, D)])

    assert one[0].id != two[0].id


def test_identity_survives_the_routes_arriving_in_another_order() -> None:
    forward = cluster_into_corridors([route_of(A, B), route_of(A, D)], similarity=0.4)
    backward = cluster_into_corridors([route_of(A, D), route_of(A, B)], similarity=0.4)

    assert forward[0].id == backward[0].id


# Choke points


def test_the_choke_point_is_the_ground_every_route_must_cross() -> None:
    corridors = cluster_into_corridors([route_of(A, B), route_of(A, D)], similarity=0.4)

    # both routes run down A; only A is unavoidable
    assert corridors[0].choke_edge_ids == ("1:0",)


def test_a_corridor_of_one_route_is_wholly_its_own_choke_point() -> None:
    corridors = cluster_into_corridors([route_of(A, B)])

    assert set(corridors[0].choke_edge_ids) == {"1:0", "1:1"}


def test_routes_sharing_nothing_but_a_corridor_have_no_choke_point() -> None:
    # forced into one corridor by a permissive threshold despite no shared edge
    corridors = cluster_into_corridors([route_of(A, B), route_of(C, D)], similarity=0.0)

    assert corridors[0].choke_edge_ids == ()


# Over a real search


def test_clusters_the_two_arms_of_a_real_graph(corridor_pair: RoadGraph) -> None:
    routes = find_diverse_routes(corridor_pair, 1, 9, k=8, max_stretch=10.0)
    corridors = cluster_into_corridors(routes)

    assert len(corridors) == 2
    assert all(len(c.routes) == 1 for c in corridors)
