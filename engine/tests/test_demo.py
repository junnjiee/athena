import asyncio
import json
from io import StringIO
from random import Random

from athena import demo
from athena.world_state import Battlefield
from athena.demo import (
    both_teams_have_living_soldiers,
    render_demo_frame,
)
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
    MoveAction,
    MoveDirection,
    Position,
    ReplayLog,
    ShootAction,
    Team,
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
    monkeypatch.setattr(
        demo,
        "render_demo_frame",
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
    monkeypatch.setattr(demo, "render_demo_frame", lambda *_args, **_kwargs: None)
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


def test_small_maps_render_whole() -> None:
    battlefield = Battlefield(width=12, height=8, soldiers=[])

    assert demo.viewport_bounds(battlefield) == (0, 0, 12, 8)


def test_large_maps_window_onto_the_soldiers() -> None:
    soldier = Soldier(Team.BLUE, Position(x=180, y=127, z=0))
    battlefield = Battlefield(width=354, height=400, soldiers=[soldier])

    x0, y0, x1, y1 = demo.viewport_bounds(battlefield, max_width=60, max_height=40)

    assert (x1 - x0, y1 - y0) == (60, 40)
    assert x0 <= soldier.position.x < x1
    assert y0 <= soldier.position.y < y1


def test_viewport_centres_on_the_larger_group_not_the_empty_middle() -> None:
    # Two forces facing each other across a large map: the midrange of their
    # positions is empty ground, so a midrange-centred window frames nobody.
    north = [
        Soldier(Team.RED, Position(x=180, y=80 + offset, z=0)) for offset in range(5)
    ]
    south = [Soldier(Team.BLUE, Position(x=180, y=320 + offset, z=0)) for offset in (0, 1)]
    battlefield = Battlefield(
        width=354, height=400, soldiers=[*north, *south]
    )

    x0, y0, x1, y1 = demo.viewport_bounds(battlefield, max_width=60, max_height=40)

    assert any(y0 <= soldier.position.y < y1 for soldier in north)


def test_run_demo_builds_the_battlefield_from_a_payload(monkeypatch, tmp_path) -> None:
    payload = tmp_path / "payload.json"
    payload.write_text(
        json.dumps(
            {
                "terrain": {
                    "bbox": {"west": 0.0, "south": 0.0, "east": 1.0, "north": 1.0},
                    "width": 2,
                    "height": 2,
                    "cellMeters": 1,
                    "classNames": {"3": "Dense Forest"},
                    "cells": {
                        "elevation": [0.0, 0.0, 0.0, 0.0],
                        "cls": [3, 3, 3, 3],
                    },
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
        ),
        encoding="utf-8",
    )
    rendered: list[Battlefield] = []

    async def choose_none(**_: object) -> None:
        return None

    monkeypatch.setattr(demo, "build_action_chooser", lambda _: choose_none)
    monkeypatch.setattr(
        demo,
        "render_demo_frame",
        lambda _label, battlefield, *_a, **_k: rendered.append(battlefield),
    )

    asyncio.run(demo.run_demo(ticks=0, payload_path=payload))

    battlefield = rendered[0]
    assert (battlefield.width, battlefield.height) == (2, 2)
    assert battlefield.terrain_at(0, 0) == TerrainClass.DENSE_FOREST
    assert [soldier.team for soldier in battlefield.soldiers] == [Team.BLUE]


def test_full_map_covers_the_whole_grid_without_cropping() -> None:
    battlefield = Battlefield(width=354, height=400, soldiers=[])

    frame = demo.full_map_frame(battlefield, columns=118)
    rows = frame.splitlines()[1:-1]

    # 3x6 m blocks over 354x400: every cell is represented, nothing cropped.
    assert len(rows) == 400 // 6 + 1
    assert all(len(row) == 118 for row in rows)


def test_full_map_surfaces_rare_classes_over_the_dominant_one() -> None:
    # A single road cell inside a block of forest must survive aggregation;
    # majority-wins would erase every road on a mostly-forest map.
    terrain = [TerrainClass.DENSE_FOREST] * (120 * 120)
    terrain[5 * 120 + 5] = TerrainClass.ROAD
    battlefield = Battlefield(
        width=120, height=120, soldiers=[], terrain=terrain
    )

    frame = demo.full_map_frame(battlefield, columns=60)

    assert demo.TERRAIN_GLYPHS[TerrainClass.ROAD] in frame


def test_payload_can_be_loaded_without_units(tmp_path) -> None:
    payload = tmp_path / "payload.json"
    payload.write_text(
        json.dumps(
            {
                "terrain": {
                    "bbox": {"west": 0.0, "south": 0.0, "east": 1.0, "north": 1.0},
                    "width": 2,
                    "height": 2,
                    "cellMeters": 1,
                    "classNames": {"3": "Dense Forest"},
                    "cells": {
                        "elevation": [0.0, 0.0, 0.0, 0.0],
                        "cls": [3, 3, 3, 3],
                    },
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
        ),
        encoding="utf-8",
    )

    with_units, _ = demo.build_payload_battlefield(payload)
    without_units, _ = demo.build_payload_battlefield(payload, include_units=False)

    assert len(with_units.soldiers) == 1
    assert without_units.soldiers == []
    # Terrain is unaffected by dropping the units.
    assert without_units.terrain_classes == with_units.terrain_classes


def test_viewport_clamps_to_the_grid_at_the_edges() -> None:
    corner = Soldier(Team.BLUE, Position(x=0, y=0, z=0))
    battlefield = Battlefield(width=354, height=400, soldiers=[corner])

    assert demo.viewport_bounds(battlefield, max_width=60, max_height=40) == (
        0,
        0,
        60,
        40,
    )

    far = Soldier(Team.RED, Position(x=353, y=399, z=0))
    battlefield = Battlefield(width=354, height=400, soldiers=[far])

    assert demo.viewport_bounds(battlefield, max_width=60, max_height=40) == (
        294,
        360,
        354,
        400,
    )
