import asyncio
from random import Random

import pytest

from athena.agent import (
    SYSTEM_PROMPT,
    _resolve_action,
)
from athena.params import (
    TERRAIN_PROFILES,
    build_system_prompt as build_openrouter_system_prompt,
    impassable_terrain_names,
)
from athena.world_state import Battlefield
from athena.ollama_agent import (
    SYSTEM_PROMPT as OLLAMA_SYSTEM_PROMPT,
    _resolve_action as resolve_ollama_action,
    build_system_prompt as build_ollama_system_prompt,
)
from athena.resolvers.movement import MovementResolver
from athena.resolvers.shooting import ShootingResolver
from athena.world_state import Soldier
from athena.models import (
    TERRAIN_LABELS,
    ChosenAction,
    ChosenTurn,
    HoldAction,
    MoveAction,
    MoveDirection,
    ObservedSoldier,
    Position,
    ShootAction,
    SurvivalState,
    Team,
    TerrainCell,
    TerrainClass,
    VisibleSoldier,
)


def observation(
    soldier: Soldier,
    visible_soldiers: list[VisibleSoldier],
) -> ObservedSoldier:
    return ObservedSoldier(
        team=soldier.team,
        position=soldier.position,
        survival_status=soldier.survival_status,
        visible_soldiers=visible_soldiers,
        available_terrain=[],
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


def test_hold_action_serializes_without_parameters() -> None:
    chosen = ChosenTurn.model_validate({"action": {"kind": "hold"}})

    assert chosen.action == HoldAction()


def test_openrouter_prompt_allows_shooting_visible_enemies() -> None:
    assert "hold position, move one grid cell, or shoot" in SYSTEM_PROMPT
    assert "x, y, and z" in SYSTEM_PROMPT
    assert "terrain is drawn as a map" in SYSTEM_PROMPT
    assert "casualty or dead soldier" in SYSTEM_PROMPT
    assert "casualty or dead soldier" in OLLAMA_SYSTEM_PROMPT


@pytest.mark.parametrize("prompt", [SYSTEM_PROMPT, OLLAMA_SYSTEM_PROMPT])
def test_agent_prompts_list_illegal_movement_actions(prompt: str) -> None:
    assert "\n\nIllegal actions:\n" in prompt
    assert "- Moving outside the battlefield." in prompt
    assert "- Moving more than one grid cell." in prompt
    assert "- Moving into impassable terrain (Water, Structure)." in prompt
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


def test_agent_prompts_use_effective_engine_limits() -> None:
    openrouter_prompt = build_openrouter_system_prompt(
        visibility_history_limit=7,
        max_elevation_change=2,
    )
    ollama_prompt = build_ollama_system_prompt(max_elevation_change=2)

    assert "up to 7 prior ticks" in openrouter_prompt
    assert "elevation differs by more than 2 levels" in openrouter_prompt
    assert "elevation differs by more than 2 levels" in ollama_prompt


def test_openrouter_prompt_accepts_scenario_team_objectives() -> None:
    prompt = build_openrouter_system_prompt(
        visibility_history_limit=7,
        max_elevation_change=1,
        team_objectives="\n- Red: hold the summit.",
    )

    assert "\n\nTeam objectives:\n- Red: hold the summit." in prompt
    assert "Blue: advance toward the right/east side" not in prompt


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
            ChosenTurn(
                action=ShootAction(target_position=Position(x=2, y=2, z=0)),
            ),
            ChosenTurn(
                action=MoveAction(direction=MoveDirection.EAST),
            ),
        ]
    )

    retry_feedback: list[str | None] = []

    async def propose(feedback: str | None) -> ChosenTurn:
        retry_feedback.append(feedback)
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

    assert result == ChosenTurn(
        action=MoveAction(direction=MoveDirection.EAST),
    )
    assert retry_feedback[0] is None
    assert retry_feedback[1] is not None
    assert (
        "No visible soldier occupies the requested target position"
        in retry_feedback[1]
    )
    assert '"kind":"shoot"' in retry_feedback[1]


@pytest.mark.parametrize(
    (
        "destination_is_visible",
        "destination_elevation",
        "destination_impassable",
        "expected_reason",
    ),
    [
        (False, 0, True, "Moving east was rejected by the movement rules."),
        (False, 2, False, "Moving east was rejected by the movement rules."),
        (True, 0, True, "is impassable terrain (Structure)"),
        (True, 2, False, "Destination elevation differs by 2 levels"),
    ],
)
def test_move_retry_feedback_only_explains_visible_terrain(
    destination_is_visible: bool,
    destination_elevation: int,
    destination_impassable: bool,
    expected_reason: str,
) -> None:
    soldier = Soldier(Team.BLUE, Position(x=1, y=0, z=0))
    destination = Position(x=2, y=0, z=destination_elevation)
    battlefield = Battlefield(
        width=3,
        height=1,
        soldiers=[soldier],
        surface={
            Position(x=0, y=0, z=0),
            soldier.position,
            destination,
        },
        terrain=(
            {destination: TerrainClass.STRUCTURE} if destination_impassable else None
        ),
    )
    observed = ObservedSoldier(
        team=Team.BLUE,
        position=soldier.position,
        survival_status=SurvivalState.ALIVE,
        visible_soldiers=[],
        available_terrain=(
            [
                TerrainCell(
                    position=destination,
                    terrain_class=(
                        TerrainClass.STRUCTURE
                        if destination_impassable
                        else TerrainClass.OPEN_GROUND
                    ),
                )
            ]
            if destination_is_visible
            else []
        ),
    )
    proposed_actions = iter(
        [
            ChosenTurn(action=MoveAction(direction=MoveDirection.EAST)),
            ChosenTurn(action=MoveAction(direction=MoveDirection.WEST)),
        ]
    )
    retry_feedback: list[str | None] = []

    async def propose(feedback: str | None) -> ChosenTurn:
        retry_feedback.append(feedback)
        return next(proposed_actions)

    result = asyncio.run(
        _resolve_action(
            propose,
            observed,
            battlefield,
            soldier,
            MovementResolver(),
            ShootingResolver(),
            max_attempts=2,
        )
    )

    assert result == ChosenTurn(
        action=MoveAction(direction=MoveDirection.WEST),
    )
    assert retry_feedback[1] is not None
    assert expected_reason in retry_feedback[1]
    if not destination_is_visible:
        assert "impassable" not in retry_feedback[1]
        assert "elevation" not in retry_feedback[1]
        assert destination.model_dump_json() not in retry_feedback[1]


def test_action_resolution_accepts_valid_shoot_action() -> None:
    shooter = Soldier(Team.BLUE, Position(x=1, y=1, z=0))
    target_position = Position(x=4, y=3, z=0)
    observed = observation(
        shooter,
        [visible_soldier(Team.RED, target_position)],
    )
    shoot_action = ShootAction(target_position=target_position)

    async def propose(_: str | None) -> ChosenTurn:
        return ChosenTurn(action=shoot_action)

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

    assert result == ChosenTurn(action=shoot_action)


def test_action_resolution_accepts_hold_action() -> None:
    soldier = Soldier(Team.RED, Position(x=1, y=1, z=0))
    observed = observation(soldier, [])

    async def propose(_: str | None) -> ChosenTurn:
        return ChosenTurn(action=HoldAction())

    result = asyncio.run(
        _resolve_action(
            propose,
            observed,
            Battlefield(width=3, height=3, soldiers=[soldier]),
            soldier,
            MovementResolver(),
            ShootingResolver(),
            max_attempts=1,
        )
    )

    assert result == ChosenTurn(action=HoldAction())


def test_action_resolution_returns_none_after_invalid_shoot_attempts() -> None:
    shooter = Soldier(Team.BLUE, Position(x=1, y=1, z=0))
    observed = observation(shooter, [])

    async def propose(_: str | None) -> ChosenTurn:
        return ChosenTurn(
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


@pytest.mark.parametrize(
    ("protection", "expected_probability"),
    [
        (0.0, 0.90),
        (0.15, 0.765),
        (0.90, 0.09),
    ],
)
def test_terrain_protection_reduces_hit_probability(
    protection: float,
    expected_probability: float,
) -> None:
    probability = ShootingResolver().hit_probability(
        Position(x=0, y=0, z=0),
        Position(x=1, y=0, z=0),
        protection,
    )

    assert probability == pytest.approx(expected_probability)


def test_protection_can_drive_probability_below_the_marksmanship_floor() -> None:
    # The floor bounds how badly a soldier shoots, not how well a target is
    # sheltered, so hard cover is allowed to push the chance beneath it.
    resolver = ShootingResolver()

    unprotected = resolver.hit_probability(
        Position(x=0, y=0, z=0),
        Position(x=1, y=0, z=20),
    )
    protected = resolver.hit_probability(
        Position(x=0, y=0, z=0),
        Position(x=1, y=0, z=20),
        0.9,
    )

    assert unprotected == pytest.approx(0.50)
    assert protected < resolver.minimum_hit_probability


def test_resolve_shot_reads_protection_from_the_target_cell() -> None:
    shooter = Soldier(Team.BLUE, Position(x=0, y=0, z=0))
    target = Soldier(Team.RED, Position(x=1, y=0, z=0))
    battlefield = Battlefield(
        width=2,
        height=1,
        soldiers=[shooter, target],
        terrain={target.position: TerrainClass.URBAN},
    )

    outcome = ShootingResolver(rng=Random(0)).resolve_shot(
        battlefield.snapshot(),
        0,
        ShootAction(target_position=target.position),
    )

    assert outcome is not None
    # Urban protection is 0.40, so 0.90 * 0.60.
    assert outcome.hit_probability == pytest.approx(0.54)


def test_prompt_terrain_vocabulary_is_derived_from_the_profile_table() -> None:
    # Generated rather than hand-written so the prompt cannot drift from the
    # values the resolvers use.
    impassable = {
        TERRAIN_LABELS[terrain_class]
        for terrain_class, profile in TERRAIN_PROFILES.items()
        if not profile.passable
    }

    for label in impassable:
        assert label in impassable_terrain_names()
        assert label in SYSTEM_PROMPT

    passable_only = {
        TERRAIN_LABELS[terrain_class]
        for terrain_class, profile in TERRAIN_PROFILES.items()
        if profile.passable
    }
    assert not (passable_only & set(impassable_terrain_names().split(", ")))


def test_terrain_cell_serializes_a_readable_class_name() -> None:
    cell = TerrainCell(
        position=Position(x=0, y=0, z=0),
        terrain_class=TerrainClass.DENSE_FOREST,
    )

    assert cell.terrain == "Dense Forest"
    assert '"terrain":"Dense Forest"' in cell.model_dump_json()
    # The index survives the round trip so engine consumers keep the enum.
    assert TerrainCell.model_validate_json(cell.model_dump_json()) == cell
