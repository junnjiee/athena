import asyncio
from random import Random

from athena.battlefield import Battlefield
from athena.loop import LoopEngine
from athena.resolvers.movement import MovementResolver
from athena.resolvers.shooting import ShootingResolver
from athena.resolvers.vision import VisionResolver
from athena.soldier import Soldier
from athena.types import (
    ExecutionResult,
    MoveAction,
    MoveDirection,
    Position,
    ShootAction,
    SurvivalState,
    Team,
)


def loop_for(soldiers: list[Soldier]) -> LoopEngine:
    return LoopEngine(
        battlefield=Battlefield(width=8, height=8, soldiers=soldiers),
        vision_resolver=VisionResolver(),
        movement_resolver=MovementResolver(rng=Random(0)),
        shooting_resolver=ShootingResolver(rng=Random(0)),
    )


def test_execute_actions_returns_independent_before_and_after_snapshots() -> None:
    soldier = Soldier(Team.BLUE, Position(x=1, y=1, z=0))

    result = loop_for([soldier]).execute_actions(
        [MoveAction(direction=MoveDirection.EAST)]
    )

    assert result.before.soldiers[0].position == Position(x=1, y=1, z=0)
    assert result.after.soldiers[0].position == Position(x=2, y=1, z=0)
    assert soldier.position == Position(x=2, y=1, z=0)


def test_randomly_selects_one_move_with_the_same_destination() -> None:
    first = Soldier(Team.BLUE, Position(x=0, y=1, z=0))
    second = Soldier(Team.RED, Position(x=2, y=1, z=0))

    result = loop_for([first, second]).execute_actions(
        [
            MoveAction(direction=MoveDirection.EAST),
            MoveAction(direction=MoveDirection.WEST),
        ]
    )

    assert result.after.soldiers[0].position == Position(x=0, y=1, z=0)
    assert result.after.soldiers[1].position == Position(x=1, y=1, z=0)


def test_contested_destination_remains_blocked_by_stationary_occupant() -> None:
    first = Soldier(Team.BLUE, Position(x=0, y=1, z=0))
    stationary = Soldier(Team.BLUE, Position(x=1, y=1, z=0))
    second = Soldier(Team.RED, Position(x=2, y=1, z=0))

    result = loop_for([first, stationary, second]).execute_actions(
        [
            MoveAction(direction=MoveDirection.EAST),
            None,
            MoveAction(direction=MoveDirection.WEST),
        ]
    )

    assert [soldier.position for soldier in result.after.soldiers] == [
        Position(x=0, y=1, z=0),
        Position(x=1, y=1, z=0),
        Position(x=2, y=1, z=0),
    ]


def test_move_rejections_cascade_through_occupied_cells() -> None:
    first = Soldier(Team.BLUE, Position(x=0, y=1, z=0))
    second = Soldier(Team.BLUE, Position(x=1, y=1, z=0))
    stationary = Soldier(Team.BLUE, Position(x=2, y=1, z=0))

    result = loop_for([first, second, stationary]).execute_actions(
        [
            MoveAction(direction=MoveDirection.EAST),
            MoveAction(direction=MoveDirection.EAST),
            None,
        ]
    )

    assert [soldier.position for soldier in result.after.soldiers] == [
        Position(x=0, y=1, z=0),
        Position(x=1, y=1, z=0),
        Position(x=2, y=1, z=0),
    ]


def test_allows_position_swap_when_both_cells_are_vacated() -> None:
    first = Soldier(Team.BLUE, Position(x=0, y=1, z=0))
    second = Soldier(Team.RED, Position(x=1, y=1, z=0))

    result = loop_for([first, second]).execute_actions(
        [
            MoveAction(direction=MoveDirection.EAST),
            MoveAction(direction=MoveDirection.WEST),
        ]
    )

    assert result.after.soldiers[0].position == Position(x=1, y=1, z=0)
    assert result.after.soldiers[1].position == Position(x=0, y=1, z=0)


def test_shot_target_completes_accepted_move_and_becomes_casualty() -> None:
    shooter = Soldier(Team.BLUE, Position(x=0, y=1, z=0))
    target = Soldier(Team.RED, Position(x=2, y=1, z=0))

    result = loop_for([shooter, target]).execute_actions(
        [
            ShootAction(target_position=Position(x=2, y=1, z=0)),
            MoveAction(direction=MoveDirection.EAST),
        ]
    )

    assert result.before.soldiers[1].position == Position(x=2, y=1, z=0)
    assert result.before.soldiers[1].survival_status == SurvivalState.ALIVE
    assert result.after.soldiers[1].position == Position(x=3, y=1, z=0)
    assert result.after.soldiers[1].survival_status == SurvivalState.CASUALTY
    assert result.shot_outcomes[0].hit


def test_shot_target_with_rejected_move_stays_and_becomes_casualty() -> None:
    shooter = Soldier(Team.BLUE, Position(x=0, y=0, z=0))
    target = Soldier(Team.RED, Position(x=1, y=1, z=0))
    competing_mover = Soldier(Team.RED, Position(x=3, y=1, z=0))

    result = loop_for([shooter, target, competing_mover]).execute_actions(
        [
            ShootAction(target_position=Position(x=1, y=1, z=0)),
            MoveAction(direction=MoveDirection.EAST),
            MoveAction(direction=MoveDirection.WEST),
        ]
    )

    assert result.after.soldiers[1].position == Position(x=1, y=1, z=0)
    assert result.after.soldiers[1].survival_status == SurvivalState.CASUALTY
    assert result.after.soldiers[2].position == Position(x=2, y=1, z=0)


def test_reciprocal_shots_make_both_soldiers_casualties() -> None:
    blue = Soldier(Team.BLUE, Position(x=1, y=1, z=0))
    red = Soldier(Team.RED, Position(x=3, y=1, z=0))

    result = loop_for([blue, red]).execute_actions(
        [
            ShootAction(target_position=red.position),
            ShootAction(target_position=blue.position),
        ]
    )

    assert result.after.soldiers[0].survival_status == SurvivalState.CASUALTY
    assert result.after.soldiers[1].survival_status == SurvivalState.CASUALTY
    assert len(result.shot_outcomes) == 2


def test_missed_shot_is_recorded_without_creating_a_casualty() -> None:
    shooter = Soldier(Team.BLUE, Position(x=0, y=0, z=0))
    target = Soldier(Team.RED, Position(x=1, y=0, z=0))
    loop = LoopEngine(
        battlefield=Battlefield(width=2, height=1, soldiers=[shooter, target]),
        vision_resolver=VisionResolver(),
        movement_resolver=MovementResolver(),
        shooting_resolver=ShootingResolver(rng=Random(2)),
    )

    result = loop.execute_actions(
        [ShootAction(target_position=target.position), None]
    )

    assert not result.shot_outcomes[0].hit
    assert result.after.soldiers[1].survival_status == SurvivalState.ALIVE


def test_none_actions_leave_before_and_after_state_equal() -> None:
    soldier = Soldier(Team.BLUE, Position(x=1, y=1, z=0))

    result = loop_for([soldier]).execute_actions([None])

    assert result.before == result.after


def test_tick_returns_execution_result() -> None:
    async def choose_none(**_: object) -> None:
        return None

    soldier = Soldier(Team.BLUE, Position(x=1, y=1, z=0))
    loop = LoopEngine(
        battlefield=Battlefield(width=8, height=8, soldiers=[soldier]),
        vision_resolver=VisionResolver(),
        movement_resolver=MovementResolver(),
        action_chooser=choose_none,
    )

    result = asyncio.run(loop.tick())

    assert isinstance(result, ExecutionResult)
    assert result.actions == (None,)
    assert result.shot_outcomes == ()
    assert result.before == result.after
