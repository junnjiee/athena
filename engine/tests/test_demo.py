import asyncio
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
    CommunicationGroup,
    MoveAction,
    MoveDirection,
    Position,
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
    assert "terrain: 8 cells (0 cover, 0 concealment)" in output


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


def test_battle_finishes_when_one_team_has_no_living_soldiers() -> None:
    blue = Soldier(Team.BLUE, Position(x=0, y=0, z=0))
    red = Soldier(Team.RED, Position(x=2, y=0, z=0))
    loop = loop_for([blue, red])

    assert both_teams_have_living_soldiers(loop.battlefield)

    loop.execute_actions([ShootAction(target_position=red.position), None])

    assert not both_teams_have_living_soldiers(loop.battlefield)
