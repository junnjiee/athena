from typing import Awaitable, Callable

from langchain_openrouter import ChatOpenRouter

from athena.battlefield import Battlefield
from athena.resolvers.movement import MovementResolver
from athena.soldier import Soldier
from athena.types import Action, ChosenAction, MoveAction, ObservedSoldier, ShootAction

# OpenRouter agent instructions.
SYSTEM_PROMPT = (
    "You are a soldier-agent in a grid battlefield simulation. "
    "Shooting is not implemented yet. Choose exactly one move "
    "action. Return only the structured action."
)


# Call propose() up to max_attempts times, returning the first legal move.
async def _resolve_action(
    propose: Callable[[], Awaitable[ChosenAction]],
    battlefield: Battlefield,
    soldier: Soldier,
    movement_resolver: MovementResolver,
    max_attempts: int,
) -> Action | None:
    for _ in range(max_attempts):
        action = (await propose()).action

        if isinstance(action, MoveAction):
            if movement_resolver.verify_move_action(battlefield, soldier, action):
                return action

        if isinstance(action, ShootAction):
            continue

    return None


async def choose_action(
    observed_soldier: ObservedSoldier,
    battlefield: Battlefield,
    soldier: Soldier,
    movement_resolver: MovementResolver,
    max_attempts: int = 3,
    model: str = "deepseek/deepseek-v4-flash",
) -> Action | None:
    llm = ChatOpenRouter(model=model)
    # json_schema method might only work with well known providers like OpenAI, might be unstable with DS
    structured_llm = llm.with_structured_output(ChosenAction, method="json_schema")

    async def propose() -> ChosenAction:
        chosen = await structured_llm.ainvoke(
            [("system", SYSTEM_PROMPT), ("human", observed_soldier.model_dump_json())]
        )
        # LangChain types structured output as BaseModel | dict, even when a
        # Pydantic schema is provided. Keep the external LLM boundary explicit
        # before resolving an engine action.
        if not isinstance(chosen, ChosenAction):
            raise TypeError("Expected ChosenAction from structured LLM output.")
        return chosen

    return await _resolve_action(
        propose, battlefield, soldier, movement_resolver, max_attempts
    )
