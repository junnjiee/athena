"""Build a Battlefield from a frontend terrain export.

The export is produced by ``frontend/src/lib/simulationExport.ts``. Its terrain
grid is row-major with **row 0 at the northernmost latitude**, which fixes the
sense of the y axis: y increases southward.

The same payload can be pulled straight from the terrain service instead of
copied out of the browser -- see ``fetch_plan`` and ``fetch_battleground``.
"""

import base64
import json
import math
import urllib.request
from collections.abc import Iterable, Sequence
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field

from athena.loaders.errors import PayloadError
from athena.loaders.grid_wire import PackedGrid, decode_grid
from athena.models import CommunicationGroup, Position, TerrainClass, Team
from athena.params import (
    DEFAULT_MOVE_BUDGET,
    NIGHT_VISION_MULTIPLIER,
    DEFAULT_SOLDIER_VISION_RANGE,
    MAX_ELEVATION_CHANGE,
    MOVE_BUDGET_BY_GAIT,
    TERRAIN_PROFILES,
)
from athena.terrain import TERRAIN_LABELS
from athena.world_state import Battlefield, Soldier

DEFAULT_FETCH_TIMEOUT = 30.0


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


class TerrainOverride(_PayloadModel):
    """One cell whose class the plan replaces after the grid is loaded.

    Field works are the case this exists for. A trench is drawn by a commander,
    not read off imagery, so it cannot arrive in the exported class grid without
    inventing a class the classifier never produces. It arrives here instead,
    and the numbering contract with the export stays untouched.
    """

    index: int = Field(ge=0)
    terrain_class: int = Field(alias="cls")


class TerrainGrid(_PayloadModel):
    bbox: BoundingBox
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    cell_meters: float = Field(gt=0)
    class_names: dict[int, str] = Field(default_factory=dict)
    cells: TerrainCells
    overrides: tuple[TerrainOverride, ...] = ()


class PayloadUnit(_PayloadModel):
    id: str
    side: str
    name: str
    position: GeoPoint
    # The drawn movement arrow this soldier was given, as the operator drew it.
    # Projected to cells and handed to the agent as waypoints -- see
    # athena.hosted.orders. Empty when the marker had no route.
    route: tuple[GeoPoint, ...] = ()
    # Gait the arrow was drawn with: "prowl", "patrol" or "charge". Biases what
    # the agent chooses, not what the movement resolver permits.
    movement_type: str | None = None
    # Establishment vision range in metres. Cells are one metre, so it is also
    # cells; if the loader is ever made to downsample, this needs converting.
    vision_range_m: float | None = None
    # The drawn marker this soldier was expanded from, and whether it is the one
    # making decisions for it. A marker that sends no section keeps every
    # soldier commanding, which is what a hand-authored scenario expects.
    section_id: str | None = None
    commander: bool = True


class PayloadObjective(_PayloadModel):
    id: str
    name: str
    description: str = ""
    position: GeoPoint
    radius_meters: float = 0.0
    # Which side is tasked with the objective. Absent means both are told about
    # it, which is the pre-existing behaviour for plans drawn before objectives
    # carried a side.
    side: str | None = None


class TerrainPayload(_PayloadModel):
    terrain: TerrainGrid
    units: tuple[PayloadUnit, ...] = ()
    objectives: tuple[PayloadObjective, ...] = ()
    # Daylight over the ground at the plan's H-hour. None keeps the pre-existing
    # behaviour of simulating every plan as though it were daytime.
    is_day: bool | None = None


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


def _check_class_codes(terrain_classes: Iterable[int]) -> None:
    """Fail on a class code this engine has no terrain class for.

    Weaker than the file path's ``_check_class_names``: the packed grid carries
    codes without names, so a *renumbering* that keeps every code in range
    cannot be detected here and would load forest as something else. Both sides
    mark the numbering as a fixed contract (``TerrainClass`` and the server's
    ``TERRAIN_CLASS``), and this catches a code outside it.
    """
    known = {int(member) for member in TerrainClass}
    unknown = sorted(set(terrain_classes) - known)
    if unknown:
        raise PayloadError(
            f"grid uses terrain class codes this engine does not know: {unknown}"
        )


def _get(url: str, timeout: float) -> bytes:
    """Fetch a URL. Transport failures propagate as urllib raises them."""
    with urllib.request.urlopen(url, timeout=timeout) as response:
        return response.read()


def _payload_from_grid(
    grid: PackedGrid,
    bbox: dict,
    units: Iterable[dict] = (),
    objectives: Iterable[dict] = (),
) -> TerrainPayload:
    """Assemble a payload from a decoded grid and the drawings over it.

    Dimensions come from the grid header rather than the battleground metadata,
    so the cell arrays and the numbers describing them cannot disagree.
    """
    _check_class_codes(grid.terrain_classes)

    return TerrainPayload(
        terrain=TerrainGrid(
            bbox=BoundingBox.model_validate(bbox),
            width=grid.width,
            height=grid.height,
            cell_meters=grid.cell_meters,
            cells=TerrainCells(
                elevation=grid.elevation,
                terrain_classes=grid.terrain_classes,
            ),
        ),
        units=tuple(PayloadUnit.model_validate(unit) for unit in units),
        objectives=tuple(
            PayloadObjective.model_validate(objective) for objective in objectives
        ),
    )


def fetch_plan(
    base_url: str,
    plan_id: str,
    *,
    timeout: float = DEFAULT_FETCH_TIMEOUT,
) -> TerrainPayload:
    """Pull a saved plan and its ground from the terrain service.

    One request to ``GET /api/plans/{id}``, which returns the drawn units and
    objectives alongside the battleground's packed grid as base64. This is the
    runnable case: a battlefield built from it has soldiers on it.

    ``base_url`` is wherever the terrain service listens, such as
    ``http://localhost:8787``.
    """
    body = json.loads(
        _get(f"{base_url.rstrip('/')}/api/plans/{plan_id}", timeout).decode("utf-8")
    )
    battleground = body["battleground"]
    plan = body["plan"]

    return _payload_from_grid(
        decode_grid(base64.b64decode(battleground["gridBufferBase64"])),
        bbox=battleground["meta"]["bbox"],
        units=plan["units"],
        objectives=plan["objectives"],
    )


def fetch_battleground(
    base_url: str,
    battleground_id: str,
    *,
    timeout: float = DEFAULT_FETCH_TIMEOUT,
) -> TerrainPayload:
    """Pull generated ground with nothing drawn on it yet.

    Two requests, because the grid crosses the wire as raw bytes with no room
    for a bounding box: ``GET /api/battleground/{id}/meta`` for the bbox and
    ``/grid`` for the terrain.

    The battlefield this builds has **no soldiers** -- ground alone, for
    inspecting terrain or placing a scenario's own laydown on it. The service
    holds an ungenerated battleground in memory only until some plan is saved
    on it, so this can 404 for ground that was never saved.
    """
    root = f"{base_url.rstrip('/')}/api/battleground/{battleground_id}"
    meta = json.loads(_get(f"{root}/meta", timeout).decode("utf-8"))["meta"]

    return _payload_from_grid(
        decode_grid(_get(f"{root}/grid", timeout)),
        bbox=meta["bbox"],
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


def import_diagnostics(payload: TerrainPayload) -> dict[str, int | bool]:
    """What is wrong with this plan before a batch is spent on it.

    Two checks, both written because the failure they predict is one operators
    actually hit and could not diagnose from the result.

    ``count_unclimbable_transitions`` counts steps the movement resolver refuses
    after real elevation is rounded to whole metres.

    Reachability is the more important one. A river, a lake or a cliff line can
    sever the ground completely, and a plan whose objective is on the far side
    is not a hard plan but an impossible one. Without this the batch runs, the
    force walks to the bank, stands there for the whole tick budget, and the
    result comes back "inconclusive" -- indistinguishable from a plan that was
    merely too slow. Measured on real ground: a force spent 120 ticks failing to
    cross a river that had no crossing.

    Reported rather than rejected: it is the operator's call whether to run it
    anyway, and a side with no objective drawn has nothing to be cut off from.
    """
    from athena.navigation import UNREACHABLE, Navigator

    grid = payload.terrain
    levels = _quantize_elevations(grid.cells.elevation)
    diagnostics: dict[str, int | bool] = {
        "cells": grid.width * grid.height,
        "unclimbableSteps": count_unclimbable_transitions(
            levels, grid.width, grid.height
        ),
    }

    battlefield = build_battlefield_from_payload(payload)
    navigator = Navigator()
    for side in ("blue", "red"):
        starts = [
            soldier
            for soldier, unit in zip(battlefield.soldiers, payload.units)
            if unit.side.lower() == side
        ]
        if not starts:
            continue
        target = starts[0].objective
        if target is None:
            continue
        reachable = any(
            navigator.distance_to(battlefield, soldier.position, target)
            != UNREACHABLE
            for soldier in starts
        )
        diagnostics[f"{side}ObjectiveReachable"] = reachable

    return diagnostics


def _apply_overrides(grid: TerrainGrid) -> tuple[int, ...]:
    """The class grid with the plan's per-cell replacements applied.

    Out-of-range indices are ignored rather than raising: the override list is
    derived from drawn footprints, and a marker on the edge of the ground can
    produce a footprint cell just outside it.
    """
    if not grid.overrides:
        return grid.cells.terrain_classes

    classes = list(grid.cells.terrain_classes)
    for override in grid.overrides:
        if 0 <= override.index < len(classes):
            classes[override.index] = override.terrain_class
    _check_class_codes(classes)
    return tuple(classes)


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
    classes = _apply_overrides(grid)
    # Night halves what a soldier picks out. Weather beyond this is still not
    # modelled: exported visibility runs to thousands of metres, far past any
    # vision range, but a plan drawn for an 0300 approach used to simulate
    # identically to a midday one, which made the mission window decorative.
    if payload.is_day is False:
        vision_range *= NIGHT_VISION_MULTIPLIER

    surface = {
        Position(x=x, y=y, z=levels[y * grid.width + x])
        for y in range(grid.height)
        for x in range(grid.width)
    }

    # The objective a side is tasked with, as a cell. Carried on the soldier so a
    # commander out of contact can march toward it without a model call deciding
    # to; the prose version still goes into the prompt for the ones that think.
    # Both sides get it, whoever owns it: taking an objective and denying one
    # both mean being on that ground. Which of the two a soldier is doing is in
    # the prose orders, and only matters once it arrives and there is something
    # to decide.
    objectives_by_side: dict[str, Position] = {}
    for objective in payload.objectives:
        ox, oy = project_cell(objective.position, grid.bbox, grid.width, grid.height)
        cell = Position(x=ox, y=oy, z=levels[oy * grid.width + ox])
        for side in ("blue", "red"):
            objectives_by_side.setdefault(side, cell)

    taken: set[tuple[int, int]] = set()
    soldiers = []
    for unit in payload.units if include_units else ():
        team = _team_for(unit)
        x, y = _place(unit, grid, classes, taken)
        waypoints = tuple(
            Position(
                x=wx,
                y=wy,
                z=levels[wy * grid.width + wx],
            )
            for wx, wy in (
                project_cell(point, grid.bbox, grid.width, grid.height)
                for point in unit.route
            )
        )
        soldiers.append(
            Soldier(
                team=team,
                position=Position(x=x, y=y, z=levels[y * grid.width + x]),
                # The establishment's own range when the plan carries one. A
                # Recon Section is drawn at 500 m against a Rifle Section's
                # 300 m, and both used to arrive as the flat default.
                vision_range=(
                    unit.vision_range_m * NIGHT_VISION_MULTIPLIER
                    if unit.vision_range_m and payload.is_day is False
                    else unit.vision_range_m or vision_range
                ),
                communication_group_ids={f"{team.value}-team"},
                # The gait its route was drawn with decides how much ground it
                # covers per tick. A marker with no route keeps the default.
                move_budget=MOVE_BUDGET_BY_GAIT.get(
                    (unit.movement_type or "").lower(),
                    DEFAULT_MOVE_BUDGET,
                ),
                section_id=unit.section_id,
                is_commander=unit.commander,
                waypoints=waypoints,
                objective=objectives_by_side.get(unit.side.lower()),
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
