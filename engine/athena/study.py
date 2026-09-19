"""One route study: marked ground in, corridors out.

This is the S2 half of the engine's job, and deliberately all of it that is
deterministic. Enemy intent, ranking and the courses of action themselves come
later and sit on top of what this produces; nothing here guesses.
"""

import math
from enum import StrEnum

from pydantic import BaseModel, Field, field_validator, model_validator

from athena.corridors import cluster_into_corridors
from athena.graph import Edge, RoadGraph, nearest_node
from athena.params import (
    CORRIDOR_DETOUR_RATIO,
    CORRIDOR_MAX_HEADING_DEGREES,
    CORRIDOR_SEPARATION_METERS,
    MAX_SHARING,
    MAX_STRETCH,
    ROUTES_PER_PAIR,
)
from athena.routing import EdgeGoal, Route, find_diverse_routes_to_any


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


class IntelligenceEvidence(BaseModel):
    """A bounded excerpt retained after an operator accepts a model proposal."""

    source_document_id: str = Field(min_length=1, max_length=120)
    source_document_name: str = Field(min_length=1, max_length=240)
    excerpt: str = Field(min_length=1, max_length=500)


class MarkBounds(BaseModel):
    """Geographic ground occupied by an area objective."""

    west: float = Field(ge=-180, le=180)
    south: float = Field(ge=-85, le=85)
    east: float = Field(ge=-180, le=180)
    north: float = Field(ge=-85, le=85)

    @model_validator(mode="after")
    def has_area(self) -> "MarkBounds":
        if self.north <= self.south:
            raise ValueError("objective bounds north must be above south")
        if self.east == self.west:
            raise ValueError("objective bounds must have longitude width")
        return self

    def contains(self, lon: float, lat: float) -> bool:
        if not self.south <= lat <= self.north:
            return False
        if self.west <= self.east:
            return self.west <= lon <= self.east
        return lon >= self.west or lon <= self.east

    def clip_segment(
        self,
        start: tuple[float, float],
        end: tuple[float, float],
    ) -> tuple[float, float] | None:
        """Fractions of a line segment lying inside this geographic box.

        Longitudes are unwrapped around an antimeridian-spanning objective so
        the short segment through ±180° is clipped instead of the long way
        around the globe.
        """
        west, east = self.west, self.east
        start_lon, end_lon = start[0], end[0]
        if west > east:
            east += 360
            if start_lon < west - 180:
                start_lon += 360
            if end_lon < west - 180:
                end_lon += 360
        if end_lon - start_lon > 180:
            end_lon -= 360
        elif start_lon - end_lon > 180:
            end_lon += 360

        enter, leave = 0.0, 1.0
        for origin, delta, lower, upper in (
            (start_lon, end_lon - start_lon, west, east),
            (start[1], end[1] - start[1], self.south, self.north),
        ):
            if abs(delta) <= 1e-15:
                if origin < lower or origin > upper:
                    return None
                continue
            first = (lower - origin) / delta
            second = (upper - origin) / delta
            enter = max(enter, min(first, second))
            leave = min(leave, max(first, second))
            if enter > leave:
                return None
        return enter, leave


class Mark(BaseModel):
    """A suspected reserve point or an objective point/area."""

    id: str
    name: str
    lon: float
    lat: float
    owning_formation: str | None = None
    intelligence_status: IntelligenceStatus | None = None
    intelligence_evidence: list[IntelligenceEvidence] = Field(
        default_factory=list, max_length=20
    )
    locality: str | None = None
    task_organization: list[TaskOrganizationElement] = Field(default_factory=list)
    timing: ReserveTiming | None = None
    bbox: MarkBounds | None = None

    @field_validator("intelligence_evidence")
    @classmethod
    def evidence_sources_are_unique(
        cls, evidence: list[IntelligenceEvidence]
    ) -> list[IntelligenceEvidence]:
        source_ids = [item.source_document_id for item in evidence]
        if len(source_ids) != len(set(source_ids)):
            raise ValueError("intelligence evidence source ids must be unique")
        return evidence


def _segment_meters(
    start: tuple[float, float], end: tuple[float, float]
) -> float:
    latitude = (start[1] + end[1]) / 2
    delta_lon = end[0] - start[0]
    if delta_lon > 180:
        delta_lon -= 360
    elif delta_lon < -180:
        delta_lon += 360
    return math.hypot(
        delta_lon * math.cos(math.radians(latitude)) * 111_320.0,
        (end[1] - start[1]) * 111_320.0,
    )


def _edge_entry_goal(
    edge: Edge,
    bounds: MarkBounds,
    reverse: bool,
) -> EdgeGoal | None:
    """First point at which one direction of an edge enters objective ground."""
    if len(edge.points) < 2:
        return None
    points = list(reversed(edge.points)) if reverse else list(edge.points)
    if bounds.contains(*points[0]):
        return None

    segment_lengths = [
        _segment_meters(start, end) for start, end in zip(points, points[1:])
    ]
    shape_length = sum(segment_lengths)
    if shape_length <= 0:
        return None

    traversed = 0.0
    for (start, end), segment_length in zip(zip(points, points[1:]), segment_lengths):
        clipped = bounds.clip_segment(start, end)
        if clipped is not None:
            entry = clipped[0]
            distance = traversed + segment_length * entry
            travelled_fraction = distance / shape_length
            if 1e-12 < travelled_fraction < 1 - 1e-12:
                delta_lon = end[0] - start[0]
                if delta_lon > 180:
                    delta_lon -= 360
                elif delta_lon < -180:
                    delta_lon += 360
                lon = start[0] + delta_lon * entry
                if lon > 180:
                    lon -= 360
                elif lon < -180:
                    lon += 360
                stored_fraction = 1 - travelled_fraction if reverse else travelled_fraction
                return EdgeGoal(
                    edge=edge,
                    approach_node=edge.to_node if reverse else edge.from_node,
                    lon=lon,
                    lat=start[1] + (end[1] - start[1]) * entry,
                    edge_fraction=stored_fraction,
                )
        traversed += segment_length
    return None


def _objective_goals(
    graph: RoadGraph, objective: Mark
) -> tuple[frozenset[int], tuple[EdgeGoal, ...]]:
    """Live junctions and road-entry points in ground, or a centre fallback."""
    if objective.bbox is not None:
        links = graph.adjacency()
        inside = frozenset(
            node.id
            for node in graph.nodes
            if links.get(node.id) and objective.bbox.contains(node.lon, node.lat)
        )
        edge_goals = tuple(
            goal
            for edge in graph.edges
            if not edge.destroyed
            for reverse in (False, True)
            if (goal := _edge_entry_goal(edge, objective.bbox, reverse)) is not None
        )
        if inside or edge_goals:
            return inside, edge_goals
    centre = nearest_node(graph, objective.lon, objective.lat)
    return (
        frozenset({centre.id}) if centre is not None else frozenset(),
        (),
    )


class RouteTerminalOut(BaseModel):
    """Exact endpoint on the final edge of an area-objective route."""

    edge_id: str
    lon: float
    lat: float
    edge_fraction: float = Field(ge=0, le=1)


class RouteOut(BaseModel):
    """One approach, with the pair it was found for."""

    reserve_id: str
    objective_id: str
    edge_ids: list[str]
    node_ids: list[int]
    seconds: float
    length_meters: float
    terminal: RouteTerminalOut | None = None


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
            goals, edge_goals = _objective_goals(graph, objective)
            if start is None or (not goals and not edge_goals):
                unreachable.append(
                    UnreachablePair(
                        reserve_id=reserve.id,
                        objective_id=objective.id,
                        reason="no road network near this mark",
                    )
                )
                continue

            found = find_diverse_routes_to_any(
                graph,
                start.id,
                goals,
                k=k,
                max_stretch=max_stretch,
                max_sharing=max_sharing,
                excluded=excluded_edge_ids,
                edge_goals=edge_goals,
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
                        terminal=(
                            RouteTerminalOut(
                                edge_id=route.terminal.edge_id,
                                lon=route.terminal.lon,
                                lat=route.terminal.lat,
                                edge_fraction=route.terminal.edge_fraction,
                            )
                            if route.terminal is not None
                            else None
                        ),
                    )
                    for route in corridor.routes
                ],
            )
        )

    return StudyResult(corridors=corridors, unreachable=unreachable)
