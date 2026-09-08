"""Hand-built graphs small enough that the right answer is known by inspection."""

import pytest

from athena.graph import Edge, Node, RoadGraph

METERS_PER_DEGREE = 111_320.0


def node(node_id: int, x: float, y: float = 0.0, elevation: float = 0.0) -> Node:
    """Places a node on a degree lattice at the equator, one unit ~ 111 km."""
    return Node(id=node_id, lon=x, lat=y, elevation=elevation)


def edge(
    edge_id: str,
    a: int,
    b: int,
    length: float,
    road_class: str = "secondary",
) -> Edge:
    return Edge.model_validate(
        {
            "id": edge_id,
            "wayId": int(edge_id.split(":")[0]),
            "from": a,
            "to": b,
            "roadClass": road_class,
            "nodes": [a, b],
            "points": [[0.0, 0.0], [0.0, 0.0]],
            "lengthMeters": length,
        }
    )


@pytest.fixture
def ladder() -> RoadGraph:
    """Two independent ways from 1 to 4, plus a rung joining their middles.

        2 ---- 3
      /  |      \
    1    |rung   4
      \  |      /
        5 ---- 6

    The northern and southern arms are genuinely different approaches; the
    rung lets a path mix them, which is what tests diversity rules.
    """
    return RoadGraph(
        nodes=(node(1, 0), node(2, 1), node(3, 2), node(4, 3), node(5, 1, -1), node(6, 2, -1)),
        edges=(
            edge("1:0", 1, 2, 1000),
            edge("1:1", 2, 3, 1000),
            edge("1:2", 3, 4, 1000),
            edge("2:0", 1, 5, 1000),
            edge("2:1", 5, 6, 1400),
            edge("2:2", 6, 4, 1000),
            edge("3:0", 2, 5, 800),
        ),
    )


@pytest.fixture
def corridor_pair() -> RoadGraph:
    """Two long, entirely separate routes from 1 to 9, sharing only their ends.

    One runs fast (trunk), the other slow (track), so ranking and clustering
    have something unambiguous to separate.
    """
    return RoadGraph(
        nodes=(
            node(1, 0),
            node(2, 1, 1),
            node(3, 2, 1),
            node(4, 3, 1),
            node(5, 1, -1),
            node(6, 2, -1),
            node(7, 3, -1),
            node(9, 4),
        ),
        edges=(
            edge("10:0", 1, 2, 1000, "trunk"),
            edge("10:1", 2, 3, 1000, "trunk"),
            edge("10:2", 3, 4, 1000, "trunk"),
            edge("10:3", 4, 9, 1000, "trunk"),
            edge("20:0", 1, 5, 1000, "track"),
            edge("20:1", 5, 6, 1000, "track"),
            edge("20:2", 6, 7, 1000, "track"),
            edge("20:3", 7, 9, 1000, "track"),
        ),
    )
