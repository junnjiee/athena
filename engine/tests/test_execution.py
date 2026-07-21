import asyncio
from random import Random

from athena.world_state import Battlefield
from athena.loop import LoopEngine
from athena.resolvers.movement import MovementResolver
from athena.resolvers.shooting import ShootingResolver
from athena.resolvers.vision import VisionResolver
from athena.world_state import Soldier
from athena.models import (
    AgentContext,
    BroadcastDraft,
    ChosenTurn,
    CommunicationGroup,
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
    assert result.observations[0].tick == 1
    assert result.before == result.after


def test_tick_supplies_each_soldier_with_its_own_visibility_history() -> None:
    received_contexts: list[tuple[Soldier, AgentContext]] = []

    async def record_context(
        agent_context: AgentContext,
        soldier: Soldier,
        **_: object,
    ) -> None:
        received_contexts.append((soldier, agent_context))
        return None

    blue = Soldier(
        Team.BLUE,
        Position(x=0, y=0, z=0),
        vision_range=3,
    )
    red = Soldier(
        Team.RED,
        Position(x=2, y=0, z=0),
        vision_range=1,
    )
    loop = LoopEngine(
        battlefield=Battlefield(width=3, height=1, soldiers=[blue, red]),
        vision_resolver=VisionResolver(),
        movement_resolver=MovementResolver(),
        action_chooser=record_context,
    )

    first_result = asyncio.run(loop.tick())
    asyncio.run(loop.tick())

    first_tick_contexts = received_contexts[:2]
    second_tick_contexts = received_contexts[2:]

    assert all(context.visibility_history == () for _, context in first_tick_contexts)
    assert second_tick_contexts[0][0] is blue
    assert second_tick_contexts[0][1].visibility_history == (
        first_result.observations[0],
    )
    assert second_tick_contexts[1][0] is red
    assert second_tick_contexts[1][1].visibility_history == (
        first_result.observations[1],
    )
    assert len(first_result.observations[0].visible_soldiers) == 1
    assert first_result.observations[1].visible_soldiers == []


def test_visibility_history_keeps_only_the_last_ten_ticks() -> None:
    received_contexts: list[AgentContext] = []

    async def record_context(agent_context: AgentContext, **_: object) -> None:
        received_contexts.append(agent_context)
        return None

    soldier = Soldier(Team.BLUE, Position(x=0, y=0, z=0))
    loop = LoopEngine(
        battlefield=Battlefield(width=1, height=1, soldiers=[soldier]),
        vision_resolver=VisionResolver(),
        movement_resolver=MovementResolver(),
        action_chooser=record_context,
    )

    for _ in range(12):
        asyncio.run(loop.tick())

    assert [
        observation.tick
        for observation in received_contexts[-1].visibility_history
    ] == list(range(2, 12))


def test_tick_delivers_broadcasts_to_overlapping_groups_on_the_next_tick() -> None:
    alpha = CommunicationGroup(
        group_id="blue-alpha",
        name="Blue Alpha",
        team=Team.BLUE,
    )
    headquarters = CommunicationGroup(
        group_id="blue-hq",
        name="Blue HQ",
        team=Team.BLUE,
    )
    red_group = CommunicationGroup(
        group_id="red-team",
        name="Red Team",
        team=Team.RED,
    )
    rifleman = Soldier(
        Team.BLUE,
        Position(x=0, y=0, z=0),
        communication_group_ids={alpha.group_id},
    )
    sergeant = Soldier(
        Team.BLUE,
        Position(x=0, y=1, z=0),
        communication_group_ids={alpha.group_id, headquarters.group_id},
    )
    commander = Soldier(
        Team.BLUE,
        Position(x=0, y=2, z=0),
        communication_group_ids={headquarters.group_id},
    )
    red = Soldier(
        Team.RED,
        Position(x=4, y=0, z=0),
        communication_group_ids={red_group.group_id},
    )
    received_contexts: dict[Soldier, list[AgentContext]] = {
        soldier: [] for soldier in (rifleman, sergeant, commander, red)
    }

    async def choose_turn(
        agent_context: AgentContext,
        soldier: Soldier,
        **_: object,
    ) -> ChosenTurn | None:
        soldier_contexts = received_contexts[soldier]
        soldier_contexts.append(agent_context)
        if len(soldier_contexts) > 1 or soldier is red:
            return None
        if soldier is rifleman:
            broadcast = BroadcastDraft(
                group_id=alpha.group_id,
                content="Contact near the ridge.",
            )
        elif soldier is commander:
            broadcast = BroadcastDraft(
                group_id=headquarters.group_id,
                content="Continue the advance.",
            )
        else:
            broadcast = None
        return ChosenTurn(
            action=MoveAction(direction=MoveDirection.EAST),
            broadcast=broadcast,
        )

    loop = LoopEngine(
        battlefield=Battlefield(
            width=5,
            height=3,
            soldiers=[rifleman, sergeant, commander, red],
            communication_groups=[alpha, headquarters, red_group],
        ),
        vision_resolver=VisionResolver(),
        movement_resolver=MovementResolver(),
        action_chooser=choose_turn,
    )

    first_result = asyncio.run(loop.tick())
    asyncio.run(loop.tick())

    assert all(
        contexts[0].communication_history == ()
        for contexts in received_contexts.values()
    )
    assert [message.group_id for message in first_result.team_messages] == [
        alpha.group_id,
        headquarters.group_id,
    ]
    assert received_contexts[rifleman][1].communication_history == (
        first_result.team_messages[0],
    )
    assert received_contexts[sergeant][1].communication_history == (
        first_result.team_messages[0],
        first_result.team_messages[1],
    )
    assert received_contexts[commander][1].communication_history == (
        first_result.team_messages[1],
    )
    assert received_contexts[red][1].communication_history == ()
    assert {
        group.group_id
        for group in received_contexts[sergeant][1].communication_groups
    } == {alpha.group_id, headquarters.group_id}


def test_invalid_broadcast_group_is_dropped_without_rejecting_physical_action() -> None:
    blue = Soldier(Team.BLUE, Position(x=0, y=0, z=0))
    loop = LoopEngine(
        battlefield=Battlefield(width=2, height=1, soldiers=[blue]),
        vision_resolver=VisionResolver(),
        movement_resolver=MovementResolver(),
    )

    result = loop.execute_actions(
        [MoveAction(direction=MoveDirection.EAST)],
        broadcasts=[
            BroadcastDraft(group_id="unavailable", content="Invalid group.")
        ],
    )

    assert result.after.soldiers[0].position == Position(x=1, y=0, z=0)
    assert result.team_messages == ()


def test_pre_tick_living_sender_transmits_when_hit_during_the_same_tick() -> None:
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
    red = Soldier(Team.RED, Position(x=2, y=0, z=0))
    loop = LoopEngine(
        battlefield=Battlefield(
            width=3,
            height=1,
            soldiers=[blue, red],
            communication_groups=[group],
        ),
        vision_resolver=VisionResolver(),
        movement_resolver=MovementResolver(),
        shooting_resolver=ShootingResolver(rng=Random(0)),
    )

    result = loop.execute_actions(
        [
            MoveAction(direction=MoveDirection.EAST),
            ShootAction(target_position=blue.position),
        ],
        broadcasts=[
            BroadcastDraft(group_id=group.group_id, content="Taking fire."),
            None,
        ],
    )

    assert result.after.soldiers[0].survival_status == SurvivalState.CASUALTY
    assert [message.content for message in result.team_messages] == ["Taking fire."]


def test_communication_history_keeps_only_the_last_ten_messages() -> None:
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
    loop = LoopEngine(
        battlefield=Battlefield(
            width=1,
            height=1,
            soldiers=[blue],
            communication_groups=[group],
        ),
        vision_resolver=VisionResolver(),
        movement_resolver=MovementResolver(),
    )

    for tick in range(1, 13):
        loop.execute_actions(
            [None],
            broadcasts=[
                BroadcastDraft(
                    group_id=group.group_id,
                    content=f"Message {tick}",
                )
            ],
        )

    assert [message.sent_tick for message in loop.communication_history[0]] == list(
        range(3, 13)
    )
