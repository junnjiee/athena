"""One route study: marked ground in, corridors out.

This is the S2 half of the engine's job, and deliberately all of it that is
deterministic. Enemy intent, ranking and the courses of action themselves come
later and sit on top of what this produces; nothing here guesses.
"""

from enum import StrEnum

from pydantic import BaseModel, Field

from athena.corridors import cluster_into_corridors
from athena.graph import RoadGraph, nearest_node
from athena.params import (
    CORRIDOR_DETOUR_RATIO,
    CORRIDOR_MAX_HEADING_DEGREES,
    CORRIDOR_SEPARATION_METERS,
    MAX_SHARING,
    MAX_STRETCH,
    ROUTES_PER_PAIR,
)
from athena.routing import Route, find_diverse_routes


class ReserveLevel(StrEnum):
    OUTSIDE_ACTIVITIES = "K"
    LOCAL_REINFORCEMENT = "K1"
    COMPANY_RESERVE = "K2"
    BATTALION_RESERVE = "K3"
    DIVISION_RESERVE = "K4"


class IntelligenceStatus(StrEnum):
    ASSESSED = "assessed"
    CONFIRMED = "confirmed"


class AggressorEchelon(StrEnum):
    DIVISION = "division"
    REGIMENT = "regiment"
    BATTALION = "battalion"
    COMPANY = "company"
    PLATOON = "platoon"
    SECTION = "section"


class CompositionModifier(StrEnum):
    EQUAL = "="
    MINUS = "-"
    FULL = "full"
    PLUS = "+"

    @property
    def thirds(self) -> int:
        return {"=": 1, "-": 2, "full": 3, "+": 4}[self.value]


class PlatformCount(BaseModel):
    id: str
    platform: str
    establishment_count: int = Field(ge=1)

    def effective_fraction(self, modifier: CompositionModifier) -> tuple[int, int]:
        numerator = self.establishment_count * modifier.thirds
        divisor = 3 if numerator % 3 == 0 else 1
        return numerator // divisor, 3 // divisor


class TaskOrganizationElement(BaseModel):
    id: str
    designation: str
    echelon: AggressorEchelon
    modifier: CompositionModifier = CompositionModifier.FULL
    order_of_move: int = Field(ge=1)
    platforms: list[PlatformCount] = Field(default_factory=list)


class ReserveTiming(BaseModel):
    """Doctrinal reserve timings, normalized to minutes by the operator.

    Source material expresses some levels in minutes and others in fractions of
    an hour. Keeping the stored unit uniform makes the arithmetic explicit while
    allowing incomplete assessments to remain incomplete instead of silently
    treating an unknown stage as zero.
    """

    decision_minutes: float | None = Field(default=None, ge=0)
    readiness_minutes: float | None = Field(default=None, ge=0)
    deployment_minutes: float | None = Field(default=None, ge=0)

    def commencement_minutes(self) -> float | None:
        if self.decision_minutes is None or self.readiness_minutes is None:
            return None
        return self.decision_minutes + self.readiness_minutes

    def task_complete_minutes(self, movement_seconds: float) -> float | None:
        commencement = self.commencement_minutes()
        if commencement is None or self.deployment_minutes is None:
            return None
        return commencement + movement_seconds / 60 + self.deployment_minutes


class Mark(BaseModel):
    """A point the operator placed: a suspected reserve, or an objective."""

    id: str
    name: str
    lon: float
    lat: float
    level: ReserveLevel | None = None
    owning_formation: str | None = None
    intelligence_status: IntelligenceStatus | None = None
    locality: str | None = None
    task_organization: list[TaskOrganizationElement] = Field(default_factory=list)
    timing: ReserveTiming | None = None


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
    separation_meters: float = CORRIDOR_SEPARATION_METERS,
    max_heading_degrees: float = CORRIDOR_MAX_HEADING_DEGREES,
    detour_ratio: float = CORRIDOR_DETOUR_RATIO,
    excluded_edge_ids: frozenset[str] = frozenset(),
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
                excluded=excluded_edge_ids,
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
    for corridor in cluster_into_corridors(
        routes,
        graph,
        separation_meters=separation_meters,
        max_heading_degrees=max_heading_degrees,
        detour_ratio=detour_ratio,
    ):
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
