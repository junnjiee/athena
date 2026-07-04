from langchain_openrouter import ChatOpenRouter

from athena.battlefield import Battlefield
from athena.resolvers.movement import MovementResolver
from athena.soldier import Soldier
from athena.types import Action, ChosenAction, MoveAction, ObservedSoldier, ShootAction


async def choose_action(
    observed_soldier: ObservedSoldier,
    battlefield: Battlefield,
    soldier: Soldier,
    movement_resolver: MovementResolver,
    max_attempts: int = 3,
    model: str = "deepseek/deepseek-v4-flash",
) -> Action | None:
    llm = ChatOpenRouter(model=model)
    structured_llm = llm.with_structured_output(ChosenAction)

    for _ in range(max_attempts):
        chosen_action = await structured_llm.ainvoke(
            [
                (
                    "system",
                    "You are a soldier-agent in a grid battlefield simulation. "
                    "Shooting is not implemented yet. Choose exactly one move "
                    "action. Return only the structured action.",
                ),
                (
                    "human",
                    observed_soldier.model_dump_json(),
                ),
            ]
        )

        # LangChain types structured output as BaseModel | dict, even when a
        # Pydantic schema is provided. Keep the external LLM boundary explicit
        # before resolving an engine action.
        if not isinstance(chosen_action, ChosenAction):
            raise TypeError("Expected ChosenAction from structured LLM output.")

        action = chosen_action.action

        if isinstance(action, MoveAction):
            if movement_resolver.verify_move_action(battlefield, soldier, action):
                return action

        if isinstance(action, ShootAction):
            continue

    return None
