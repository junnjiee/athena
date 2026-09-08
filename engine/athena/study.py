"""One route study: marked ground in, corridors out.

This is the S2 half of the engine's job, and deliberately all of it that is
deterministic. Enemy intent, ranking and the courses of action themselves come
later and sit on top of what this produces; nothing here guesses.
"""

from pydantic import BaseModel, Field

from athena.corridors import cluster_into_corridors
from athena.graph import RoadGraph, nearest_node
from athena.params import CORRIDOR_SIMILARITY, MAX_SHARING, MAX_STRETCH, ROUTES_PER_PAIR
from athena.routing import Route, find_diverse_routes


class Mark(BaseModel):
    """A point the operator placed: a suspected reserve, or an objective."""

    id: str
    name: str
    lon: float
    lat: float


class RouteOut(BaseModel):
    """One approach, with the pair it was found for."""

    reserve_id: str
    objective_id: str
    edge_ids: list[str]
    node_ids: list[int]
    seconds: float
    length_meters: float


class CorridorOut(BaseModel):
    id: str
    routes: list[RouteOut]
    choke_edge_ids: list[str]
    fastest_seconds: float


class UnreachablePair(BaseModel):
    """A pair with no route at all. Reported rather than dropped: 'we found no
    way in' is a finding, and silently omitting it reads as 'no threat'."""

    reserve_id: str
    objective_id: str
    reason: str


class StudyResult(BaseModel):
    corridors: list[CorridorOut]
    unreachable: list[UnreachablePair] = Field(default_factory=list)


def run_study(
    graph: RoadGraph,
    reserves: list[Mark],
    objectives: list[Mark],
    k: int = ROUTES_PER_PAIR,
    max_stretch: float = MAX_STRETCH,
    max_sharing: float = MAX_SHARING,
    similarity: float = CORRIDOR_SIMILARITY,
) -> StudyResult:
    """Routes every reserve to every objective, then groups the lot.

    Corridors are clustered across all pairs rather than per pair, because two
    reserves feeding the same valley are using one approach, and a commander
    blocking it blocks both.
    """
    routes: list[Route] = []
    attribution: dict[int, tuple[str, str]] = {}
    unreachable: list[UnreachablePair] = []

    for reserve in reserves:
        start = nearest_node(graph, reserve.lon, reserve.lat)
        for objective in objectives:
            goal = nearest_node(graph, objective.lon, objective.lat)
            if start is None or goal is None:
                unreachable.append(
                    UnreachablePair(
                        reserve_id=reserve.id,
                        objective_id=objective.id,
                        reason="no road network near this mark",
                    )
                )
                continue

            found = find_diverse_routes(
                graph,
                start.id,
                goal.id,
                k=k,
                max_stretch=max_stretch,
                max_sharing=max_sharing,
            )
            if not found:
                unreachable.append(
                    UnreachablePair(
                        reserve_id=reserve.id,
                        objective_id=objective.id,
                        reason="no drivable route between these marks",
                    )
                )
                continue

            for route in found:
                attribution[id(route)] = (reserve.id, objective.id)
                routes.append(route)

    corridors = []
    for corridor in cluster_into_corridors(routes, similarity=similarity):
        corridors.append(
            CorridorOut(
                id=corridor.id,
                choke_edge_ids=list(corridor.choke_edge_ids),
                fastest_seconds=corridor.fastest_seconds,
                routes=[
                    RouteOut(
                        reserve_id=attribution[id(route)][0],
                        objective_id=attribution[id(route)][1],
                        edge_ids=[edge.id for edge in route.edges],
                        node_ids=list(route.nodes),
                        seconds=route.seconds,
                        length_meters=route.length_meters,
                    )
                    for route in corridor.routes
                ],
            )
        )

    return StudyResult(corridors=corridors, unreachable=unreachable)
