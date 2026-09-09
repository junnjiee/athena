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
    r"""Two independent ways from 1 to 4, plus a rung joining their middles.

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
def parallel_axes() -> RoadGraph:
    """Two roads running the same way, 2.2 km apart, joined by rungs.

        1 -- 2 -- 3 -- 4      north
             |    |
        5 -- 6 -- 7 -- 8      south

    They share no edge whatever, so shared-length similarity scores them zero.
    They are plainly one corridor: same direction, close together, and you can
    cross between them wherever you like.
    """
    return RoadGraph(
        nodes=(
            node(1, 0.00, 0.02), node(2, 0.02, 0.02), node(3, 0.04, 0.02), node(4, 0.06, 0.02),
            node(5, 0.00, 0.00), node(6, 0.02, 0.00), node(7, 0.04, 0.00), node(8, 0.06, 0.00),
        ),
        edges=(
            edge("10:0", 1, 2, 2226), edge("10:1", 2, 3, 2226), edge("10:2", 3, 4, 2226),
            edge("20:0", 5, 6, 2226), edge("20:1", 6, 7, 2226), edge("20:2", 7, 8, 2226),
            edge("30:0", 2, 6, 2226), edge("30:1", 3, 7, 2226),
        ),
    )


@pytest.fixture
def severed_axes() -> RoadGraph:
    r"""Two roads 2.2 km apart, around opposite sides of an obstacle.

           1 -- 2 -- 3          north
          /            \
        0                8
          \            /
           5 -- 6 -- 7          south

    The reservoir case, and it shares both endpoints the way real routes from
    one reserve to one objective do. Node 2 and node 6 are 2.2 km apart, but
    crossing between them means going 34 km back round through 0, because the
    water is in the way and there are no roads across it.

    The shared endpoints are why connectivity has to be measured between the
    middles of two axes: measured at the ends it is always zero, which would
    merge every approach into one.
    """
    return RoadGraph(
        nodes=(
            node(0, -0.15, 0.01), node(8, 0.19, 0.01),
            node(1, 0.00, 0.02), node(2, 0.02, 0.02), node(3, 0.04, 0.02),
            node(5, 0.00, 0.00), node(6, 0.02, 0.00), node(7, 0.04, 0.00),
        ),
        edges=(
            edge("10:0", 0, 1, 15_000), edge("10:1", 1, 2, 2226),
            edge("10:2", 2, 3, 2226), edge("10:3", 3, 8, 15_000),
            edge("20:0", 0, 5, 15_000), edge("20:1", 5, 6, 2226),
            edge("20:2", 6, 7, 2226), edge("20:3", 7, 8, 15_000),
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
