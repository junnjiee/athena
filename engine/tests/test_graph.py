import gzip
import json

from athena.graph import RoadClass, decode_graph

from .conftest import edge, node

RAW = {
    "nodes": [
        {"id": 1, "lon": 0.0, "lat": 0.0, "elevation": 10.0},
        {"id": 2, "lon": 0.01, "lat": 0.0, "elevation": 110.0},
    ],
    "edges": [
        {
            "id": "1:0",
            "wayId": 1,
            "from": 1,
            "to": 2,
            "roadClass": "track",
            "nodes": [1, 2],
            "points": [[0.0, 0.0], [0.01, 0.0]],
            "lengthMeters": 1000.0,
        }
    ],
}


def test_decodes_the_servers_gzipped_json() -> None:
    graph = decode_graph(gzip.compress(json.dumps(RAW).encode()))

    assert len(graph.nodes) == 2
    assert graph.edges[0].road_class is RoadClass.TRACK
    assert graph.edges[0].from_node == 1
    assert graph.edges[0].length_meters == 1000.0


def test_gradient_is_signed_by_direction_of_travel() -> None:
    graph = decode_graph(gzip.compress(json.dumps(RAW).encode()))
    nodes = graph.nodes_by_id()

    # 100 m of rise over 1000 m of road
    assert graph.edges[0].gradient(nodes) == 0.1
    assert graph.edges[0].gradient(nodes, reverse=True) == -0.1


def test_a_zero_length_edge_has_no_gradient() -> None:
    flat = edge("1:0", 1, 1, 0.0)
    nodes = {1: node(1, 0, elevation=50)}

    assert flat.gradient(nodes) == 0.0


def test_edges_are_walkable_in_both_directions() -> None:
    graph = decode_graph(gzip.compress(json.dumps(RAW).encode()))
    links = graph.adjacency()

    assert [n for n, _, _ in links[1]] == [2]
    assert [n for n, _, _ in links[2]] == [1]
    # the reverse traversal is flagged, so the caller can ask for the right slope
    assert links[2][0][2] is True


def test_a_self_loop_is_not_listed_twice() -> None:
    graph = RoadGraph_with_loop()
    links = graph.adjacency()

    assert len(links[1]) == 1


def RoadGraph_with_loop():  # noqa: N802 - reads as a fixture at the call site
    from athena.graph import RoadGraph

    return RoadGraph(nodes=(node(1, 0),), edges=(edge("1:0", 1, 1, 500),))
