import asyncio
from random import Random

import pytest

from athena.agent import SYSTEM_PROMPT, _resolve_action
from athena.world_state import Battlefield
from athena.ollama_agent import (
    SYSTEM_PROMPT as OLLAMA_SYSTEM_PROMPT,
    _resolve_action as resolve_ollama_action,
)
from athena.resolvers.movement import MovementResolver
from athena.resolvers.shooting import ShootingResolver
from athena.world_state import Soldier
from athena.models import (
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
        available_terrain=AvailableTerrain(cells=[]),
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
                "target_position": {"x": 4, "y": 7, "z": 2},
            }
        }
    )

    assert chosen.action == ShootAction(target_position=Position(x=4, y=7, z=2))


def test_openrouter_prompt_allows_shooting_visible_enemies() -> None:
    assert "move one grid cell or shoot" in SYSTEM_PROMPT
    assert "x, y, and z" in SYSTEM_PROMPT
    assert "available_terrain cells" in SYSTEM_PROMPT
    assert "casualty or dead soldier" in SYSTEM_PROMPT
    assert "casualty or dead soldier" in OLLAMA_SYSTEM_PROMPT


@pytest.mark.parametrize("prompt", [SYSTEM_PROMPT, OLLAMA_SYSTEM_PROMPT])
def test_agent_prompts_list_illegal_movement_actions(prompt: str) -> None:
    assert "\n\nIllegal actions:\n" in prompt
    assert "- Moving outside the battlefield." in prompt
    assert "- Moving more than one grid cell." in prompt
    assert "- Moving into a cover cell." in prompt
    assert "elevation differs by more than one level" in prompt
    assert "cell occupied by a casualty or dead soldier" in prompt
    assert "cell occupied by a stationary living soldier" in prompt


@pytest.mark.parametrize("prompt", [SYSTEM_PROMPT, OLLAMA_SYSTEM_PROMPT])
def test_agent_prompts_state_team_objectives(prompt: str) -> None:
    assert "\n\nTeam objectives:\n" in prompt
    assert "- Blue: advance toward the right/east side" in prompt
    assert "- Red: advance toward the left/west side" in prompt


def test_openrouter_prompt_lists_illegal_shooting_actions() -> None:
    assert "Shooting a friendly, casualty, dead, or non-visible soldier" in SYSTEM_PROMPT
    assert "visible living enemy's exact x, y, and z" in SYSTEM_PROMPT


def test_ollama_prompt_lists_shooting_as_illegal() -> None:
    assert "Shooting; this backend supports movement only." in OLLAMA_SYSTEM_PROMPT


def test_accepts_visible_living_enemy_target() -> None:
    shooter = Soldier(Team.BLUE, Position(x=1, y=1, z=0))
    target_position = Position(x=4, y=3, z=0)
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
        ([], Position(x=4, y=3, z=0)),
        (
            [visible_soldier(Team.BLUE, Position(x=4, y=3, z=0))],
            Position(x=4, y=3, z=0),
        ),
        (
            [
                visible_soldier(
                    Team.RED,
                    Position(x=4, y=3, z=0),
                    SurvivalState.DEAD,
                )
            ],
            Position(x=4, y=3, z=0),
        ),
        (
            [visible_soldier(Team.RED, Position(x=4, y=3, z=0))],
            Position(x=5, y=3, z=0),
        ),
        (
            [
                visible_soldier(Team.RED, Position(x=4, y=3, z=0)),
                visible_soldier(Team.RED, Position(x=4, y=3, z=0)),
            ],
            Position(x=4, y=3, z=0),
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
    shooter = Soldier(Team.BLUE, Position(x=1, y=1, z=0))

    assert not ShootingResolver().verify_shoot_action(
        observation(shooter, visible),
        shooter,
        ShootAction(target_position=target_position),
    )


def test_rejects_shoot_action_from_non_living_soldier() -> None:
    shooter = Soldier(
        Team.BLUE,
        Position(x=1, y=1, z=0),
        survival_status=SurvivalState.CASUALTY,
    )
    target_position = Position(x=4, y=3, z=0)

    assert not ShootingResolver().verify_shoot_action(
        observation(
            shooter,
            [visible_soldier(Team.RED, target_position)],
        ),
        shooter,
        ShootAction(target_position=target_position),
    )


@pytest.mark.parametrize(
    ("shooter_z", "target_z", "expected_probability"),
    [
        (0, 0, 0.90),
        (1, 0, 0.92),
        (0, 1, 0.88),
        (5, 0, 0.99),
        (0, 20, 0.50),
    ],
)
def test_hit_probability_uses_relative_elevation_and_bounds(
    shooter_z: int,
    target_z: int,
    expected_probability: float,
) -> None:
    resolver = ShootingResolver()

    probability = resolver.hit_probability(
        Position(x=0, y=0, z=shooter_z),
        Position(x=1, y=0, z=target_z),
    )

    assert probability == pytest.approx(expected_probability)


def test_resolve_shot_records_probability_roll_and_hit() -> None:
    shooter = Soldier(Team.BLUE, Position(x=0, y=0, z=1))
    target = Soldier(Team.RED, Position(x=1, y=0, z=0))
    battlefield = Battlefield(
        width=2,
        height=1,
        soldiers=[shooter, target],
        surface={shooter.position, target.position},
    )

    outcome = ShootingResolver(rng=Random(0)).resolve_shot(
        battlefield.snapshot(),
        shooter_index=0,
        action=ShootAction(target_position=target.position),
    )

    assert outcome is not None
    assert outcome.shooter_index == 0
    assert outcome.target_index == 1
    assert outcome.hit_probability == pytest.approx(0.92)
    assert outcome.roll == pytest.approx(0.8444218515250481)
    assert outcome.hit


def test_resolve_shot_can_miss_without_mutating_target() -> None:
    shooter = Soldier(Team.BLUE, Position(x=0, y=0, z=0))
    target = Soldier(Team.RED, Position(x=1, y=0, z=0))
    battlefield = Battlefield(width=2, height=1, soldiers=[shooter, target])

    outcome = ShootingResolver(rng=Random(2)).resolve_shot(
        battlefield.snapshot(),
        shooter_index=0,
        action=ShootAction(target_position=target.position),
    )

    assert outcome is not None
    assert outcome.roll > outcome.hit_probability
    assert not outcome.hit
    assert target.survival_status == SurvivalState.ALIVE


def test_action_resolution_retries_invalid_shot_then_accepts_move() -> None:
    shooter = Soldier(Team.BLUE, Position(x=1, y=1, z=0))
    observed = observation(shooter, [])
    proposed_actions = iter(
        [
            ChosenAction(
                action=ShootAction(target_position=Position(x=2, y=2, z=0)),
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
    shooter = Soldier(Team.BLUE, Position(x=1, y=1, z=0))
    target_position = Position(x=4, y=3, z=0)
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
    shooter = Soldier(Team.BLUE, Position(x=1, y=1, z=0))
    observed = observation(shooter, [])

    async def propose() -> ChosenAction:
        return ChosenAction(
            action=ShootAction(target_position=Position(x=4, y=3, z=0)),
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
    shooter = Soldier(Team.BLUE, Position(x=1, y=1, z=0))

    async def propose() -> ChosenAction:
        return ChosenAction(
            action=ShootAction(target_position=Position(x=4, y=3, z=0)),
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
