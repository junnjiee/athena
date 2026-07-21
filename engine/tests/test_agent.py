import asyncio
import json

import pytest
from pydantic import ValidationError

from athena import agent
from athena.world_state import Battlefield
from athena.resolvers.movement import MovementResolver
from athena.world_state import Soldier
from athena.models import (
    AgentContext,
    BroadcastDraft,
    ChosenTurn,
    CommunicationGroup,
    MoveAction,
    MoveDirection,
    ObservedSoldier,
    Position,
    SurvivalState,
    Team,
    TeamMessage,
    VisibilityObservation,
)


def test_openrouter_receives_current_observation_and_visibility_history(
    monkeypatch,
) -> None:
    messages: list[tuple[str, str]] = []

    class StructuredLlm:
        async def ainvoke(
            self,
            request_messages: list[tuple[str, str]],
        ) -> ChosenTurn:
            messages.extend(request_messages)
            return ChosenTurn(
                action=MoveAction(direction=MoveDirection.EAST),
                broadcast=BroadcastDraft(
                    group_id="blue-alpha",
                    content="Moving east.",
                ),
            )

    class Llm:
        def with_structured_output(self, *_: object, **__: object) -> StructuredLlm:
            return StructuredLlm()

    monkeypatch.setattr(agent, "ChatOpenRouter", lambda **_: Llm())

    group = CommunicationGroup(
        group_id="blue-alpha",
        name="Blue Alpha",
        team=Team.BLUE,
    )
    soldier = Soldier(
        Team.BLUE,
        Position(x=0, y=0, z=0),
        communication_group_ids={group.group_id},
    )
    battlefield = Battlefield(
        width=2,
        height=1,
        soldiers=[soldier],
        communication_groups=[group],
    )
    current_observation = ObservedSoldier(
        team=Team.BLUE,
        position=soldier.position,
        survival_status=SurvivalState.ALIVE,
        visible_soldiers=[],
        available_terrain=[],
    )
    historical_observation = VisibilityObservation(
        tick=1,
        visible_soldiers=[],
        available_terrain=[],
    )
    agent_context = AgentContext(
        current_observation=current_observation,
        visibility_history=(historical_observation,),
        communication_groups=(group,),
        communication_history=(
            TeamMessage(
                sent_tick=1,
                group_id=group.group_id,
                sender_index=0,
                content="Holding position.",
            ),
        ),
    )

    result = asyncio.run(
        agent.choose_action(
            agent_context=agent_context,
            battlefield=battlefield,
            soldier=soldier,
            movement_resolver=MovementResolver(max_elevation_change=2),
            visibility_history_limit=7,
        )
    )

    assert result == ChosenTurn(
        action=MoveAction(direction=MoveDirection.EAST),
        broadcast=BroadcastDraft(
            group_id="blue-alpha",
            content="Moving east.",
        ),
    )
    assert "ordered from oldest to newest" in messages[0][1]
    assert "up to 7 prior tick observations" in messages[0][1]
    assert "up to 10 messages" in messages[0][1]
    assert "receive it on the next tick" in messages[0][1]
    assert "elevation differs by more than 2 levels" in messages[0][1]
    assert json.loads(messages[1][1]) == json.loads(agent_context.model_dump_json())


def test_broadcast_content_is_limited_to_280_characters() -> None:
    with pytest.raises(ValidationError):
        BroadcastDraft(
            group_id="blue-alpha",
            content="x" * 281,
        )
