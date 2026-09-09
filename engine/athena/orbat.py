"""The order of battle a commander has to block with.

An ORBAT here is the force actually available for this task, not the formation's
whole establishment. The operator supplies it per study, because units get moved
around by mission requirement and what is on the map today is rarely what the
establishment says.
"""

from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field

from athena.units import COMMAND_ROLES, ECHELON_DEPTH, Echelon, Role


class Availability(StrEnum):
    """Whether a unit can be given this task.

    Only an uncommitted unit is offered as a block force. A committed unit is
    already doing something the commander decided mattered more, and offering it
    as free would quietly propose breaking that.
    """

    UNCOMMITTED = "uncommitted"
    COMMITTED = "committed"
    RESERVE = "reserve"


class WeaponSystem(StrEnum):
    """Capability-generic own-force systems from the doctrinal catalogue."""

    ATGM = "ATGM"
    LIGHT_RR = "Light RR"
    LAW = "LAW"
    AGL_40MM = "40mm AGL"
    HMG_12_7MM = "12.7mm HMG"
    GPMG = "GPMG"
    SAW = "SAW"
    MORTAR_81MM = "81mm mortar"
    MORTAR_60MM = "60mm mortar"
    MINI_UAV = "mini UAV"


class WeaponHolding(BaseModel):
    """Organic holding on one ORBAT node, never an aggregate over children."""

    model_config = ConfigDict(frozen=True)

    id: str = Field(min_length=1)
    weapon: WeaponSystem
    count: int = Field(ge=1)


class Unit(BaseModel):
    """One node of the tree, with where it is and whether it is free."""

    model_config = ConfigDict(frozen=True)

    unit_id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    echelon: Echelon
    parent_id: str | None = None
    """The unit one echelon up, or ``None`` at the root."""

    lon: float
    lat: float
    strength: int = Field(ge=1)
    weapons: tuple[WeaponHolding, ...] = Field(default=(), max_length=100)
    """Organic weapons only. A formed block force aggregates its descendants."""
    availability: Availability = Availability.UNCOMMITTED
    redcon: int | None = Field(default=None, ge=1, le=5)
    """Readiness condition. Display-only and orthogonal to availability."""

    @property
    def role(self) -> Role:
        """What this unit's commander is, derived from what it commands."""
        return COMMAND_ROLES[self.echelon]

    def model_post_init(self, _context: object) -> None:
        ids = [holding.id for holding in self.weapons]
        if len(ids) != len(set(ids)):
            raise ValueError(f"duplicate weapon holding id on {self.unit_id}")
        weapons = [holding.weapon for holding in self.weapons]
        if len(weapons) != len(set(weapons)):
            raise ValueError(f"duplicate weapon system on {self.unit_id}")


class Orbat(BaseModel):
    """A validated organisation tree.

    Validation is deliberately narrow: ids unique, parents known, and a parent
    strictly higher than its child. That last rule is what forbids cycles, since
    depth strictly decreases on every step upward and is bounded below by zero.
    """

    model_config = ConfigDict(frozen=True)

    units: tuple[Unit, ...]

    def model_post_init(self, _context: object) -> None:
        by_id: dict[str, Unit] = {}
        for unit in self.units:
            if unit.unit_id in by_id:
                raise ValueError(f"duplicate unit id: {unit.unit_id}")
            by_id[unit.unit_id] = unit

        for unit in self.units:
            if unit.parent_id is None:
                continue
            parent = by_id.get(unit.parent_id)
            if parent is None:
                raise ValueError(f"unknown parent unit: {unit.parent_id}")
            if ECHELON_DEPTH[parent.echelon] >= ECHELON_DEPTH[unit.echelon]:
                raise ValueError(
                    f"parent of {unit.unit_id} must be a higher echelon than {unit.echelon}"
                )

    def by_id(self) -> dict[str, Unit]:
        return {unit.unit_id: unit for unit in self.units}

    def available(self) -> list[Unit]:
        """Units free to be given a blocking task, largest echelon first.

        Ordering by echelon means a commander sees the formed body before its
        parts, which is how a force is offered up rather than broken up.
        """
        free = [u for u in self.units if u.availability is Availability.UNCOMMITTED]
        return sorted(free, key=lambda u: (ECHELON_DEPTH[u.echelon], u.unit_id))

    def subordinates(self, unit_id: str) -> list[Unit]:
        """Everything under a unit, at any depth."""
        children: dict[str, list[Unit]] = {}
        for unit in self.units:
            if unit.parent_id is not None:
                children.setdefault(unit.parent_id, []).append(unit)

        found: list[Unit] = []
        stack = list(children.get(unit_id, []))
        while stack:
            unit = stack.pop()
            found.append(unit)
            stack.extend(children.get(unit.unit_id, []))
        return sorted(found, key=lambda u: u.unit_id)

    def superiors(self, unit_id: str) -> list[Unit]:
        """Every unit above this one, nearest parent first."""
        by_id = self.by_id()
        found: list[Unit] = []
        cursor = by_id.get(unit_id)
        while cursor is not None and cursor.parent_id is not None:
            parent = by_id.get(cursor.parent_id)
            if parent is None:
                break
            found.append(parent)
            cursor = parent
        return found

    def commits(self, unit_id: str) -> set[str]:
        """Every unit made unavailable by committing this one.

        Both directions of the tree. Downward, because committing a platoon
        commits its sections. Upward, because a platoon with one section gone is
        no longer a platoon to commit. Without both, the same men get allocated
        twice under two different names.
        """
        below = {unit.unit_id for unit in self.subordinates(unit_id)}
        above = {unit.unit_id for unit in self.superiors(unit_id)}
        return {unit_id} | below | above
