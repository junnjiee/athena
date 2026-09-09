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

from pydantic import BaseModel, Field

from athena.graph import Edge, RoadGraph
from athena.orbat import Orbat, Unit, WeaponSystem
from athena.study import CorridorOut
from athena.units import Echelon


class BlockWeapon(BaseModel):
    """Aggregated weapon count for one task-organised block force."""

    weapon: WeaponSystem
    count: int = Field(ge=1)


class BlockCandidate(BaseModel):
    """One force that could be put on one inlet."""

    unit_id: str
    unit_name: str
    echelon: Echelon
    weapons: list[BlockWeapon]
    """Straight-line metres from the unit to the inlet, not road distance
    and not travel time."""
    distance_meters: float


class InletBlock(BaseModel):
    """One axis/inlet and every force that could be put on it, nearest first."""

    inlet_id: str
    corridor_id: str
    inlet_number: int
    reserve_id: str
    objective_id: str
    edge_ids: list[str]
    candidates: list[BlockCandidate]


class Allocation(BaseModel):
    """One inlet covered by one force, in a plan where no force is used twice."""

    inlet_id: str
    corridor_id: str
    unit_id: str
    unit_name: str
    distance_meters: float


class Unblockable(BaseModel):
    """An inlet nothing can be put on, and why."""

    inlet_id: str
    corridor_id: str
    reason: str


class Uncovered(BaseModel):
    """An inlet that could be blocked, but not once the force ran out."""

    inlet_id: str
    corridor_id: str


class BlockPlan(BaseModel):
    inlets: list[InletBlock]
    allocation: list[Allocation]
    unblockable: list[Unblockable]
    uncovered: list[Uncovered]


def _inlet_id(reserve_id: str, objective_id: str, edge_ids: list[str]) -> str:
    """A stable identity for one route, independent of corridor regrouping."""
    identity = "|".join((reserve_id, objective_id, *edge_ids))
    digest = hashlib.sha256(identity.encode()).hexdigest()
    return f"inlet_{digest[:16]}"


def _route_points(
    edges_by_id: dict[str, Edge], edge_ids: list[str]
) -> list[tuple[float, float]]:
    """Every graph vertex on an inlet, in route order where possible."""
    points: list[tuple[float, float]] = []
    for edge_id in edge_ids:
        edge = edges_by_id.get(edge_id)
        if edge is not None:
            points.extend(edge.points)
    return points


def _distance_meters(unit: Unit, points: list[tuple[float, float]]) -> float:
    """Straight-line metres to the nearest sampled part of the inlet.

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


def plan_blocks(
    graph: RoadGraph,
    corridors: list[CorridorOut],
    orbat: Orbat,
) -> BlockPlan:
    """Block options and a maximum-coverage allocation for every axis/inlet."""
    available = orbat.available()

    blocks: list[InletBlock] = []
    unblockable: list[Unblockable] = []
    urgency: dict[str, tuple[float, float, str]] = {}
    edges_by_id = {edge.id: edge for edge in graph.edges}

    for corridor in corridors:
        for inlet_number, route in enumerate(corridor.routes, start=1):
            inlet_id = _inlet_id(route.reserve_id, route.objective_id, route.edge_ids)
            urgency[inlet_id] = (route.seconds, corridor.fastest_seconds, inlet_id)
            points = _route_points(edges_by_id, route.edge_ids)
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
                candidates = [
                    BlockCandidate(
                        unit_id=unit.unit_id,
                        unit_name=unit.name,
                        echelon=unit.echelon,
                        weapons=_block_force_weapons(orbat, unit.unit_id),
                        distance_meters=_distance_meters(unit, points),
                    )
                    for unit in available
                ]
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
            )
        )
        spent |= orbat.commits(taken.unit_id)

    blocks.sort(key=lambda block: (block.corridor_id, block.inlet_number, block.inlet_id))
    unblockable.sort(key=lambda entry: (entry.corridor_id, entry.inlet_id))
    uncovered.sort(key=lambda entry: (entry.corridor_id, entry.inlet_id))
    return BlockPlan(
        inlets=blocks,
        allocation=allocation,
        unblockable=unblockable,
        uncovered=uncovered,
    )
