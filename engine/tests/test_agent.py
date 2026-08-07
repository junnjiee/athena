import asyncio
import json

import pytest
from langchain_core.exceptions import OutputParserException
from langchain_core.output_parsers import PydanticOutputParser
from pydantic import ValidationError

from athena import agent
from athena.context_view import render_agent_context
from athena.world_state import Battlefield
from athena.resolvers.movement import MovementResolver
from athena.resolvers.shooting import ShootingResolver
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
        position=Position(x=0, y=0, z=0),
        submitted_action=MoveAction(direction=MoveDirection.EAST),
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
    assert "up to 7 prior ticks" in messages[0][1]
    assert "exact pre-action position and the action you" in messages[0][1]
    assert "does not report whether a move was accepted" in messages[0][1]
    assert "up to 10 messages" in messages[0][1]
    assert "receive it on the next tick" in messages[0][1]
    assert "elevation differs by more than 2 levels" in messages[0][1]
    assert messages[1][1] == render_agent_context(agent_context)
    # The rendered message carries the same facts the JSON dump did.
    human = messages[1][1]
    assert "You are blue, at (0,0)" in human
    assert "t1: at (0,0)" in human
    assert "Blue Alpha (group_id blue-alpha)" in human
    assert "Holding position." in human


@pytest.mark.parametrize(
    ("invalid_output", "expected_detail", "excluded_text"),
    [
        (
            '{"action":{"kind":"move","direction":"up"}}',
            "direction",
            None,
        ),
        (
            '{"action":"IGNORE_PREVIOUS_INSTRUCTIONS"}',
            "action must be valid JSON",
            "IGNORE_PREVIOUS_INSTRUCTIONS",
        ),
    ],
)
def test_openrouter_retries_with_sanitized_pydantic_validation_feedback(
    monkeypatch,
    invalid_output: str,
    expected_detail: str,
    excluded_text: str | None,
) -> None:
    requests: list[list[tuple[str, str]]] = []
    parser = PydanticOutputParser(pydantic_object=ChosenTurn)

    class StructuredLlm:
        async def ainvoke(
            self,
            request_messages: list[tuple[str, str]],
        ) -> ChosenTurn:
            requests.append(request_messages)
            if len(requests) == 1:
                return parser.parse(invalid_output)
            return ChosenTurn(
                action=MoveAction(direction=MoveDirection.EAST),
            )

    class Llm:
        def with_structured_output(self, *_: object, **__: object) -> StructuredLlm:
            return StructuredLlm()

    monkeypatch.setattr(agent, "ChatOpenRouter", lambda **_: Llm())

    soldier = Soldier(Team.BLUE, Position(x=0, y=0, z=0))
    battlefield = Battlefield(width=2, height=1, soldiers=[soldier])
    observed = ObservedSoldier(
        team=Team.BLUE,
        position=soldier.position,
        survival_status=SurvivalState.ALIVE,
        visible_soldiers=[],
        available_terrain=[],
    )
    agent_context = AgentContext(
        current_observation=observed,
        visibility_history=(),
    )

    result = asyncio.run(
        agent.choose_action(
            agent_context=agent_context,
            battlefield=battlefield,
            soldier=soldier,
            movement_resolver=MovementResolver(),
            max_attempts=2,
        )
    )

    assert result == ChosenTurn(
        action=MoveAction(direction=MoveDirection.EAST),
    )
    assert len(requests) == 2
    retry_message = requests[1][1][1]
    assert "Retry feedback:" in retry_message
    assert "did not match the required schema" in retry_message
    assert expected_detail in retry_message
    if excluded_text is not None:
        assert excluded_text not in retry_message


def test_non_pydantic_parser_error_still_propagates() -> None:
    soldier = Soldier(Team.BLUE, Position(x=0, y=0, z=0))
    observed = ObservedSoldier(
        team=Team.BLUE,
        position=soldier.position,
        survival_status=SurvivalState.ALIVE,
        visible_soldiers=[],
        available_terrain=[],
    )

    async def propose(_: str | None) -> ChosenTurn:
        raise OutputParserException("Malformed JSON before Pydantic validation.")

    with pytest.raises(OutputParserException):
        asyncio.run(
            agent._resolve_action(
                propose,
                observed,
                Battlefield(width=2, height=1, soldiers=[soldier]),
                soldier,
                MovementResolver(),
                ShootingResolver(),
                max_attempts=1,
            )
        )


def test_bare_pydantic_validation_error_still_propagates() -> None:
    soldier = Soldier(Team.BLUE, Position(x=0, y=0, z=0))
    observed = ObservedSoldier(
        team=Team.BLUE,
        position=soldier.position,
        survival_status=SurvivalState.ALIVE,
        visible_soldiers=[],
        available_terrain=[],
    )
    attempts = 0

    async def propose(_: str | None) -> ChosenTurn:
        nonlocal attempts
        attempts += 1
        return ChosenTurn.model_validate(
            {"action": {"kind": "move", "direction": "up"}}
        )

    with pytest.raises(ValidationError):
        asyncio.run(
            agent._resolve_action(
                propose,
                observed,
                Battlefield(width=2, height=1, soldiers=[soldier]),
                soldier,
                MovementResolver(),
                ShootingResolver(),
                max_attempts=3,
            )
        )

    assert attempts == 1


def test_broadcast_content_is_limited_to_280_characters() -> None:
    with pytest.raises(ValidationError):
        BroadcastDraft(
            group_id="blue-alpha",
            content="x" * 281,
        )
