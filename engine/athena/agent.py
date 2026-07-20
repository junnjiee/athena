from typing import Awaitable, Callable

from langchain_openrouter import ChatOpenRouter

from athena.world_state import Battlefield
from athena.resolvers.movement import MovementResolver
from athena.resolvers.shooting import ShootingResolver
from athena.world_state import Soldier
from athena.types import (
    Action,
    AgentContext,
    ChosenAction,
    MoveAction,
    ObservedSoldier,
    ShootAction,
)

# OpenRouter agent instructions.
SYSTEM_PROMPT = (
    "You are a soldier-agent in a grid battlefield simulation. "
    "Choose exactly one action: move one grid cell or shoot. "
    "The available_terrain cells describe "
    "every grid cell in your local range, including elevation, cover, and "
    "concealment; use them to navigate. The visibility_history contains up to "
    "10 prior tick observations ordered from oldest to newest. Return only the "
    "structured action."
    "\n\nTeam objectives:"
    "\n- Blue: advance toward the right/east side of the battlefield."
    "\n- Red: advance toward the left/west side of the battlefield."
    "\n\nIllegal actions:"
    "\n- Moving outside the battlefield."
    "\n- Moving more than one grid cell."
    "\n- Moving into a cover cell."
    "\n- Moving to a cell whose elevation differs by more than one level."
    "\n- Moving into a cell occupied by a casualty or dead soldier."
    "\n- Moving into a cell occupied by a stationary living soldier."
    "\n- Shooting a friendly, casualty, dead, or non-visible soldier."
    "\n- Shooting coordinates other than the visible living enemy's exact x, y, and z."
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
    max_attempts: int = 3,
    model: str = "deepseek/deepseek-v4-flash",
    shooting_resolver: ShootingResolver | None = None,
) -> Action | None:
    if shooting_resolver is None:
        shooting_resolver = ShootingResolver()

    llm = ChatOpenRouter(model=model)
    # json_schema method might only work with well known providers like OpenAI, might be unstable with DS
    structured_llm = llm.with_structured_output(ChosenAction, method="json_schema")

    async def propose() -> ChosenAction:
        chosen = await structured_llm.ainvoke(
            [("system", SYSTEM_PROMPT), ("human", agent_context.model_dump_json())]
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
