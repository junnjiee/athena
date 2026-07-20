from typing import Awaitable, Callable

from langchain_openrouter import ChatOpenRouter

from athena.params import (
    MAX_ACTION_ATTEMPTS,
    MAX_ELEVATION_CHANGE,
    VISIBILITY_HISTORY_LIMIT,
    build_system_prompt,
)
from athena.world_state import Battlefield
from athena.resolvers.movement import MovementResolver
from athena.resolvers.shooting import ShootingResolver
from athena.world_state import Soldier
from athena.models import (
    Action,
    AgentContext,
    ChosenAction,
    MoveAction,
    ObservedSoldier,
    ShootAction,
)


# Default OpenRouter instructions. Runtime overrides are rendered in choose_action.
SYSTEM_PROMPT = build_system_prompt(
    VISIBILITY_HISTORY_LIMIT,
    MAX_ELEVATION_CHANGE,
)


# Call propose() up to max_attempts times, returning the first legal action.
async def _resolve_action(
    propose: Callable[[], Awaitable[ChosenAction]],
    observed_soldier: ObservedSoldier,
    battlefield: Battlefield,
    soldier: Soldier,
    movement_resolver: MovementResolver,
    shooting_resolver: ShootingResolver,
    max_attempts: int,
) -> Action | None:
    for _ in range(max_attempts):
        action = (await propose()).action

        if isinstance(action, MoveAction):
            if movement_resolver.verify_move_action(battlefield, soldier, action):
                return action

        if isinstance(action, ShootAction):
            if shooting_resolver.verify_shoot_action(
                observed_soldier,
                soldier,
                action,
            ):
                return action

    return None


# Cloud-hosted (OpenRouter) backend.
async def choose_action(
    agent_context: AgentContext,
    battlefield: Battlefield,
    soldier: Soldier,
    movement_resolver: MovementResolver,
    max_attempts: int = MAX_ACTION_ATTEMPTS,
    model: str = "deepseek/deepseek-v4-flash",
    shooting_resolver: ShootingResolver | None = None,
    visibility_history_limit: int = VISIBILITY_HISTORY_LIMIT,
) -> Action | None:
    if shooting_resolver is None:
        shooting_resolver = ShootingResolver()

    llm = ChatOpenRouter(model=model)
    # json_schema method might only work with well known providers like OpenAI, might be unstable with DS
    structured_llm = llm.with_structured_output(ChosenAction, method="json_schema")

    async def propose() -> ChosenAction:
        chosen = await structured_llm.ainvoke(
            [
                (
                    "system",
                    build_system_prompt(
                        visibility_history_limit,
                        movement_resolver.max_elevation_change,
                    ),
                ),
                ("human", agent_context.model_dump_json()),
            ]
        )
        # LangChain types structured output as BaseModel | dict, even when a
        # Pydantic schema is provided. Keep the external LLM boundary explicit
        # before resolving an engine action.
        if not isinstance(chosen, ChosenAction):
            raise TypeError("Expected ChosenAction from structured LLM output.")
        return chosen

    return await _resolve_action(
        propose,
        agent_context.current_observation,
        battlefield,
        soldier,
        movement_resolver,
        shooting_resolver,
        max_attempts,
    )
