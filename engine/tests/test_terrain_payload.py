import json

import pytest

from athena.loaders import (
    PayloadError,
    build_battlefield_from_payload,
    load_payload,
    objective_briefing,
    project_cell,
)
from athena.loaders.terrain_payload import (
    import_diagnostics,
    BoundingBox,
    GeoPoint,
    TerrainPayload,
    count_unclimbable_transitions,
)
from athena.models import TerrainClass, Team

BBOX = {"west": 0.0, "south": 0.0, "east": 1.0, "north": 1.0}


def payload_dict(
    width: int = 2,
    height: int = 2,
    elevation: list[float] | None = None,
    cls: list[int] | None = None,
    units: list[dict] | None = None,
    objectives: list[dict] | None = None,
    class_names: dict[str, str] | None = None,
) -> dict:
    cells = width * height
    return {
        "terrain": {
            "bbox": BBOX,
            "width": width,
            "height": height,
            "cellMeters": 1,
            "classNames": class_names
            if class_names is not None
            else {
                "0": "Open Ground",
                "3": "Dense Forest",
                "5": "Water",
            },
            "cells": {
                "elevation": elevation if elevation is not None else [0.0] * cells,
                "cls": cls if cls is not None else [0] * cells,
            },
        },
        "units": units or [],
        "objectives": objectives or [],
    }


def unit(side: str, longitude: float, latitude: float, name: str = "Alpha") -> dict:
    return {
        "id": f"{side}-{name}",
        "side": side,
        "name": name,
        "position": {"longitude": longitude, "latitude": latitude},
    }


def write(tmp_path, data: dict):
    path = tmp_path / "payload.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


def test_row_zero_is_the_northernmost_row() -> None:
    bbox = BoundingBox(west=0.0, south=0.0, east=1.0, north=1.0)

    # The exporter documents row 0 as northernmost, so a high latitude must
    # land at a low y. Getting this backwards mirrors the whole laydown.
    assert project_cell(GeoPoint(longitude=0.1, latitude=0.9), bbox, 10, 10) == (1, 0)
    assert project_cell(GeoPoint(longitude=0.1, latitude=0.1), bbox, 10, 10) == (1, 9)


def test_projection_bins_cells_and_clamps_at_the_edges() -> None:
    bbox = BoundingBox(west=0.0, south=0.0, east=1.0, north=1.0)

    # The east/north edge belongs to the last cell rather than falling off it.
    assert project_cell(GeoPoint(longitude=1.0, latitude=1.0), bbox, 4, 4) == (3, 0)
    assert project_cell(GeoPoint(longitude=0.0, latitude=0.0), bbox, 4, 4) == (0, 3)
    # Points outside the box clamp instead of raising.
    assert project_cell(GeoPoint(longitude=9.0, latitude=-9.0), bbox, 4, 4) == (3, 3)


def test_terrain_grid_loads_row_major(tmp_path) -> None:
    path = write(
        tmp_path,
        payload_dict(width=2, height=2, cls=[0, 3, 3, 0]),
    )

    battlefield = build_battlefield_from_payload(load_payload(path))

    assert battlefield.terrain_at(0, 0) == TerrainClass.OPEN_GROUND
    assert battlefield.terrain_at(1, 0) == TerrainClass.DENSE_FOREST
    assert battlefield.terrain_at(0, 1) == TerrainClass.DENSE_FOREST
    assert battlefield.terrain_at(1, 1) == TerrainClass.OPEN_GROUND


def test_elevation_is_quantized_with_the_lowest_cell_at_zero(tmp_path) -> None:
    path = write(
        tmp_path,
        payload_dict(width=2, height=2, elevation=[17.4, 18.6, 20.0, 42.2]),
    )

    battlefield = build_battlefield_from_payload(load_payload(path))

    assert battlefield.position_at(0, 0).z == 0
    assert battlefield.position_at(1, 0).z == 2
    assert battlefield.position_at(0, 1).z == 3
    assert battlefield.position_at(1, 1).z == 25


def test_units_become_soldiers_with_a_group_per_side_present(tmp_path) -> None:
    path = write(
        tmp_path,
        payload_dict(
            width=4,
            height=4,
            units=[unit("blue", 0.1, 0.1), unit("red", 0.9, 0.9, name="Bravo")],
        ),
    )

    battlefield = build_battlefield_from_payload(load_payload(path))

    assert [soldier.team for soldier in battlefield.soldiers] == [Team.BLUE, Team.RED]
    assert battlefield.soldiers[0].position.y == 3
    assert battlefield.soldiers[1].position.y == 0
    assert {group.group_id for group in battlefield.communication_groups} == {
        "blue-team",
        "red-team",
    }


def test_a_side_with_no_units_gets_no_communication_group(tmp_path) -> None:
    path = write(tmp_path, payload_dict(width=4, height=4, units=[unit("blue", 0.1, 0.1)]))

    battlefield = build_battlefield_from_payload(load_payload(path))

    assert [group.group_id for group in battlefield.communication_groups] == [
        "blue-team"
    ]


def test_units_sharing_a_cell_are_nudged_apart(tmp_path) -> None:
    # Two units close enough to project onto one cell would trip the
    # battlefield's occupancy validation.
    path = write(
        tmp_path,
        payload_dict(
            width=4,
            height=4,
            units=[
                unit("blue", 0.11, 0.11, name="Alpha"),
                unit("blue", 0.12, 0.12, name="Bravo"),
            ],
        ),
    )

    battlefield = build_battlefield_from_payload(load_payload(path))

    positions = [
        (soldier.position.x, soldier.position.y) for soldier in battlefield.soldiers
    ]
    assert len(set(positions)) == 2


def test_units_are_nudged_off_impassable_terrain(tmp_path) -> None:
    path = write(
        tmp_path,
        payload_dict(width=2, height=2, cls=[5, 0, 0, 0], units=[unit("blue", 0.1, 0.9)]),
    )

    battlefield = build_battlefield_from_payload(load_payload(path))

    soldier = battlefield.soldiers[0]
    assert (soldier.position.x, soldier.position.y) != (0, 0)
    assert battlefield.profile_for(soldier.position).passable


def test_unknown_side_is_rejected(tmp_path) -> None:
    path = write(tmp_path, payload_dict(units=[unit("green", 0.1, 0.1)]))

    with pytest.raises(PayloadError, match="unknown side"):
        build_battlefield_from_payload(load_payload(path))


def test_cell_count_mismatch_is_rejected(tmp_path) -> None:
    path = write(tmp_path, payload_dict(width=3, height=3, cls=[0, 0]))

    with pytest.raises(PayloadError, match="expected 9"):
        load_payload(path)


def test_missing_terrain_is_rejected(tmp_path) -> None:
    path = write(tmp_path, {"terrain": None, "units": []})

    with pytest.raises(PayloadError, match="no terrain grid"):
        load_payload(path)


def test_renumbered_terrain_classes_are_rejected(tmp_path) -> None:
    # TerrainClass indices are assumed to match the export exactly. If the
    # exporter ever renumbers, forest would silently load as something else.
    path = write(tmp_path, payload_dict(class_names={"3": "Water"}))

    with pytest.raises(PayloadError, match="do not match TerrainClass"):
        load_payload(path)


def test_unknown_terrain_class_index_is_rejected(tmp_path) -> None:
    path = write(tmp_path, payload_dict(class_names={"42": "Lava"}))

    with pytest.raises(PayloadError, match="unknown"):
        load_payload(path)


def test_unconsumed_export_fields_are_ignored(tmp_path) -> None:
    data = payload_dict()
    data["weather"] = {"isDay": False}
    data["routes"] = [{"id": "r1", "points": []}]
    data["units"] = [{**unit("blue", 0.1, 0.1), "symbolKind": "blueSection"}]
    path = write(tmp_path, data)

    assert build_battlefield_from_payload(load_payload(path)).soldiers


def test_unclimbable_transitions_are_counted() -> None:
    # A two-level step between neighbours is more than a soldier can climb.
    assert count_unclimbable_transitions([0, 0, 0, 0], 2, 2) == 0
    assert count_unclimbable_transitions([0, 5, 0, 0], 2, 2) == 2


def test_objective_briefing_reports_grid_coordinates(tmp_path) -> None:
    path = write(
        tmp_path,
        payload_dict(
            width=10,
            height=10,
            objectives=[
                {
                    "id": "obj-1",
                    "name": "OBJ ALPHA",
                    "description": "Capture & Hold",
                    "position": {"longitude": 0.5, "latitude": 0.5},
                    "radiusMeters": 3,
                }
            ],
        ),
    )

    briefing = objective_briefing(load_payload(path))

    assert "OBJ ALPHA (Capture & Hold) is centred on (5,5)" in briefing
    assert "radius of 3 cells" in briefing


def test_objective_briefing_is_empty_without_objectives(tmp_path) -> None:
    path = write(tmp_path, payload_dict())

    assert objective_briefing(load_payload(path)) == ""


def test_payload_round_trips_through_the_model(tmp_path) -> None:
    path = write(tmp_path, payload_dict(units=[unit("red", 0.1, 0.1)]))

    payload = load_payload(path)

    assert isinstance(payload, TerrainPayload)
    assert payload.terrain.cell_meters == 1
    assert payload.units[0].side == "red"


def _ground(**extra) -> dict:
    """A 4x4 flat payload with one blue and one red marker."""
    payload = {
        "terrain": {
            "bbox": {"west": 0, "south": 0, "east": 1, "north": 1},
            "width": 4,
            "height": 4,
            "cellMeters": 1,
            "classNames": {"0": "Open Ground"},
            "cells": {"elevation": [0] * 16, "cls": [0] * 16},
        },
        "units": [
            {
                "id": "blue-1",
                "side": "blue",
                "name": "Blue 1",
                "position": {"longitude": 0.1, "latitude": 0.9},
            },
            {
                "id": "red-1",
                "side": "red",
                "name": "Red 1",
                "position": {"longitude": 0.9, "latitude": 0.1},
            },
        ],
    }
    payload.update(extra)
    return payload


def test_a_trench_override_makes_the_ground_protective() -> None:
    # A trench used to reach the engine as one soldier standing on whatever the
    # classifier decided that cell was, so the works themselves did nothing.
    from athena.params import TERRAIN_PROFILES
    from athena.models import TerrainClass

    raw = _ground()
    raw["terrain"]["overrides"] = [
        {"index": 5, "cls": int(TerrainClass.TRENCH)},
        {"index": 6, "cls": int(TerrainClass.TRENCH)},
    ]

    battlefield = build_battlefield_from_payload(
        TerrainPayload.model_validate(raw)
    )

    assert battlefield.terrain_at(1, 1) == TerrainClass.TRENCH
    assert battlefield.terrain_at(2, 1) == TerrainClass.TRENCH
    assert battlefield.terrain_at(0, 0) == TerrainClass.OPEN_GROUND
    assert TERRAIN_PROFILES[TerrainClass.TRENCH].protection > (
        TERRAIN_PROFILES[TerrainClass.OPEN_GROUND].protection
    )


def test_an_override_outside_the_grid_is_ignored() -> None:
    # Footprints are derived from drawn markers, and a marker near the edge can
    # produce a cell just off the ground.
    from athena.models import TerrainClass

    raw = _ground()
    raw["terrain"]["overrides"] = [{"index": 9999, "cls": int(TerrainClass.TRENCH)}]

    battlefield = build_battlefield_from_payload(
        TerrainPayload.model_validate(raw)
    )

    assert all(
        battlefield.terrain_at(x, y) == TerrainClass.OPEN_GROUND
        for x in range(4)
        for y in range(4)
    )


def test_a_night_plan_halves_what_a_soldier_can_pick_out() -> None:
    from athena.params import DEFAULT_SOLDIER_VISION_RANGE, NIGHT_VISION_MULTIPLIER

    day = build_battlefield_from_payload(
        TerrainPayload.model_validate(_ground(isDay=True))
    )
    night = build_battlefield_from_payload(
        TerrainPayload.model_validate(_ground(isDay=False))
    )

    assert day.soldiers[0].vision_range == DEFAULT_SOLDIER_VISION_RANGE
    assert night.soldiers[0].vision_range == (
        DEFAULT_SOLDIER_VISION_RANGE * NIGHT_VISION_MULTIPLIER
    )


def test_a_plan_with_no_daylight_stated_simulates_as_daytime() -> None:
    from athena.params import DEFAULT_SOLDIER_VISION_RANGE

    battlefield = build_battlefield_from_payload(
        TerrainPayload.model_validate(_ground())
    )

    assert battlefield.soldiers[0].vision_range == DEFAULT_SOLDIER_VISION_RANGE


def test_an_establishment_brings_its_own_vision_range() -> None:
    raw = _ground()
    raw["units"][0]["visionRangeM"] = 500

    battlefield = build_battlefield_from_payload(
        TerrainPayload.model_validate(raw)
    )

    assert battlefield.soldiers[0].vision_range == 500
    assert battlefield.soldiers[1].vision_range == 10.0


def test_a_gait_sets_the_movement_allowance() -> None:
    from athena.params import DEFAULT_MOVE_BUDGET, MOVE_BUDGET_BY_GAIT

    raw = _ground()
    raw["units"][0]["movementType"] = "charge"

    battlefield = build_battlefield_from_payload(
        TerrainPayload.model_validate(raw)
    )

    assert battlefield.soldiers[0].move_budget == MOVE_BUDGET_BY_GAIT["charge"]
    assert battlefield.soldiers[1].move_budget == DEFAULT_MOVE_BUDGET


def _severed_ground(**extra) -> dict:
    """A 9x9 ground cut in two by a river with no crossing."""
    water = {(x, 4) for x in range(9)}
    cls = [
        5 if (x, y) in water else 0
        for y in range(9)
        for x in range(9)
    ]
    payload = {
        "terrain": {
            "bbox": {"west": 0, "south": 0, "east": 1, "north": 1},
            "width": 9,
            "height": 9,
            "cellMeters": 1,
            "classNames": {"0": "Open Ground", "5": "Water"},
            "cells": {"elevation": [0] * 81, "cls": cls},
        },
        "units": [
            {
                "id": "blue-1",
                "side": "blue",
                "name": "Blue 1",
                "position": {"longitude": 0.5, "latitude": 0.05},
            },
            {
                "id": "red-1",
                "side": "red",
                "name": "Red 1",
                "position": {"longitude": 0.5, "latitude": 0.95},
            },
        ],
        "objectives": [
            {
                "id": "obj-1",
                "name": "OBJ",
                "position": {"longitude": 0.5, "latitude": 0.95},
                "radiusMeters": 1.0,
                "side": "blue",
            }
        ],
    }
    payload.update(extra)
    return payload


def test_an_objective_across_an_uncrossable_river_is_reported_before_the_batch_runs():
    """The failure this exists for happened on real ground.

    A force walked to a river with no crossing, stood on the bank for 120 ticks,
    and the batch came back "inconclusive" -- indistinguishable from a plan that
    was merely too slow. The plan was not slow, it was impossible.
    """
    diagnostics = import_diagnostics(
        TerrainPayload.model_validate(_severed_ground())
    )

    assert diagnostics["blueObjectiveReachable"] is False
    # Red is standing on it.
    assert diagnostics["redObjectiveReachable"] is True


def test_a_reachable_objective_is_reported_as_such() -> None:
    raw = _severed_ground()
    # Open a crossing at the eastern end.
    raw["terrain"]["cells"]["cls"][4 * 9 + 8] = 0

    diagnostics = import_diagnostics(TerrainPayload.model_validate(raw))

    assert diagnostics["blueObjectiveReachable"] is True


def test_a_plan_with_no_objective_reports_no_reachability() -> None:
    raw = _severed_ground()
    raw["objectives"] = []

    diagnostics = import_diagnostics(TerrainPayload.model_validate(raw))

    assert "blueObjectiveReachable" not in diagnostics
    assert "redObjectiveReachable" not in diagnostics
