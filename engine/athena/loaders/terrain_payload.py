"""Build a Battlefield from a frontend terrain export.

The export is produced by ``frontend/src/lib/simulationExport.ts``. Its terrain
grid is row-major with **row 0 at the northernmost latitude**, which fixes the
sense of the y axis: y increases southward.
"""

import json
import math
from collections.abc import Iterable, Sequence
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field

from athena.models import CommunicationGroup, Position, TerrainClass, Team
from athena.params import (
    DEFAULT_SOLDIER_VISION_RANGE,
    MAX_ELEVATION_CHANGE,
    TERRAIN_PROFILES,
)
from athena.terrain import TERRAIN_LABELS
from athena.world_state import Battlefield, Soldier


class PayloadError(ValueError):
    """Raised when an export cannot be turned into a battlefield."""


def _camel(field_name: str) -> str:
    head, *tail = field_name.split("_")
    return head + "".join(word.capitalize() for word in tail)


class _PayloadModel(BaseModel):
    # extra="ignore" so exporter fields we do not consume yet (weather, routes,
    # symbol metadata) never break the load.
    model_config = ConfigDict(
        alias_generator=_camel,
        populate_by_name=True,
        extra="ignore",
        frozen=True,
    )


class GeoPoint(_PayloadModel):
    longitude: float
    latitude: float


class BoundingBox(_PayloadModel):
    west: float
    south: float
    east: float
    north: float


class TerrainCells(_PayloadModel):
    elevation: tuple[float, ...]
    # ``cls`` in the export; renamed here to avoid shadowing the conventional
    # classmethod parameter name.
    terrain_classes: tuple[int, ...] = Field(alias="cls")


class TerrainGrid(_PayloadModel):
    bbox: BoundingBox
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    cell_meters: float = Field(gt=0)
    class_names: dict[int, str] = Field(default_factory=dict)
    cells: TerrainCells


class PayloadUnit(_PayloadModel):
    id: str
    side: str
    name: str
    position: GeoPoint


class PayloadObjective(_PayloadModel):
    id: str
    name: str
    description: str = ""
    position: GeoPoint
    radius_meters: float = 0.0


class TerrainPayload(_PayloadModel):
    terrain: TerrainGrid
    units: tuple[PayloadUnit, ...] = ()
    objectives: tuple[PayloadObjective, ...] = ()


def load_payload(path: str | Path) -> TerrainPayload:
    """Parse an export and check the grid is internally consistent."""
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    if raw.get("terrain") is None:
        raise PayloadError("export contains no terrain grid")

    payload = TerrainPayload.model_validate(raw)
    grid = payload.terrain
    expected = grid.width * grid.height

    for label, values in (
        ("elevation", grid.cells.elevation),
        ("cls", grid.cells.terrain_classes),
    ):
        if len(values) != expected:
            raise PayloadError(
                f"terrain {label} has {len(values)} cells; expected {expected} "
                f"for {grid.width}x{grid.height}"
            )

    _check_class_names(grid.class_names)
    return payload


def _check_class_names(class_names: dict[int, str]) -> None:
    """Fail if the export renumbered the terrain classes.

    ``TerrainClass`` indices are chosen to match the export so no translation
    layer is needed. That equivalence is silent if it ever breaks -- forest
    would simply load as something else -- so it is asserted rather than
    assumed.
    """
    known = {int(member) for member in TerrainClass}
    unknown = set(class_names) - known
    mismatched = {
        index: name
        for index, name in class_names.items()
        if index in known and TERRAIN_LABELS[TerrainClass(index)] != name
    }
    if mismatched or unknown:
        raise PayloadError(
            "export terrain classes do not match TerrainClass: "
            f"mismatched={mismatched or {}} unknown={sorted(unknown)}"
        )


def project_cell(
    point: GeoPoint,
    bbox: BoundingBox,
    width: int,
    height: int,
) -> tuple[int, int]:
    """Map a lon/lat onto a grid cell, clamped to the grid.

    Cells partition the bounding box, so the coordinate is binned rather than
    scaled onto the last index. Row 0 is the northernmost, so latitude is
    measured downward from ``north``.
    """
    span_x = bbox.east - bbox.west
    span_y = bbox.north - bbox.south
    if span_x <= 0 or span_y <= 0:
        raise PayloadError(f"degenerate bounding box: {bbox}")

    x = int((point.longitude - bbox.west) / span_x * width)
    y = int((bbox.north - point.latitude) / span_y * height)
    return max(0, min(width - 1, x)), max(0, min(height - 1, y))


def _quantize_elevations(elevation: Sequence[float]) -> tuple[int, ...]:
    """Round metre elevations to integer levels with the lowest cell at zero."""
    datum = math.floor(min(elevation))
    return tuple(round(value) - datum for value in elevation)


def count_unclimbable_transitions(
    levels: Sequence[int],
    width: int,
    height: int,
    max_elevation_change: int = MAX_ELEVATION_CHANGE,
) -> int:
    """Count adjacent cell pairs a soldier cannot step between.

    Quantizing real terrain can strand soldiers behind steps the movement
    resolver refuses. The current AO has none, but a steeper import should say
    so at load rather than manifest as agents that mysteriously cannot advance.
    """
    blocked = 0
    for y in range(height):
        for x in range(width):
            level = levels[y * width + x]
            if x + 1 < width:
                if abs(level - levels[y * width + x + 1]) > max_elevation_change:
                    blocked += 1
            if y + 1 < height:
                if abs(level - levels[(y + 1) * width + x]) > max_elevation_change:
                    blocked += 1
    return blocked


_TEAMS_BY_SIDE = {"blue": Team.BLUE, "red": Team.RED}


def _team_for(unit: PayloadUnit) -> Team:
    try:
        return _TEAMS_BY_SIDE[unit.side.lower()]
    except KeyError:
        raise PayloadError(
            f"unit {unit.name!r} has unknown side {unit.side!r}"
        ) from None


def _spiral(x: int, y: int, width: int, height: int) -> Iterable[tuple[int, int]]:
    """Yield cells outward from a centre, nearest ring first."""
    yield x, y
    for radius in range(1, max(width, height)):
        for dy in range(-radius, radius + 1):
            for dx in range(-radius, radius + 1):
                if max(abs(dx), abs(dy)) != radius:
                    continue
                nx, ny = x + dx, y + dy
                if 0 <= nx < width and 0 <= ny < height:
                    yield nx, ny


def _place(
    unit: PayloadUnit,
    grid: TerrainGrid,
    classes: Sequence[int],
    taken: set[tuple[int, int]],
) -> tuple[int, int]:
    """Resolve a unit onto a free, passable cell near its projected position."""
    x, y = project_cell(unit.position, grid.bbox, grid.width, grid.height)
    for cx, cy in _spiral(x, y, grid.width, grid.height):
        if (cx, cy) in taken:
            continue
        if TERRAIN_PROFILES[TerrainClass(classes[cy * grid.width + cx])].passable:
            taken.add((cx, cy))
            return cx, cy
    raise PayloadError(f"no free passable cell for unit {unit.name!r}")


def _communication_groups(teams: Iterable[Team]) -> list[CommunicationGroup]:
    present = set(teams)
    return [
        CommunicationGroup(
            group_id=f"{team.value}-team",
            name=f"{team.value.capitalize()} team",
            team=team,
        )
        for team in (Team.BLUE, Team.RED)
        if team in present
    ]


def build_battlefield_from_payload(
    payload: TerrainPayload,
    *,
    vision_range: float = DEFAULT_SOLDIER_VISION_RANGE,
    include_units: bool = True,
) -> Battlefield:
    """Turn a parsed export into a battlefield.

    Weather is deliberately ignored. The export reports ``visibilityM`` in the
    thousands, far beyond any soldier vision range the engine uses, so the only
    field with real bite is ``isDay`` -- and choosing a night penalty is a
    balance decision rather than a loading one.
    """
    grid = payload.terrain
    levels = _quantize_elevations(grid.cells.elevation)
    classes = grid.cells.terrain_classes

    surface = {
        Position(x=x, y=y, z=levels[y * grid.width + x])
        for y in range(grid.height)
        for x in range(grid.width)
    }

    taken: set[tuple[int, int]] = set()
    soldiers = []
    for unit in payload.units if include_units else ():
        team = _team_for(unit)
        x, y = _place(unit, grid, classes, taken)
        soldiers.append(
            Soldier(
                team=team,
                position=Position(x=x, y=y, z=levels[y * grid.width + x]),
                vision_range=vision_range,
                communication_group_ids={f"{team.value}-team"},
            )
        )

    return Battlefield(
        width=grid.width,
        height=grid.height,
        soldiers=soldiers,
        surface=surface,
        terrain=classes,
        communication_groups=_communication_groups(
            soldier.team for soldier in soldiers
        ),
    )


def objective_briefing(payload: TerrainPayload) -> str:
    """Describe the export's objectives in grid coordinates.

    Returned as prose rather than injected anywhere: which team receives it,
    and how it combines with role orders, is a scenario decision.
    """
    grid = payload.terrain
    if not payload.objectives:
        return ""

    lines = []
    for objective in payload.objectives:
        x, y = project_cell(objective.position, grid.bbox, grid.width, grid.height)
        radius_cells = round(objective.radius_meters / grid.cell_meters)
        detail = f" ({objective.description})" if objective.description else ""
        lines.append(
            f"\n- {objective.name}{detail} is centred on ({x},{y}) "
            f"with a radius of {radius_cells} cells."
        )
    return "".join(lines)
