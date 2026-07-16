from athena.battlefield import Battlefield
from athena.demo import (
    both_teams_have_living_soldiers,
    render_demo_frame,
)
from athena.loop import LoopEngine
from athena.resolvers.movement import MovementResolver
from athena.resolvers.vision import VisionResolver
from athena.soldier import Soldier
from athena.types import MoveAction, MoveDirection, Position, ShootAction, Team


def loop_for(soldiers: list[Soldier]) -> LoopEngine:
    return LoopEngine(
        battlefield=Battlefield(width=4, height=2, soldiers=soldiers),
        vision_resolver=VisionResolver(),
        movement_resolver=MovementResolver(),
    )


def test_render_demo_frame_shows_shot_and_casualty_transition(capsys) -> None:
    shooter = Soldier(Team.BLUE, Position(x=0, y=0))
    target = Soldier(Team.RED, Position(x=2, y=0))
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
    assert "soldier 0 blue: shoot (2,0)" in output
    assert "status alive -> casualty" in output


def test_render_demo_frame_labels_conflicting_moves_as_rejected(capsys) -> None:
    first = Soldier(Team.BLUE, Position(x=0, y=0))
    second = Soldier(Team.RED, Position(x=2, y=0))
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
    assert "soldier 1 red: move west (rejected)" in output
    assert "State changes\n  none" in output


def test_battle_finishes_when_one_team_has_no_living_soldiers() -> None:
    blue = Soldier(Team.BLUE, Position(x=0, y=0))
    red = Soldier(Team.RED, Position(x=2, y=0))
    loop = loop_for([blue, red])

    assert both_teams_have_living_soldiers(loop.battlefield)

    loop.execute_actions([ShootAction(target_position=red.position), None])

    assert not both_teams_have_living_soldiers(loop.battlefield)
