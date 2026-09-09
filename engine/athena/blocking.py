"""Which forces a commander can put on which inlet.

The S3 half of the engine's job. Given the corridors the S2 side derived and
the ORBAT actually available, this says what could block what — and, just as
importantly, what nothing can block.

It does not model arrival time. A block force here is one a commander *could*
commit to that ground, not one that gets there first. Ordering by distance is a
convenience for reading the options, not a claim about who wins the race; that
judgement stays with the human. See ENGINE.md's known limits.
"""

import hashlib
import math
from enum import StrEnum
from fractions import Fraction

from pydantic import BaseModel, Field

from athena.graph import Edge, RoadGraph
from athena.orbat import Orbat, Unit, WeaponSystem
from athena.routing import edge_travel_seconds
from athena.study import CorridorOut, Mark, RouteOut
from athena.targeting import Effect, Hardness, TargetClass, lookup_platform, match_weapon
from athena.units import Echelon


class BlockWeapon(BaseModel):
    """Aggregated weapon count for one task-organised block force."""

    weapon: WeaponSystem
    count: int = Field(ge=1)


class BlockPointInput(BaseModel):
    """An operator's requested contact point, snapped to one known inlet."""

    inlet_id: str = Field(min_length=1, max_length=120)
    lon: float = Field(ge=-180, le=180)
    lat: float = Field(ge=-85, le=85)


class BlockPoint(BaseModel):
    inlet_id: str
    lon: float = Field(ge=-180, le=180)
    lat: float = Field(ge=-85, le=85)
    enemy_movement_seconds: float = Field(ge=0)
    snap_distance_meters: float = Field(ge=0)


class NearestInletPoint(BaseModel):
    """Ground point used by a straight-line candidate distance."""

    lon: float = Field(ge=-180, le=180)
    lat: float = Field(ge=-85, le=85)


class BlockCandidate(BaseModel):
    """One force that could be put on one inlet."""

    unit_id: str
    unit_name: str
    echelon: Echelon
    weapons: list[BlockWeapon]
    """Straight-line metres from the unit to the inlet, not road distance
    and not travel time."""
    distance_meters: float
    nearest_point: NearestInletPoint


class InletBlock(BaseModel):
    """One axis/inlet and every force that could be put on it, nearest first."""

    inlet_id: str
    corridor_id: str
    inlet_number: int
    reserve_id: str
    objective_id: str
    edge_ids: list[str]
    movement_seconds: float = Field(ge=0)
    candidates: list[BlockCandidate]


class Allocation(BaseModel):
    """One inlet covered by one force, in a plan where no force is used twice."""

    inlet_id: str
    corridor_id: str
    unit_id: str
    unit_name: str
    distance_meters: float
    nearest_point: NearestInletPoint
    block_point: BlockPoint | None = None


class RejectedBlockPoint(BaseModel):
    inlet_id: str
    reason: str


class DelayAssessmentInput(BaseModel):
    """An operator-assessed delay caused at one inlet."""

    inlet_id: str = Field(min_length=1, max_length=120)
    unit_id: str = Field(min_length=1, max_length=120)
    delay_minutes: float = Field(gt=0, le=10_080)


class RejectedDelayAssessment(BaseModel):
    inlet_id: str
    reason: str


class BlockEstablishmentInput(BaseModel):
    """When one allocated force will be established at its exact block point."""

    inlet_id: str = Field(min_length=1, max_length=120)
    unit_id: str = Field(min_length=1, max_length=120)
    block_point_lon: float = Field(ge=-180, le=180)
    block_point_lat: float = Field(ge=-85, le=85)
    established_minutes: float = Field(ge=0, le=10_080)


class RejectedBlockEstablishment(BaseModel):
    inlet_id: str
    reason: str


class Unblockable(BaseModel):
    """An inlet nothing can be put on, and why."""

    inlet_id: str
    corridor_id: str
    reason: str


class Uncovered(BaseModel):
    """An inlet that could be blocked, but not once the force ran out."""

    inlet_id: str
    corridor_id: str


class ExactCount(BaseModel):
    """A platform quantity retained as an exact reduced fraction."""

    numerator: int = Field(ge=0)
    denominator: int = Field(ge=1)


class AssessedPlatform(BaseModel):
    platform: str
    count: ExactCount


class SealingOutcome(StrEnum):
    DESTROYED = "destroyed_at_block"
    DELAYED = "delayed_and_attrited"
    PASSED = "passed"
    UNKNOWN = "unknown"


class ObjectiveOutcome(StrEnum):
    REACHED = "reached"
    DID_NOT_REACH = "did_not_reach"
    UNKNOWN = "unknown"


class ReactionTimeline(BaseModel):
    """Known and explicitly unknown events on the Reaction to Ops Plan pass."""

    commencement_minutes: float | None = Field(default=None, ge=0)
    contact_minutes: float | None = Field(default=None, ge=0)
    block_established_minutes: float | None = Field(default=None, ge=0)
    block_established_by_contact: bool | None = None
    delay_minutes: float | None = Field(default=None, ge=0)
    remnant_continued: bool | None = None
    objective_arrival_minutes: float | None = Field(default=None, ge=0)
    objective_outcome: ObjectiveOutcome
    unknowns: list[str]


class SealingAssessment(BaseModel):
    """What one allocated force can do to the inlet's reserve composition."""

    inlet_id: str
    corridor_id: str
    reserve_id: str
    reserve_name: str | None = None
    target_hardness: Hardness | None = None
    target_platforms: list[AssessedPlatform]
    target_platform_count: ExactCount | None = None
    effective_weapons: list[BlockWeapon]
    effective_weapon_count: int = Field(ge=0)
    remaining_platform_count: ExactCount | None = None
    outcome: SealingOutcome
    reason: str
    reaction: ReactionTimeline


class BlockPlan(BaseModel):
    inlets: list[InletBlock]
    allocation: list[Allocation]
    unblockable: list[Unblockable]
    uncovered: list[Uncovered]
    sealing: list[SealingAssessment]
    block_points: list[BlockPoint] = Field(default_factory=list)
    rejected_block_points: list[RejectedBlockPoint] = Field(default_factory=list)
    delay_assessments: list[DelayAssessmentInput] = Field(default_factory=list)
    rejected_delay_assessments: list[RejectedDelayAssessment] = Field(
        default_factory=list
    )
    block_establishments: list[BlockEstablishmentInput] = Field(default_factory=list)
    rejected_block_establishments: list[RejectedBlockEstablishment] = Field(
        default_factory=list
    )


def _inlet_id(reserve_id: str, objective_id: str, edge_ids: list[str]) -> str:
    """A stable identity for one route, independent of corridor regrouping."""
    identity = "|".join((reserve_id, objective_id, *edge_ids))
    digest = hashlib.sha256(identity.encode()).hexdigest()
    return f"inlet_{digest[:16]}"


def _clip_points(
    points: list[tuple[float, float]],
    fraction: float,
    endpoint: tuple[float, float],
) -> list[tuple[float, float]]:
    """The oriented shape up to a fractional mid-edge route endpoint."""
    if len(points) < 2:
        return points
    segment_lengths = [
        _segment_meters(start, end) for start, end in zip(points, points[1:])
    ]
    target = sum(segment_lengths) * fraction
    covered = 0.0
    clipped = [points[0]]
    for end, segment_length in zip(points[1:], segment_lengths):
        if covered + segment_length >= target - 1e-9:
            clipped.append(endpoint)
            return clipped
        clipped.append(end)
        covered += segment_length
    clipped[-1] = endpoint
    return clipped


def _route_points(
    edges_by_id: dict[str, Edge], route: RouteOut
) -> list[tuple[float, float]]:
    """Every graph vertex actually traversed by an inlet, in route order."""
    points: list[tuple[float, float]] = []
    for index, edge_id in enumerate(route.edge_ids):
        edge = edges_by_id.get(edge_id)
        if edge is not None:
            reverse = index < len(route.node_ids) and edge.to_node == route.node_ids[index]
            edge_points = list(reversed(edge.points)) if reverse else list(edge.points)
            if (
                route.terminal is not None
                and index == len(route.edge_ids) - 1
                and route.terminal.edge_id == edge_id
            ):
                fraction = (
                    1 - route.terminal.edge_fraction
                    if reverse
                    else route.terminal.edge_fraction
                )
                edge_points = _clip_points(
                    edge_points,
                    fraction,
                    (route.terminal.lon, route.terminal.lat),
                )
            points.extend(edge_points)
    return points


MAX_BLOCK_POINT_SNAP_METERS = 500.0


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


def _project_onto_segment(
    point_lon: float,
    point_lat: float,
    start: tuple[float, float],
    end: tuple[float, float],
) -> tuple[float, float, float, float]:
    """Projected lon, lat, segment fraction, and miss distance in metres."""
    lon_scale = math.cos(math.radians(point_lat)) * 111_320.0
    lat_scale = 111_320.0

    def longitude_delta(lon: float) -> float:
        delta = lon - point_lon
        if delta > 180:
            delta -= 360
        elif delta < -180:
            delta += 360
        return delta

    start_delta = longitude_delta(start[0])
    end_delta = longitude_delta(end[0])
    if end_delta - start_delta > 180:
        end_delta -= 360
    elif start_delta - end_delta > 180:
        end_delta += 360
    start_x = start_delta * lon_scale
    start_y = (start[1] - point_lat) * lat_scale
    end_x = end_delta * lon_scale
    end_y = (end[1] - point_lat) * lat_scale
    dx, dy = end_x - start_x, end_y - start_y
    denominator = dx * dx + dy * dy
    fraction = 0.0 if denominator == 0 else max(
        0.0, min(1.0, -(start_x * dx + start_y * dy) / denominator)
    )
    projected_x = start_x + fraction * dx
    projected_y = start_y + fraction * dy
    return (
        point_lon + projected_x / lon_scale if lon_scale else point_lon,
        start[1] + fraction * (end[1] - start[1]),
        fraction,
        math.hypot(projected_x, projected_y),
    )


def _locate_block_point(
    route: RouteOut,
    requested: BlockPointInput,
    edges_by_id: dict[str, Edge],
    graph: RoadGraph,
) -> BlockPoint | None:
    """Snap an operator click to the inlet and recover enemy movement time."""
    nodes = graph.nodes_by_id()
    elapsed_seconds = 0.0
    best: BlockPoint | None = None
    previous: tuple[float, float] | None = None

    for index, edge_id in enumerate(route.edge_ids):
        edge = edges_by_id.get(edge_id)
        if edge is None:
            continue
        if index < len(route.node_ids):
            reverse = edge.to_node == route.node_ids[index]
        elif previous is not None:
            reverse = _segment_meters(previous, edge.points[-1]) < _segment_meters(
                previous, edge.points[0]
            )
        else:
            reverse = False
        points = list(reversed(edge.points)) if reverse else list(edge.points)
        travel_seconds = edge_travel_seconds(edge, nodes, reverse=reverse)
        if travel_seconds is None or len(points) < 2:
            continue
        if (
            route.terminal is not None
            and index == len(route.edge_ids) - 1
            and route.terminal.edge_id == edge_id
        ):
            fraction = (
                1 - route.terminal.edge_fraction
                if reverse
                else route.terminal.edge_fraction
            )
            points = _clip_points(
                points,
                fraction,
                (route.terminal.lon, route.terminal.lat),
            )
            travel_seconds *= fraction
        segment_lengths = [
            _segment_meters(start, end) for start, end in zip(points, points[1:])
        ]
        shape_length = sum(segment_lengths)
        traversed = 0.0
        for (start, end), segment_length in zip(zip(points, points[1:]), segment_lengths):
            lon, lat, fraction, miss = _project_onto_segment(
                requested.lon, requested.lat, start, end
            )
            if lon > 180:
                lon -= 360
            elif lon < -180:
                lon += 360
            movement = elapsed_seconds
            if shape_length > 0:
                movement += travel_seconds * (
                    traversed + segment_length * fraction
                ) / shape_length
            candidate = BlockPoint(
                inlet_id=requested.inlet_id,
                lon=lon,
                lat=lat,
                enemy_movement_seconds=movement,
                snap_distance_meters=miss,
            )
            if best is None or candidate.snap_distance_meters < best.snap_distance_meters:
                best = candidate
            traversed += segment_length
        elapsed_seconds += travel_seconds
        previous = points[-1]

    if best is None or best.snap_distance_meters > MAX_BLOCK_POINT_SNAP_METERS:
        return None
    return best


def _nearest_inlet_point(
    unit: Unit, points: list[tuple[float, float]]
) -> tuple[float, NearestInletPoint]:
    """Distance and exact nearest point on the inlet polyline.

    Equirectangular at the unit's own latitude: exact enough to order candidates
    over an operational box, and never presented as anything finer.
    """
    if not points:
        return math.inf, NearestInletPoint(lon=unit.lon, lat=unit.lat)
    if len(points) == 1:
        return (
            _segment_meters((unit.lon, unit.lat), points[0]),
            NearestInletPoint(lon=points[0][0], lat=points[0][1]),
        )
    lon, lat, _, distance = min(
        (
            _project_onto_segment(unit.lon, unit.lat, start, end)
            for start, end in zip(points, points[1:])
        ),
        key=lambda projection: projection[3],
    )
    if lon > 180:
        lon -= 360
    elif lon < -180:
        lon += 360
    return distance, NearestInletPoint(lon=lon, lat=lat)


def _remaining_capacity(orbat: Orbat, available: list[Unit], spent: set[str]) -> int:
    """Largest number of further commitments the ORBAT can support.

    A valid allocation is an antichain in the command tree: a formation and
    one of its descendants contain the same people, while sibling formations
    may both be committed.  The leaf-most available units form a maximum
    antichain in a forest, so counting them gives the exact remaining capacity.
    """
    remaining = [unit for unit in available if unit.unit_id not in spent]
    remaining_ids = {unit.unit_id for unit in remaining}
    units_with_available_descendants = {
        superior.unit_id
        for unit in remaining
        for superior in orbat.superiors(unit.unit_id)
        if superior.unit_id in remaining_ids
    }
    return sum(unit.unit_id not in units_with_available_descendants for unit in remaining)


def _block_force_weapons(orbat: Orbat, unit_id: str) -> list[BlockWeapon]:
    """Organic holdings on the assigned unit and everything under command."""
    by_weapon = {weapon: 0 for weapon in WeaponSystem}
    root = orbat.by_id().get(unit_id)
    if root is None:
        return []
    for unit in (root, *orbat.subordinates(unit_id)):
        for holding in unit.weapons:
            by_weapon[holding.weapon] += holding.count
    return [
        BlockWeapon(weapon=weapon, count=count)
        for weapon, count in by_weapon.items()
        if count > 0
    ]


def _exact(value: Fraction) -> ExactCount:
    return ExactCount(numerator=value.numerator, denominator=value.denominator)


_HARDNESS_PRIORITY = {
    Hardness.SOFT_SKIN: 0,
    Hardness.HARD_SKIN_LIGHT: 1,
    Hardness.HARD_SKIN_HEAVY: 2,
}


def _hardest_platforms(reserve: Mark) -> tuple[Hardness, dict[str, Fraction]] | None:
    """The reserve's hardest catalogued platform class and exact quantities."""
    by_hardness: dict[Hardness, dict[str, Fraction]] = {}
    for element in reserve.task_organization:
        for count in element.platforms:
            platform = lookup_platform(count.platform)
            if platform is None or platform.hardness is None:
                continue
            numerator, denominator = count.effective_fraction(element.modifier)
            holdings = by_hardness.setdefault(platform.hardness, {})
            holdings[platform.name] = holdings.get(platform.name, Fraction()) + Fraction(
                numerator, denominator
            )
    if not by_hardness:
        return None
    hardest = max(by_hardness, key=_HARDNESS_PRIORITY.__getitem__)
    return hardest, by_hardness[hardest]


def _reaction_timeline(
    block: InletBlock,
    allocation: Allocation,
    reserve: Mark | None,
    outcome: SealingOutcome,
    delay_minutes: float | None,
    established_minutes: float | None,
) -> ReactionTimeline:
    """Build only the reaction events justified by current inputs.

    Contact is timed only after the operator chooses a point on this inlet.
    Delay duration is used only when the operator assesses it for this inlet.
    """
    commencement = (
        reserve.timing.commencement_minutes()
        if reserve is not None and reserve.timing is not None
        else None
    )
    task_complete = (
        reserve.timing.task_complete_minutes(block.movement_seconds)
        if reserve is not None and reserve.timing is not None
        else None
    )
    contact = (
        commencement + allocation.block_point.enemy_movement_seconds / 60
        if commencement is not None and allocation.block_point is not None
        else None
    )
    unknowns: list[str] = []
    if allocation.block_point is None:
        unknowns.append("contact time needs an operator-set block position")
    elif commencement is None:
        unknowns.append("contact time needs reserve commencement")
    if commencement is None:
        unknowns.append("commencement needs decision and readiness time")
    established_by_contact = (
        established_minutes <= contact
        if established_minutes is not None and contact is not None
        else None
    )
    if established_minutes is None:
        unknowns.append("block-force establishment time is not assessed")
    elif contact is None:
        unknowns.append("block timing cannot be compared until contact is known")

    if established_by_contact is False:
        if task_complete is None:
            unknowns.append("objective arrival needs complete reserve timing")
        return ReactionTimeline(
            commencement_minutes=commencement,
            contact_minutes=contact,
            block_established_minutes=established_minutes,
            block_established_by_contact=False,
            delay_minutes=0,
            remnant_continued=True,
            objective_arrival_minutes=task_complete,
            objective_outcome=ObjectiveOutcome.REACHED,
            unknowns=unknowns,
        )

    if outcome is SealingOutcome.DESTROYED:
        return ReactionTimeline(
            commencement_minutes=commencement,
            contact_minutes=contact,
            block_established_minutes=established_minutes,
            block_established_by_contact=established_by_contact,
            remnant_continued=False,
            objective_outcome=ObjectiveOutcome.DID_NOT_REACH,
            unknowns=unknowns,
        )
    if outcome is SealingOutcome.PASSED:
        if task_complete is None:
            unknowns.append("objective arrival needs complete reserve timing")
        return ReactionTimeline(
            commencement_minutes=commencement,
            contact_minutes=contact,
            block_established_minutes=established_minutes,
            block_established_by_contact=established_by_contact,
            delay_minutes=0,
            remnant_continued=True,
            objective_arrival_minutes=task_complete,
            objective_outcome=ObjectiveOutcome.REACHED,
            unknowns=unknowns,
        )
    if outcome is SealingOutcome.DELAYED:
        if delay_minutes is None:
            unknowns.append("delay duration is not assessed")
            unknowns.append("objective arrival cannot be timed until delay is assessed")
        elif task_complete is None:
            unknowns.append("objective arrival needs complete reserve timing")
        return ReactionTimeline(
            commencement_minutes=commencement,
            contact_minutes=contact,
            block_established_minutes=established_minutes,
            block_established_by_contact=established_by_contact,
            delay_minutes=delay_minutes,
            remnant_continued=True,
            objective_arrival_minutes=(
                task_complete + delay_minutes
                if task_complete is not None and delay_minutes is not None
                else None
            ),
            objective_outcome=ObjectiveOutcome.REACHED,
            unknowns=unknowns,
        )
    unknowns.append("continuation and objective outcome need a sealing result")
    return ReactionTimeline(
        commencement_minutes=commencement,
        contact_minutes=contact,
        block_established_minutes=established_minutes,
        block_established_by_contact=established_by_contact,
        objective_outcome=ObjectiveOutcome.UNKNOWN,
        unknowns=unknowns,
    )


def _assess_sealing(
    block: InletBlock,
    allocation: Allocation,
    reserve: Mark | None,
    delay_minutes: float | None,
    established_minutes: float | None,
) -> SealingAssessment:
    candidate = next(
        (entry for entry in block.candidates if entry.unit_id == allocation.unit_id),
        None,
    )
    if reserve is None:
        outcome = SealingOutcome.UNKNOWN
        return SealingAssessment(
            inlet_id=block.inlet_id,
            corridor_id=block.corridor_id,
            reserve_id=block.reserve_id,
            target_platforms=[],
            effective_weapons=[],
            effective_weapon_count=0,
            outcome=outcome,
            reason="reserve is not present in the supplied assessment",
            reaction=_reaction_timeline(
                block, allocation, reserve, outcome, delay_minutes, established_minutes
            ),
        )

    hardest = _hardest_platforms(reserve)
    if hardest is None:
        outcome = SealingOutcome.UNKNOWN
        return SealingAssessment(
            inlet_id=block.inlet_id,
            corridor_id=block.corridor_id,
            reserve_id=reserve.id,
            reserve_name=reserve.name,
            target_platforms=[],
            effective_weapons=[],
            effective_weapon_count=0,
            outcome=outcome,
            reason="reserve has no catalogued platform hardness to assess",
            reaction=_reaction_timeline(
                block, allocation, reserve, outcome, delay_minutes, established_minutes
            ),
        )

    hardness, platforms = hardest
    target_class = TargetClass(hardness.value)
    weapons = candidate.weapons if candidate is not None else []
    effective = [
        weapon
        for weapon in weapons
        if match_weapon(weapon.weapon, target_class, Effect.DESTROY).effective
    ]
    effective_count = sum(weapon.count for weapon in effective)
    target_count = sum(platforms.values(), Fraction())
    remaining = max(Fraction(), target_count - effective_count)

    if effective_count == 0:
        outcome = SealingOutcome.PASSED
        reason = "no recorded weapon is unconditionally effective against the hardest platforms"
    elif remaining == 0:
        outcome = SealingOutcome.DESTROYED
        reason = "effective weapons meet or exceed the hardest-platform count"
    else:
        outcome = SealingOutcome.DELAYED
        reason = "effective weapons attrit the hardest platforms but leave a remnant"

    return SealingAssessment(
        inlet_id=block.inlet_id,
        corridor_id=block.corridor_id,
        reserve_id=reserve.id,
        reserve_name=reserve.name,
        target_hardness=hardness,
        target_platforms=[
            AssessedPlatform(platform=name, count=_exact(count))
            for name, count in sorted(platforms.items())
        ],
        target_platform_count=_exact(target_count),
        effective_weapons=effective,
        effective_weapon_count=effective_count,
        remaining_platform_count=_exact(remaining),
        outcome=outcome,
        reason=reason,
        reaction=_reaction_timeline(
            block, allocation, reserve, outcome, delay_minutes, established_minutes
        ),
    )


def plan_blocks(
    graph: RoadGraph,
    corridors: list[CorridorOut],
    orbat: Orbat,
    reserves: list[Mark] | None = None,
    block_points: list[BlockPointInput] | None = None,
    delay_assessments: list[DelayAssessmentInput] | None = None,
    block_establishments: list[BlockEstablishmentInput] | None = None,
) -> BlockPlan:
    """Block options and a maximum-coverage allocation for every axis/inlet."""
    available = orbat.available()

    blocks: list[InletBlock] = []
    unblockable: list[Unblockable] = []
    rejected_block_points: list[RejectedBlockPoint] = []
    requested_by_id: dict[str, BlockPointInput] = {}
    duplicate_point_ids: set[str] = set()
    for point in block_points or []:
        if point.inlet_id in requested_by_id:
            duplicate_point_ids.add(point.inlet_id)
            continue
        requested_by_id[point.inlet_id] = point
    for inlet_id in sorted(duplicate_point_ids):
        requested_by_id.pop(inlet_id, None)
        rejected_block_points.append(
            RejectedBlockPoint(
                inlet_id=inlet_id,
                reason="block point was supplied more than once",
            )
        )
    located_points: dict[str, BlockPoint] = {}
    rejected_delay_assessments: list[RejectedDelayAssessment] = []
    delay_by_id: dict[str, DelayAssessmentInput] = {}
    duplicate_delay_ids: set[str] = set()
    for assessment in delay_assessments or []:
        if assessment.inlet_id in delay_by_id:
            duplicate_delay_ids.add(assessment.inlet_id)
            continue
        delay_by_id[assessment.inlet_id] = assessment
    for inlet_id in sorted(duplicate_delay_ids):
        delay_by_id.pop(inlet_id, None)
        rejected_delay_assessments.append(
            RejectedDelayAssessment(
                inlet_id=inlet_id,
                reason="delay assessment was supplied more than once",
            )
        )
    rejected_block_establishments: list[RejectedBlockEstablishment] = []
    establishment_by_id: dict[str, BlockEstablishmentInput] = {}
    duplicate_establishment_ids: set[str] = set()
    for establishment in block_establishments or []:
        if establishment.inlet_id in establishment_by_id:
            duplicate_establishment_ids.add(establishment.inlet_id)
            continue
        establishment_by_id[establishment.inlet_id] = establishment
    for inlet_id in sorted(duplicate_establishment_ids):
        establishment_by_id.pop(inlet_id, None)
        rejected_block_establishments.append(
            RejectedBlockEstablishment(
                inlet_id=inlet_id,
                reason="block establishment was supplied more than once",
            )
        )
    urgency: dict[str, tuple[float, float, str]] = {}
    edges_by_id = {edge.id: edge for edge in graph.edges}

    for corridor in corridors:
        for inlet_number, route in enumerate(corridor.routes, start=1):
            inlet_id = _inlet_id(route.reserve_id, route.objective_id, route.edge_ids)
            urgency[inlet_id] = (route.seconds, corridor.fastest_seconds, inlet_id)
            points = _route_points(edges_by_id, route)
            requested = requested_by_id.pop(inlet_id, None)
            if requested is not None:
                located = _locate_block_point(route, requested, edges_by_id, graph)
                if located is None:
                    rejected_block_points.append(
                        RejectedBlockPoint(
                            inlet_id=inlet_id,
                            reason="requested point is more than 500 m from this inlet",
                        )
                    )
                else:
                    located_points[inlet_id] = located
            candidates: list[BlockCandidate] = []
            if not points:
                unblockable.append(
                    Unblockable(
                        inlet_id=inlet_id,
                        corridor_id=corridor.id,
                        reason="inlet is not in this area's road graph",
                    )
                )
            elif not available:
                unblockable.append(
                    Unblockable(
                        inlet_id=inlet_id,
                        corridor_id=corridor.id,
                        reason="no uncommitted unit",
                    )
                )
            else:
                for unit in available:
                    distance, nearest_point = _nearest_inlet_point(unit, points)
                    candidates.append(
                        BlockCandidate(
                            unit_id=unit.unit_id,
                            unit_name=unit.name,
                            echelon=unit.echelon,
                            weapons=_block_force_weapons(orbat, unit.unit_id),
                            distance_meters=distance,
                            nearest_point=nearest_point,
                        )
                    )
                # Ties break on unit id, so the same ORBAT always proposes the same force.
                candidates.sort(key=lambda c: (c.distance_meters, c.unit_id))
            blocks.append(
                InletBlock(
                    inlet_id=inlet_id,
                    corridor_id=corridor.id,
                    inlet_number=inlet_number,
                    reserve_id=route.reserve_id,
                    objective_id=route.objective_id,
                    edge_ids=list(route.edge_ids),
                    movement_seconds=route.seconds,
                    candidates=candidates,
                )
            )

    # Coverage is the primary objective.  Urgency decides which inlets remain
    # open only when there are fewer independent forces than inlets; distance
    # then chooses a force, but never if doing so would sacrifice attainable
    # coverage elsewhere in the plan.
    ordered = sorted(
        (block for block in blocks if block.candidates),
        key=lambda block: urgency[block.inlet_id],
    )
    target = min(len(ordered), _remaining_capacity(orbat, available, set()))

    spent: set[str] = set()
    allocation: list[Allocation] = []
    uncovered: list[Uncovered] = []

    for index, block in enumerate(ordered):
        if len(allocation) == target:
            uncovered.append(
                Uncovered(inlet_id=block.inlet_id, corridor_id=block.corridor_id)
            )
            continue

        need_after = target - len(allocation) - 1
        remaining_inlets = len(ordered) - index - 1
        taken = None
        for candidate in block.candidates:
            if candidate.unit_id in spent:
                continue
            next_spent = spent | orbat.commits(candidate.unit_id)
            capacity_after = _remaining_capacity(orbat, available, next_spent)
            if min(capacity_after, remaining_inlets) >= need_after:
                taken = candidate
                break

        if taken is None:
            uncovered.append(
                Uncovered(inlet_id=block.inlet_id, corridor_id=block.corridor_id)
            )
            continue
        allocation.append(
            Allocation(
                inlet_id=block.inlet_id,
                corridor_id=block.corridor_id,
                unit_id=taken.unit_id,
                unit_name=taken.unit_name,
                distance_meters=taken.distance_meters,
                nearest_point=taken.nearest_point,
                block_point=located_points.get(block.inlet_id),
            )
        )
        spent |= orbat.commits(taken.unit_id)

    blocks.sort(key=lambda block: (block.corridor_id, block.inlet_number, block.inlet_id))
    unblockable.sort(key=lambda entry: (entry.corridor_id, entry.inlet_id))
    uncovered.sort(key=lambda entry: (entry.corridor_id, entry.inlet_id))
    rejected_block_points.extend(
        RejectedBlockPoint(
            inlet_id=inlet_id,
            reason="block point names an inlet outside this study",
        )
        for inlet_id in sorted(requested_by_id)
    )
    rejected_block_points.sort(key=lambda entry: (entry.inlet_id, entry.reason))
    known_inlet_ids = {block.inlet_id for block in blocks}
    allocation_by_inlet = {entry.inlet_id: entry for entry in allocation}
    accepted_delays: dict[str, DelayAssessmentInput] = {}
    for inlet_id, assessment in delay_by_id.items():
        assigned = allocation_by_inlet.get(inlet_id)
        if inlet_id not in known_inlet_ids:
            reason = "delay assessment names an inlet outside this study"
        elif assigned is None:
            reason = "delay assessment names an inlet with no allocated block force"
        elif assigned.unit_id != assessment.unit_id:
            reason = "delay assessment belongs to a different allocated block force"
        else:
            accepted_delays[inlet_id] = assessment
            continue
        rejected_delay_assessments.append(
            RejectedDelayAssessment(inlet_id=inlet_id, reason=reason)
        )
    accepted_establishments: dict[str, BlockEstablishmentInput] = {}
    for inlet_id, establishment in establishment_by_id.items():
        assigned = allocation_by_inlet.get(inlet_id)
        point = assigned.block_point if assigned is not None else None
        if inlet_id not in known_inlet_ids:
            reason = "block establishment names an inlet outside this study"
        elif assigned is None:
            reason = "block establishment names an inlet with no allocated block force"
        elif assigned.unit_id != establishment.unit_id:
            reason = "block establishment belongs to a different allocated block force"
        elif point is None:
            reason = "block establishment requires an exact block point"
        elif not (
            math.isclose(point.lon, establishment.block_point_lon, abs_tol=1e-7)
            and math.isclose(point.lat, establishment.block_point_lat, abs_tol=1e-7)
        ):
            reason = "block establishment belongs to a different block point"
        else:
            accepted_establishments[inlet_id] = establishment
            continue
        rejected_block_establishments.append(
            RejectedBlockEstablishment(inlet_id=inlet_id, reason=reason)
        )
    blocks_by_inlet = {block.inlet_id: block for block in blocks}
    reserves_by_id = {reserve.id: reserve for reserve in reserves or []}
    sealing = [
        _assess_sealing(
            blocks_by_inlet[entry.inlet_id],
            entry,
            reserves_by_id.get(blocks_by_inlet[entry.inlet_id].reserve_id),
            accepted_delays[entry.inlet_id].delay_minutes
            if entry.inlet_id in accepted_delays
            else None,
            accepted_establishments[entry.inlet_id].established_minutes
            if entry.inlet_id in accepted_establishments
            else None,
        )
        for entry in allocation
    ]
    delayed_inlets = {
        assessment.inlet_id
        for assessment in sealing
        if assessment.outcome is SealingOutcome.DELAYED
    }
    for inlet_id in sorted(accepted_delays.keys() - delayed_inlets):
        rejected_delay_assessments.append(
            RejectedDelayAssessment(
                inlet_id=inlet_id,
                reason="delay assessment requires a delayed and attrited sealing outcome",
            )
        )
        accepted_delays.pop(inlet_id)
    rejected_delay_assessments.sort(key=lambda entry: (entry.inlet_id, entry.reason))
    rejected_block_establishments.sort(key=lambda entry: (entry.inlet_id, entry.reason))
    return BlockPlan(
        inlets=blocks,
        allocation=allocation,
        unblockable=unblockable,
        uncovered=uncovered,
        sealing=sealing,
        block_points=sorted(located_points.values(), key=lambda point: point.inlet_id),
        rejected_block_points=rejected_block_points,
        delay_assessments=sorted(
            accepted_delays.values(), key=lambda entry: entry.inlet_id
        ),
        rejected_delay_assessments=rejected_delay_assessments,
        block_establishments=sorted(
            accepted_establishments.values(), key=lambda entry: entry.inlet_id
        ),
        rejected_block_establishments=rejected_block_establishments,
    )
