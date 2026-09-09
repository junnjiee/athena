"""Bundling axes into the approaches a commander would name.

An axis is one route through the ground. A corridor is a *bundle* of axes: the
set that together forms one approach, from the same place to the same place
through the same gap.

Grouping is on how the axes lie, never on tarmac they share. Two roads either
side of the same gap share no segment whatever and are plainly one approach, so
shared length is the wrong question -- it was the old rule here, and it split
every such pair in two.

Three things make two axes one corridor: they run close, they point the same
way, and you can cross between them along their length. The third does the
separating, and it needs no terrain data: where ground is impassable there are
no roads over it, so an obstacle shows up as a long way round.
"""

import hashlib
import heapq
import math
import statistics
from dataclasses import dataclass

from athena.graph import Node, RoadGraph
from athena.params import (
    CORRIDOR_DETOUR_RATIO,
    CORRIDOR_MAX_HEADING_DEGREES,
    CORRIDOR_SEPARATION_METERS,
)
from athena.routing import Route


@dataclass(frozen=True)
class Corridor:
    """One approach, and the ground every route through it must cross."""

    id: str
    routes: tuple[Route, ...]
    choke_edge_ids: tuple[str, ...]
    fastest_seconds: float


METERS_PER_DEGREE = 111_320.0


def _route_positions(route: Route, nodes: dict[int, Node]) -> list[Node]:
    positions = [nodes[node_id] for node_id in route.nodes if node_id in nodes]
    if route.terminal is not None:
        positions.append(
            Node(
                id=-1,
                lon=route.terminal.lon,
                lat=route.terminal.lat,
                elevation=0.0,
            )
        )
    return positions


def _meters_between(one: Node, other: Node) -> float:
    """Equirectangular, projected at the latitude of the pair.

    Exact enough at operational scale, and it keeps the module free of a
    geodesy dependency for a comparison that only has to rank.
    """
    lat_scale = math.cos(math.radians((one.lat + other.lat) / 2))
    dx = (one.lon - other.lon) * lat_scale
    dy = one.lat - other.lat
    return math.hypot(dx, dy) * METERS_PER_DEGREE


def axis_separation_meters(
    one: Route,
    other: Route,
    nodes: dict[int, Node],
) -> float:
    """How far apart two axes run, in metres.

    Every node of each axis is measured to the nearest node of the other, and
    the median of those is taken. Median rather than minimum because two
    approaches that merely touch at a shared objective are not thereby close
    along their length, and minimum would say they were.
    """
    here = _route_positions(one, nodes)
    there = _route_positions(other, nodes)
    if not here or not there:
        return math.inf

    nearest = [min(_meters_between(a, b) for b in there) for a in here]
    nearest += [min(_meters_between(b, a) for a in here) for b in there]
    return statistics.median(nearest)


def axis_heading_difference_degrees(
    one: Route,
    other: Route,
    nodes: dict[int, Node],
) -> float:
    """Difference between the axes' start-to-finish travel headings.

    Direction is intentional. Two routes using the same road in opposite
    directions are not the same enemy approach, and two close roads crossing
    at right angles are not a parallel bundle. A route without spatial extent
    has no defensible heading and therefore aligns with nothing else.
    """

    def vector(route: Route) -> tuple[float, float] | None:
        positions = _route_positions(route, nodes)
        if not positions:
            return None
        start, end = positions[0], positions[-1]
        lat_scale = math.cos(math.radians((start.lat + end.lat) / 2))
        dx = (end.lon - start.lon) * lat_scale
        dy = end.lat - start.lat
        length = math.hypot(dx, dy)
        return None if length == 0 else (dx / length, dy / length)

    first = vector(one)
    second = vector(other)
    if first is None or second is None:
        return math.inf
    cosine = max(-1.0, min(1.0, first[0] * second[0] + first[1] * second[1]))
    return math.degrees(math.acos(cosine))


def _network_meters(graph: RoadGraph, start: int, goal: int) -> float:
    """Shortest driving distance between two junctions, or infinity."""
    if start == goal:
        return 0.0
    links = graph.adjacency()
    if start not in links or goal not in links:
        return math.inf

    best: dict[int, float] = {start: 0.0}
    queue = [(0.0, start)]
    while queue:
        cost, here = heapq.heappop(queue)
        if here == goal:
            return cost
        if cost > best.get(here, math.inf):
            continue
        for neighbour, edge_, _ in links[here]:
            through = cost + edge_.length_meters
            if through < best.get(neighbour, math.inf):
                best[neighbour] = through
                heapq.heappush(queue, (through, neighbour))
    return math.inf


def lateral_detour_ratio(one: Route, other: Route, graph: RoadGraph) -> float:
    """How far round you must drive to cross between two axes, over how far
    apart they actually are.

    Measured between the **middles** of the two axes, never their ends. Routes
    from one reserve to one objective share both endpoints, so an end-measured
    distance is always zero and would merge every approach into one.

    A rung between two parallel roads gives a ratio near 1. Water with no road
    across it gives a large one, because the network has to go round -- which is
    how an obstacle is detected without any terrain data at all.
    """
    here = [n for n in one.nodes if n in graph.nodes_by_id()]
    there = [n for n in other.nodes if n in graph.nodes_by_id()]
    if not here or not there:
        return math.inf

    mid_one, mid_other = here[len(here) // 2], there[len(there) // 2]
    nodes = graph.nodes_by_id()
    straight = _meters_between(nodes[mid_one], nodes[mid_other])
    if straight <= 0:
        return 0.0
    return _network_meters(graph, mid_one, mid_other) / straight


def _corridor_id(routes: tuple[Route, ...]) -> str:
    """Derived from the ground covered, never generated.

    An operator's renaming and categorisation attach to this id, and the
    feedback loop needs it stable across runs, so re-running the search over
    unchanged ground must reproduce it exactly.
    """
    edge_ids = sorted({edge.id for route in routes for edge in route.edges})
    digest = hashlib.sha256("|".join(edge_ids).encode()).hexdigest()
    return f"cor_{digest[:16]}"


def cluster_into_corridors(
    routes: list[Route],
    graph: RoadGraph,
    separation_meters: float = CORRIDOR_SEPARATION_METERS,
    max_heading_degrees: float = CORRIDOR_MAX_HEADING_DEGREES,
    detour_ratio: float = CORRIDOR_DETOUR_RATIO,
) -> list[Corridor]:
    """Bundles axes into corridors.

    Single-link agglomerative, so belonging is transitive through the group.
    That suits an approach that bends: the two ends of a long corridor may lie
    far apart while both clearly belong to the middle.
    """
    if not routes:
        return []

    parent = list(range(len(routes)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    nodes = graph.nodes_by_id()

    def same_corridor(one: Route, other: Route) -> bool:
        if axis_separation_meters(one, other, nodes) > separation_meters:
            return False
        if axis_heading_difference_degrees(one, other, nodes) > max_heading_degrees:
            return False
        return lateral_detour_ratio(one, other, graph) <= detour_ratio

    for i in range(len(routes)):
        for j in range(i + 1, len(routes)):
            if same_corridor(routes[i], routes[j]):
                parent[find(i)] = find(j)

    groups: dict[int, list[Route]] = {}
    for index, route in enumerate(routes):
        groups.setdefault(find(index), []).append(route)

    corridors: list[Corridor] = []
    for members in groups.values():
        ordered = tuple(sorted(members, key=lambda r: (r.seconds, sorted(r.edge_ids))))
        shared: frozenset[str] = ordered[0].edge_ids
        for route in ordered[1:]:
            shared &= route.edge_ids
        # Ordered along the fastest route, so the choke reads in the direction
        # of travel rather than as an arbitrary set.
        choke = tuple(edge.id for edge in ordered[0].edges if edge.id in shared)
        corridors.append(
            Corridor(
                id=_corridor_id(ordered),
                routes=ordered,
                choke_edge_ids=choke,
                fastest_seconds=ordered[0].seconds,
            )
        )

    corridors.sort(key=lambda c: (c.fastest_seconds, c.id))
    return corridors
