"""Which forces a commander can put on which approach.

The S3 half of the engine's job. Given the corridors the S2 side derived and
the ORBAT actually available, this says what could block what — and, just as
importantly, what nothing can block.

It does not model arrival time. A block force here is one a commander *could*
commit to that ground, not one that gets there first. Ordering by distance is a
convenience for reading the options, not a claim about who wins the race; that
judgement stays with the human. See ENGINE.md's known limits.
"""

import math

from pydantic import BaseModel

from athena.graph import RoadGraph
from athena.orbat import Orbat, Unit
from athena.study import CorridorOut
from athena.units import Echelon, fits_within


class BlockCandidate(BaseModel):
    """One force that could be put on one corridor."""

    unit_id: str
    unit_name: str
    echelon: Echelon
    strength: int
    """Straight-line metres from the unit to the choke point, not road distance
    and not travel time."""
    distance_meters: float


class CorridorBlock(BaseModel):
    """A corridor and everything that could block it, nearest first."""

    corridor_id: str
    choke_edge_ids: list[str]
    candidates: list[BlockCandidate]


class Allocation(BaseModel):
    """One corridor covered by one force, in a plan where no force is used twice."""

    corridor_id: str
    unit_id: str
    unit_name: str
    distance_meters: float


class Unblockable(BaseModel):
    """A corridor nothing can be put on, and why."""

    corridor_id: str
    reason: str


class Uncovered(BaseModel):
    """A corridor that could be blocked, but not once the force ran out."""

    corridor_id: str


class BlockPlan(BaseModel):
    corridors: list[CorridorBlock]
    allocation: list[Allocation]
    unblockable: list[Unblockable]
    uncovered: list[Uncovered]


def _choke_points(graph: RoadGraph, choke_edge_ids: list[str]) -> list[tuple[float, float]]:
    """Every vertex of the ground a corridor's routes all cross."""
    wanted = set(choke_edge_ids)
    points: list[tuple[float, float]] = []
    for edge in graph.edges:
        if edge.id in wanted:
            points.extend(edge.points)
    return points


def _distance_meters(unit: Unit, points: list[tuple[float, float]]) -> float:
    """Straight-line metres to the nearest part of the choke point.

    Equirectangular at the unit's own latitude: exact enough to order candidates
    over an operational box, and never presented as anything finer.
    """
    lon_scale = math.cos(math.radians(unit.lat)) * 111_320.0
    lat_scale = 111_320.0
    best = math.inf
    for lon, lat in points:
        dx = (lon - unit.lon) * lon_scale
        dy = (lat - unit.lat) * lat_scale
        best = min(best, math.hypot(dx, dy))
    return best


def plan_blocks(
    graph: RoadGraph,
    corridors: list[CorridorOut],
    orbat: Orbat,
    ceiling: Echelon,
) -> BlockPlan:
    """Block options per corridor, plus one allocation that spends nothing twice.

    ``ceiling`` is the largest formation the operator will commit to any single
    corridor — the establishment on the map is rarely what may actually be used.
    """
    available = [u for u in orbat.available() if fits_within(u.echelon, ceiling)]

    blocks: list[CorridorBlock] = []
    unblockable: list[Unblockable] = []

    for corridor in corridors:
        if not corridor.choke_edge_ids:
            unblockable.append(
                Unblockable(
                    corridor_id=corridor.id,
                    reason="no choke point: these routes share no ground to stand on",
                )
            )
            continue

        points = _choke_points(graph, corridor.choke_edge_ids)
        if not points:
            unblockable.append(
                Unblockable(
                    corridor_id=corridor.id,
                    reason="choke point is not in this area's road graph",
                )
            )
            continue

        candidates = [
            BlockCandidate(
                unit_id=unit.unit_id,
                unit_name=unit.name,
                echelon=unit.echelon,
                strength=unit.strength,
                distance_meters=_distance_meters(unit, points),
            )
            for unit in available
        ]
        if not candidates:
            unblockable.append(
                Unblockable(
                    corridor_id=corridor.id,
                    reason=f"no uncommitted unit at or below {ceiling}",
                )
            )
            continue

        # Ties break on unit id, so the same ORBAT always proposes the same force.
        candidates.sort(key=lambda c: (c.distance_meters, c.unit_id))
        blocks.append(
            CorridorBlock(
                corridor_id=corridor.id,
                choke_edge_ids=list(corridor.choke_edge_ids),
                candidates=candidates,
            )
        )

    # Allocate to the quickest approach first: it is the one the enemy reaches
    # soonest, so it has the strongest claim on a scarce force.
    ordered = sorted(
        blocks,
        key=lambda block: (
            next(c.fastest_seconds for c in corridors if c.id == block.corridor_id),
            block.corridor_id,
        ),
    )

    spent: set[str] = set()
    allocation: list[Allocation] = []
    uncovered: list[Uncovered] = []

    for block in ordered:
        taken = next((c for c in block.candidates if c.unit_id not in spent), None)
        if taken is None:
            uncovered.append(Uncovered(corridor_id=block.corridor_id))
            continue
        allocation.append(
            Allocation(
                corridor_id=block.corridor_id,
                unit_id=taken.unit_id,
                unit_name=taken.unit_name,
                distance_meters=taken.distance_meters,
            )
        )
        spent |= orbat.commits(taken.unit_id)

    blocks.sort(key=lambda block: block.corridor_id)
    unblockable.sort(key=lambda entry: entry.corridor_id)
    uncovered.sort(key=lambda entry: entry.corridor_id)
    return BlockPlan(
        corridors=blocks,
        allocation=allocation,
        unblockable=unblockable,
        uncovered=uncovered,
    )
