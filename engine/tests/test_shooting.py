import asyncio

import pytest

from athena.agent import SYSTEM_PROMPT, _resolve_action
from athena.battlefield import Battlefield
from athena.ollama_agent import _resolve_action as resolve_ollama_action
from athena.resolvers.movement import MovementResolver
from athena.resolvers.shooting import ShootingResolver
from athena.soldier import Soldier
from athena.types import (
    AvailableTerrain,
    ChosenAction,
    MoveAction,
    MoveDirection,
    ObservedSoldier,
    Position,
    ShootAction,
    SurvivalState,
    Team,
    VisibleSoldier,
    VisibleSoldiers,
)


def observation(
    soldier: Soldier,
    visible_soldiers: list[VisibleSoldier],
) -> ObservedSoldier:
    return ObservedSoldier(
        team=soldier.team,
        position=soldier.position,
        survival_status=soldier.survival_status,
        visible_soldiers=VisibleSoldiers(soldiers=visible_soldiers),
        available_terrain=AvailableTerrain(cover=[], concealment=[]),
    )


def visible_soldier(
    team: Team,
    position: Position,
    survival_status: SurvivalState = SurvivalState.ALIVE,
) -> VisibleSoldier:
    return VisibleSoldier(
        team=team,
        position=position,
        survival_status=survival_status,
    )


def test_shoot_action_serializes_target_coordinates() -> None:
    chosen = ChosenAction.model_validate(
        {
            "action": {
                "kind": "shoot",
                "target_position": {"x": 4, "y": 7},
            }
        }
    )

    assert chosen.action == ShootAction(target_position=Position(x=4, y=7))


def test_openrouter_prompt_allows_shooting_visible_enemies() -> None:
    assert "move one grid cell or shoot" in SYSTEM_PROMPT
    assert "visible living soldier" in SYSTEM_PROMPT
    assert "target_position" in SYSTEM_PROMPT


def test_accepts_visible_living_enemy_target() -> None:
    shooter = Soldier(Team.BLUE, Position(x=1, y=1))
    target_position = Position(x=4, y=3)
    observed = observation(
        shooter,
        [visible_soldier(Team.RED, target_position)],
    )

    assert ShootingResolver().verify_shoot_action(
        observed,
        shooter,
        ShootAction(target_position=target_position),
    )


@pytest.mark.parametrize(
    ("visible", "target_position"),
    [
        ([], Position(x=4, y=3)),
        (
            [visible_soldier(Team.BLUE, Position(x=4, y=3))],
            Position(x=4, y=3),
        ),
        (
            [
                visible_soldier(
                    Team.RED,
                    Position(x=4, y=3),
                    SurvivalState.DEAD,
                )
            ],
            Position(x=4, y=3),
        ),
        (
            [visible_soldier(Team.RED, Position(x=4, y=3))],
            Position(x=5, y=3),
        ),
        (
            [
                visible_soldier(Team.RED, Position(x=4, y=3)),
                visible_soldier(Team.RED, Position(x=4, y=3)),
            ],
            Position(x=4, y=3),
        ),
    ],
    ids=[
        "unseen-or-empty",
        "friendly",
        "dead-enemy",
        "different-grid-cell",
        "ambiguous-target",
    ],
)
def test_rejects_invalid_targets(
    visible: list[VisibleSoldier],
    target_position: Position,
) -> None:
    shooter = Soldier(Team.BLUE, Position(x=1, y=1))

    assert not ShootingResolver().verify_shoot_action(
        observation(shooter, visible),
        shooter,
        ShootAction(target_position=target_position),
    )


def test_rejects_shoot_action_from_non_living_soldier() -> None:
    shooter = Soldier(
        Team.BLUE,
        Position(x=1, y=1),
        survival_status=SurvivalState.CASUALTY,
    )
    target_position = Position(x=4, y=3)

    assert not ShootingResolver().verify_shoot_action(
        observation(
            shooter,
            [visible_soldier(Team.RED, target_position)],
        ),
        shooter,
        ShootAction(target_position=target_position),
    )


def test_action_resolution_retries_invalid_shot_then_accepts_move() -> None:
    shooter = Soldier(Team.BLUE, Position(x=1, y=1))
    observed = observation(shooter, [])
    proposed_actions = iter(
        [
            ChosenAction(
                action=ShootAction(target_position=Position(x=2, y=2)),
            ),
            ChosenAction(
                action=MoveAction(direction=MoveDirection.EAST),
            ),
        ]
    )

    async def propose() -> ChosenAction:
        return next(proposed_actions)

    result = asyncio.run(
        _resolve_action(
            propose,
            observed,
            Battlefield(width=5, height=5, soldiers=[shooter]),
            shooter,
            MovementResolver(),
            ShootingResolver(),
            max_attempts=2,
        )
    )

    assert result == MoveAction(direction=MoveDirection.EAST)


def test_action_resolution_accepts_valid_shoot_action() -> None:
    shooter = Soldier(Team.BLUE, Position(x=1, y=1))
    target_position = Position(x=4, y=3)
    observed = observation(
        shooter,
        [visible_soldier(Team.RED, target_position)],
    )
    shoot_action = ShootAction(target_position=target_position)

    async def propose() -> ChosenAction:
        return ChosenAction(action=shoot_action)

    result = asyncio.run(
        _resolve_action(
            propose,
            observed,
            Battlefield(width=5, height=5, soldiers=[shooter]),
            shooter,
            MovementResolver(),
            ShootingResolver(),
            max_attempts=1,
        )
    )

    assert result == shoot_action


def test_action_resolution_returns_none_after_invalid_shoot_attempts() -> None:
    shooter = Soldier(Team.BLUE, Position(x=1, y=1))
    observed = observation(shooter, [])

    async def propose() -> ChosenAction:
        return ChosenAction(
            action=ShootAction(target_position=Position(x=4, y=3)),
        )

    result = asyncio.run(
        _resolve_action(
            propose,
            observed,
            Battlefield(width=5, height=5, soldiers=[shooter]),
            shooter,
            MovementResolver(),
            ShootingResolver(),
            max_attempts=3,
        )
    )

    assert result is None


def test_ollama_action_resolution_still_rejects_shooting() -> None:
    shooter = Soldier(Team.BLUE, Position(x=1, y=1))

    async def propose() -> ChosenAction:
        return ChosenAction(
            action=ShootAction(target_position=Position(x=4, y=3)),
        )

    result = asyncio.run(
        resolve_ollama_action(
            propose,
            Battlefield(width=5, height=5, soldiers=[shooter]),
            shooter,
            MovementResolver(),
            max_attempts=1,
        )
    )

    assert result is None
