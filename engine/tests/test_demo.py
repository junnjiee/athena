import asyncio
import json
import re
from io import StringIO
from random import Random

import pytest

from athena import demo
from athena.world_state import Battlefield
from athena.demo import (
    both_teams_have_living_soldiers,
    render_demo_frame,
)
from athena.loaders import PayloadError
from athena.loop import LoopEngine
from athena.resolvers.movement import MovementResolver
from athena.resolvers.shooting import ShootingResolver
from athena.resolvers.vision import VisionResolver
from athena.world_state import Soldier
from athena.models import (
    BroadcastDraft,
    TerrainClass,
    CommunicationGroup,
    HoldAction,
    IncomingFireAlert,
    IncomingFireDistance,
    MoveAction,
    MoveDirection,
    Position,
    ReplayLog,
    ShootAction,
    SurvivalState,
    Team,
)


def stub_battlefield() -> Battlefield:
    """A tiny battlefield standing in for the terrain export.

    run_demo now always loads an export, so the loop tests patch this in rather
    than reading the multi-megabyte payload from the working directory.
    """
    return Battlefield(
        width=4,
        height=2,
        soldiers=[
            Soldier(Team.BLUE, Position(x=0, y=0, z=0)),
            Soldier(Team.RED, Position(x=3, y=0, z=0)),
        ],
    )


def loop_for(soldiers: list[Soldier]) -> LoopEngine:
    return LoopEngine(
        battlefield=Battlefield(width=4, height=2, soldiers=soldiers),
        vision_resolver=VisionResolver(),
        movement_resolver=MovementResolver(rng=Random(0)),
        shooting_resolver=ShootingResolver(rng=Random(0)),
    )


def test_render_demo_frame_shows_shot_and_casualty_transition(capsys) -> None:
    shooter = Soldier(Team.BLUE, Position(x=0, y=0, z=0))
    target = Soldier(Team.RED, Position(x=2, y=0, z=0))
    loop = loop_for([shooter, target])
    result = loop.execute_actions(
        [ShootAction(target_position=target.position), None]
    )

    render_demo_frame(
        "After tick 1",
        loop.battlefield,
        loop.observed_soldiers_map(),
        execution_result=result,
    )

    output = capsys.readouterr().out
    assert "B . r ." in output
    assert "soldier 0 blue: shoot (2,0,0) (hit, p=90%" in output
    assert "status alive -> casualty" in output
    assert "terrain: 8 cells (all open ground)" in output


def test_render_demo_frame_labels_one_conflicting_move_as_accepted(capsys) -> None:
    first = Soldier(Team.BLUE, Position(x=0, y=0, z=0))
    second = Soldier(Team.RED, Position(x=2, y=0, z=0))
    loop = loop_for([first, second])
    result = loop.execute_actions(
        [
            MoveAction(direction=MoveDirection.EAST),
            MoveAction(direction=MoveDirection.WEST),
        ]
    )

    render_demo_frame(
        "After tick 1",
        loop.battlefield,
        loop.observed_soldiers_map(),
        execution_result=result,
    )

    output = capsys.readouterr().out
    assert "soldier 0 blue: move east (rejected)" in output
    assert "soldier 1 red: move west (accepted)" in output
    assert "position (2,0,0) -> (1,0,0)" in output


def test_render_demo_frame_shows_hold_action(capsys) -> None:
    soldier = Soldier(Team.RED, Position(x=1, y=1, z=0))
    loop = loop_for([soldier])
    result = loop.execute_actions([HoldAction()])

    render_demo_frame(
        "After tick 1",
        loop.battlefield,
        loop.observed_soldiers_map(),
        execution_result=result,
    )

    assert "soldier 0 red: hold" in capsys.readouterr().out


def test_render_demo_frame_shows_team_broadcast(capsys) -> None:
    group = CommunicationGroup(
        group_id="blue-team",
        name="Blue Team",
        team=Team.BLUE,
    )
    blue = Soldier(
        Team.BLUE,
        Position(x=0, y=0, z=0),
        communication_group_ids={group.group_id},
    )
    battlefield = Battlefield(
        width=2,
        height=1,
        soldiers=[blue],
        communication_groups=[group],
    )
    loop = LoopEngine(
        battlefield=battlefield,
        vision_resolver=VisionResolver(),
        movement_resolver=MovementResolver(),
    )
    result = loop.execute_actions(
        [MoveAction(direction=MoveDirection.EAST)],
        broadcasts=[
            BroadcastDraft(
                group_id=group.group_id,
                content="Moving to the ridge.",
            )
        ],
    )

    render_demo_frame(
        "After tick 1",
        battlefield,
        loop.observed_soldiers_map(),
        execution_result=result,
    )

    output = capsys.readouterr().out
    assert "soldier 0 -> blue-team: Moving to the ridge." in output


def test_scroll_frame_shows_latest_incoming_fire_known_to_agent() -> None:
    blue = Soldier(Team.BLUE, Position(x=0, y=0, z=0))
    red = Soldier(Team.RED, Position(x=2, y=0, z=0))
    loop = loop_for([blue, red])

    output = demo.scroll_frame(
        "After tick 1",
        loop.battlefield,
        loop.observed_soldiers_map(),
        color=False,
        incoming_fire_history=(
            (),
            (
                IncomingFireAlert(
                    tick=1,
                    source_bearing=MoveDirection.WEST,
                    source_distance=IncomingFireDistance.NEAR,
                ),
            ),
        ),
    )

    assert "F:W/near" in output


def test_render_demo_frame_colors_elevated_cells(capsys) -> None:
    surface = {
        Position(x=0, y=0, z=0),
        Position(x=1, y=0, z=1),
        Position(x=2, y=0, z=2),
        Position(x=3, y=0, z=3),
    }
    battlefield = Battlefield(width=4, height=1, soldiers=[], surface=surface)

    render_demo_frame("Elevations", battlefield, [])

    output = capsys.readouterr().out
    assert ". \033[38;5;226m.\033[0m \033[38;5;208m.\033[0m \033[38;5;94m.\033[0m" in output


def test_render_demo_frame_writes_complete_frame_atomically(monkeypatch) -> None:
    class RecordingStdout(StringIO):
        def __init__(self) -> None:
            super().__init__()
            self.writes: list[str] = []

        def write(self, text: str) -> int:
            self.writes.append(text)
            return super().write(text)

    stdout = RecordingStdout()
    monkeypatch.setattr(demo.sys, "stdout", stdout)
    battlefield = Battlefield(width=1, height=1, soldiers=[])

    render_demo_frame("Frame", battlefield, [])

    assert len(stdout.writes) == 1
    assert stdout.writes[0].startswith("\033[H\033[2JFrame\n")


def test_run_demo_reports_progress_until_requested_tick(monkeypatch) -> None:
    labels: list[str] = []

    async def choose_none(**_: object) -> None:
        return None

    monkeypatch.setattr(demo, "build_action_chooser", lambda _: choose_none)
    monkeypatch.setattr(demo, "build_battlefield", lambda *_a, **_k: stub_battlefield())
    monkeypatch.setattr(
        demo,
        "render_scroll_frame",
        lambda label, *_args, **_kwargs: labels.append(label),
    )

    asyncio.run(demo.run_demo(ticks=4))

    assert labels == [
        "Initial - running tick 1 (waiting for agents)",
        "After tick 1 - running tick 2 (waiting for agents)",
        "After tick 2 - running tick 3 (waiting for agents)",
        "After tick 3 - running tick 4 (waiting for agents)",
        "After tick 4 - tick limit reached",
    ]


def test_run_demo_writes_replay_log(monkeypatch, tmp_path) -> None:
    async def choose_none(**_: object) -> None:
        return None

    monkeypatch.setattr(demo, "build_action_chooser", lambda _: choose_none)
    monkeypatch.setattr(demo, "build_battlefield", lambda *_a, **_k: stub_battlefield())
    monkeypatch.setattr(demo, "render_scroll_frame", lambda *_args, **_kwargs: None)
    output_path = tmp_path / "demo.json"

    asyncio.run(demo.run_demo(ticks=2, replay_log_path=output_path))

    replay_log = ReplayLog.model_validate_json(output_path.read_text())
    assert [step.step for step in replay_log.steps] == [0, 1, 2]
    assert all(step.shots == () for step in replay_log.steps)
    assert all(step.messages == () for step in replay_log.steps)


def test_battle_finishes_when_one_team_has_no_living_soldiers() -> None:
    blue = Soldier(Team.BLUE, Position(x=0, y=0, z=0))
    red = Soldier(Team.RED, Position(x=2, y=0, z=0))
    loop = loop_for([blue, red])

    assert both_teams_have_living_soldiers(loop.battlefield)

    loop.execute_actions([ShootAction(target_position=red.position), None])

    assert not both_teams_have_living_soldiers(loop.battlefield)


def test_each_terrain_class_renders_a_distinct_glyph() -> None:
    assert len(set(demo.TERRAIN_GLYPHS.values())) == len(TerrainClass)
    assert set(demo.TERRAIN_GLYPHS) == set(TerrainClass)


def test_terrain_legend_names_only_the_classes_present() -> None:
    battlefield = Battlefield(
        width=3,
        height=1,
        soldiers=[],
        terrain={Position(x=1, y=0, z=0): TerrainClass.ROAD},
    )

    legend = demo.terrain_legend(battlefield)

    assert legend == ".=Open Ground ==Road"
    assert "Water" not in legend


def test_flat_ground_is_left_uncoloured() -> None:
    assert demo.elevation_color(0, 0, 0) is None
    assert demo.elevation_color(5, 5, 5) is None


def test_elevation_ramp_bands_relative_to_the_maps_own_range() -> None:
    # The lowest band stays uncoloured; the highest reaches the end of the ramp.
    assert demo.elevation_color(0, 0, 3) is None
    assert demo.elevation_color(3, 0, 3) == demo.ELEVATION_RAMP[-1]
    # A 26-level import spans the same ramp as a 3-level demo hill.
    assert demo.elevation_color(17, 17, 42) is None
    assert demo.elevation_color(42, 17, 42) == demo.ELEVATION_RAMP[-1]
    assert demo.elevation_color(30, 17, 42) in demo.ELEVATION_RAMP


def test_small_maps_render_at_full_resolution() -> None:
    battlefield = Battlefield(width=12, height=8, soldiers=[])

    rows = demo.map_frame(battlefield, columns=118).splitlines()

    # One glyph per cell, space separated, every row present.
    assert len(rows) == 8
    assert all(len(row) == 12 * 2 - 1 for row in rows)


def test_maps_too_wide_for_the_terminal_are_aggregated_not_cropped() -> None:
    battlefield = Battlefield(width=354, height=400, soldiers=[])

    rows = demo.map_frame(battlefield, columns=118).splitlines()

    assert rows[0].startswith("354x400 at 3x6 m/char")
    body = rows[1:]
    # Every cell is represented: 400 rows of 6, 354 columns of 3.
    assert len(body) == 400 // 6 + 1
    assert all(len(row) == 118 for row in body)


PAYLOAD_2X2 = {
    "terrain": {
        "bbox": {"west": 0.0, "south": 0.0, "east": 1.0, "north": 1.0},
        "width": 2,
        "height": 2,
        "cellMeters": 1,
        "classNames": {"3": "Dense Forest"},
        "cells": {"elevation": [0.0, 0.0, 0.0, 0.0], "cls": [3, 3, 3, 3]},
    },
    "units": [
        {
            "id": "b",
            "side": "blue",
            "name": "Alpha",
            "position": {"longitude": 0.1, "latitude": 0.1},
        }
    ],
    "objectives": [],
}


def write_payload(tmp_path) -> object:
    payload = tmp_path / "payload.json"
    payload.write_text(json.dumps(PAYLOAD_2X2), encoding="utf-8")
    return payload


def test_the_scenario_places_troops_and_ignores_the_exports_own_units(
    monkeypatch, tmp_path
) -> None:
    # The export ships one blue unit; the scenario's own laydown replaces it,
    # because the export spreads its echelons too far apart to ever make contact.
    monkeypatch.setattr(demo, "BLUE_CELLS", ((0, 0),))
    monkeypatch.setattr(demo, "RED_CELLS", ((1, 1),))

    battlefield = demo.build_battlefield(write_payload(tmp_path))

    assert (battlefield.width, battlefield.height) == (2, 2)
    assert battlefield.terrain_at(0, 0) == TerrainClass.DENSE_FOREST
    assert [
        (soldier.team, soldier.position.x, soldier.position.y)
        for soldier in battlefield.soldiers
    ] == [(Team.BLUE, 0, 0), (Team.RED, 1, 1)]


def test_a_deployment_cell_off_the_map_is_rejected(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(demo, "BLUE_CELLS", ((0, 0),))
    monkeypatch.setattr(demo, "RED_CELLS", ((9, 9),))

    with pytest.raises(PayloadError, match=r"\(9,9\) is outside the 2x2 map"):
        demo.build_battlefield(write_payload(tmp_path))


def test_every_soldier_appears_on_an_aggregated_map() -> None:
    # Cropping used to hide most of the force; aggregation must not.
    soldiers = [
        Soldier(Team.RED, Position(x=77, y=83, z=0)),
        Soldier(Team.BLUE, Position(x=294, y=321, z=0)),
    ]
    battlefield = Battlefield(width=354, height=400, soldiers=soldiers)

    frame = demo.map_frame(battlefield, columns=118)

    assert "R" in frame
    assert "B" in frame


def test_full_map_surfaces_rare_classes_over_the_dominant_one() -> None:
    # A single road cell inside a block of forest must survive aggregation;
    # majority-wins would erase every road on a mostly-forest map.
    terrain = [TerrainClass.DENSE_FOREST] * (120 * 120)
    terrain[5 * 120 + 5] = TerrainClass.ROAD
    battlefield = Battlefield(
        width=120, height=120, soldiers=[], terrain=terrain
    )

    frame = demo.map_frame(battlefield, columns=60)

    assert demo.TERRAIN_GLYPHS[TerrainClass.ROAD] in frame


def test_a_deployment_cell_on_impassable_ground_is_rejected(
    monkeypatch, tmp_path
) -> None:
    # Structure is impassable, so a soldier cannot be deployed onto it. Catching
    # this at build time beats discovering it when the first move is rejected.
    payload = tmp_path / "payload.json"
    impassable = json.loads(json.dumps(PAYLOAD_2X2))
    impassable["terrain"]["classNames"] = {"3": "Dense Forest", "7": "Structure"}
    impassable["terrain"]["cells"]["cls"] = [3, 7, 3, 3]
    payload.write_text(json.dumps(impassable), encoding="utf-8")

    monkeypatch.setattr(demo, "BLUE_CELLS", ((1, 0),))
    monkeypatch.setattr(demo, "RED_CELLS", ((0, 1),))

    with pytest.raises(PayloadError, match="no soldier can stand on"):
        demo.build_battlefield(payload)


def bounded_battlefield(soldiers: list[Soldier]) -> Battlefield:
    return Battlefield(width=40, height=30, soldiers=soldiers)


def test_minimap_bounds_contain_every_soldier_whatever_their_state() -> None:
    # The guarantee is that the box is defined by the soldiers, so a casualty
    # or a body cannot fall outside it and quietly vanish from the view.
    soldiers = [
        Soldier(Team.BLUE, Position(x=20, y=15, z=0)),
        Soldier(
            Team.BLUE,
            Position(x=31, y=22, z=0),
            survival_status=SurvivalState.CASUALTY,
        ),
        Soldier(
            Team.RED,
            Position(x=8, y=4, z=0),
            survival_status=SurvivalState.DEAD,
        ),
    ]
    battlefield = bounded_battlefield(soldiers)

    x0, y0, x1, y1 = demo.soldier_bounds(battlefield)

    for soldier in battlefield.soldiers:
        assert x0 <= soldier.position.x <= x1
        assert y0 <= soldier.position.y <= y1


def test_minimap_bounds_clamp_to_the_map() -> None:
    # A soldier in the corner would push the margin negative, and one on the
    # far edge past the last column.
    battlefield = bounded_battlefield(
        [
            Soldier(Team.BLUE, Position(x=0, y=0, z=0)),
            Soldier(Team.RED, Position(x=39, y=29, z=0)),
        ]
    )

    assert demo.soldier_bounds(battlefield) == (0, 0, 39, 29)


def test_minimap_bounds_fall_back_to_the_whole_map_without_soldiers() -> None:
    battlefield = bounded_battlefield([])

    assert demo.soldier_bounds(battlefield) == demo.full_bounds(battlefield)


def test_minimap_bounds_track_the_soldiers_not_the_map() -> None:
    battlefield = bounded_battlefield(
        [
            Soldier(Team.BLUE, Position(x=20, y=15, z=0)),
            Soldier(Team.RED, Position(x=22, y=17, z=0)),
        ]
    )

    assert demo.soldier_bounds(battlefield, margin=2) == (18, 13, 24, 19)


def test_map_lines_renders_only_the_requested_box() -> None:
    battlefield = bounded_battlefield([Soldier(Team.BLUE, Position(x=5, y=5, z=0))])

    rows = demo.map_lines(battlefield, (4, 4, 8, 7), color=False)

    ruler, body = rows[0], rows[1:]
    # One row per y in the box, and one column per x, after the 5-char gutter.
    assert len(body) == 4
    assert all(len(row) == 5 + 5 for row in body)
    # The ruler reports real coordinates, not offsets from the box.
    assert ruler == f"{'':<5}00000"
    # Row y=5 is the second in the box; x=5 is one column in, after the gutter.
    assert body[1][5 + (5 - 4)] == "B"


def test_map_lines_over_full_bounds_covers_the_whole_map() -> None:
    battlefield = bounded_battlefield([])

    rows = demo.map_lines(battlefield, demo.full_bounds(battlefield), color=False)

    assert len(rows) == 30 + 1
    assert all(len(row) == 40 + 5 for row in rows[1:])


def test_soldiers_in_the_far_corners_still_render() -> None:
    # The trailing partial block must be emitted, or the last row and column
    # of the map would silently vanish.
    corner = Soldier(Team.BLUE, Position(x=0, y=0, z=0))
    far = Soldier(Team.RED, Position(x=353, y=399, z=0))
    battlefield = Battlefield(width=354, height=400, soldiers=[corner, far])

    rows = [
        re.sub(r"\033\[[0-9;]*m", "", row)
        for row in demo.map_frame(battlefield, columns=118).splitlines()[1:]
    ]

    assert rows[0].startswith("B")
    assert rows[-1].endswith("R")
