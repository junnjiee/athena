"""The road graph the server builds, and the shape it takes in the engine.

The wire format is gzipped JSON (see ``server/src/services/graphWire.ts``).
Field names mirror the server's ``RoadGraph`` exactly, so the contract is
readable from either side without a translation table.
"""

import gzip
import json
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field


class RoadClass(StrEnum):
    """OSM's own granularity, kept because a motorway and a residential street
    do not carry a column at the same speed."""

    MOTORWAY = "motorway"
    TRUNK = "trunk"
    PRIMARY = "primary"
    SECONDARY = "secondary"
    TERTIARY = "tertiary"
    RESIDENTIAL = "residential"
    UNCLASSIFIED = "unclassified"
    SERVICE = "service"
    LIVING_STREET = "living_street"
    TRACK = "track"


class Node(BaseModel):
    """A junction, or the free end of a road."""

    model_config = ConfigDict(frozen=True)

    id: int
    lon: float
    lat: float
    elevation: float


class Edge(BaseModel):
    """One stretch of road between two junctions, shape points retained."""

    model_config = ConfigDict(frozen=True)

    id: str
    way_id: int = Field(alias="wayId")
    from_node: int = Field(alias="from")
    to_node: int = Field(alias="to")
    road_class: RoadClass = Field(alias="roadClass")
    # Source metadata for the operator-facing code. Routing deliberately does
    # not use either field, and old stored graphs legitimately omit them.
    name: str | None = None
    lanes: str | None = None
    # A destroyed axis stays in the snapshot for display, naming and revision
    # comparison, but adjacency omits it so no route can traverse it.
    destroyed: bool = False
    nodes: tuple[int, ...]
    points: tuple[tuple[float, float], ...]
    length_meters: float = Field(alias="lengthMeters")

    def gradient(self, nodes: dict[int, Node], reverse: bool = False) -> float:
        """Rise over run, signed so uphill is positive for the stated direction."""
        if self.length_meters <= 0:
            return 0.0
        start, end = self.from_node, self.to_node
        if reverse:
            start, end = end, start
        return (nodes[end].elevation - nodes[start].elevation) / self.length_meters


class RoadGraph(BaseModel):
    """Nodes and edges as the server ordered them.

    Edges are undirected: a reinforcing enemy does not respect one-way
    signage, so every edge is traversable both ways and only the sign of the
    gradient changes.
    """

    model_config = ConfigDict(frozen=True, populate_by_name=True)

    nodes: tuple[Node, ...]
    edges: tuple[Edge, ...]

    def nodes_by_id(self) -> dict[int, Node]:
        return {node.id: node for node in self.nodes}

    def adjacency(self) -> dict[int, list[tuple[int, Edge, bool]]]:
        """``node id -> [(neighbour, edge, reversed)]``.

        ``reversed`` says the edge is being walked against its stored
        direction, which is what lets the caller ask for the right gradient
        without rebuilding the edge.
        """
        links: dict[int, list[tuple[int, Edge, bool]]] = {node.id: [] for node in self.nodes}
        for edge in self.edges:
            if edge.destroyed:
                continue
            links[edge.from_node].append((edge.to_node, edge, False))
            if edge.to_node != edge.from_node:
                links[edge.to_node].append((edge.from_node, edge, True))
        return links


def decode_graph(packed: bytes) -> RoadGraph:
    """Inflates the server's stored graph."""
    return RoadGraph.model_validate(json.loads(gzip.decompress(packed)))


def nearest_node(graph: RoadGraph, lon: float, lat: float) -> Node | None:
    """The junction closest to a marked point.

    An operator marks a reserve location or an objective on the map, not on a
    junction, so every mark has to be snapped onto the network before it can be
    routed from. Distance is equirectangular, projected at the mark's own
    latitude -- exact enough at operational scale to pick the same node any
    other method would.
    """
    # Destroyed edges retain their nodes for display and revision comparison.
    # Snapping to a node with no live adjacency would strand the mark on a road
    # the operator explicitly removed from movement.
    links = graph.adjacency()
    candidates = [node for node in graph.nodes if links.get(node.id)]
    if not candidates:
        return None

    import math

    lon_scale = math.cos(math.radians(lat))

    def offset(node: Node) -> float:
        dx = (node.lon - lon) * lon_scale
        dy = node.lat - lat
        return dx * dx + dy * dy

    # Ties break on node id so a mark equidistant from two junctions always
    # snaps to the same one.
    return min(candidates, key=lambda node: (offset(node), node.id))
