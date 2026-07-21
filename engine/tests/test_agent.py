import asyncio
import json

from athena import agent
from athena.world_state import Battlefield
from athena.resolvers.movement import MovementResolver
from athena.world_state import Soldier
from athena.models import (
    AgentContext,
    ChosenAction,
    MoveAction,
    MoveDirection,
    ObservedSoldier,
    Position,
    SurvivalState,
    Team,
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
        ) -> ChosenAction:
            messages.extend(request_messages)
            return ChosenAction(
                action=MoveAction(direction=MoveDirection.EAST),
            )

    class Llm:
        def with_structured_output(self, *_: object, **__: object) -> StructuredLlm:
            return StructuredLlm()

    monkeypatch.setattr(agent, "ChatOpenRouter", lambda **_: Llm())

    soldier = Soldier(Team.BLUE, Position(x=0, y=0, z=0))
    battlefield = Battlefield(width=2, height=1, soldiers=[soldier])
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

    assert result == MoveAction(direction=MoveDirection.EAST)
    assert "ordered from oldest to newest" in messages[0][1]
    assert "up to 7 prior tick observations" in messages[0][1]
    assert "elevation differs by more than 2 levels" in messages[0][1]
    assert json.loads(messages[1][1]) == json.loads(agent_context.model_dump_json())
