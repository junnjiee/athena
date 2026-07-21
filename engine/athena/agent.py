from typing import Awaitable, Callable

from langchain_core.exceptions import OutputParserException
from langchain_openrouter import ChatOpenRouter
from pydantic import ValidationError

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
    SurvivalState,
)


# Default OpenRouter instructions. Runtime overrides are rendered in choose_action.
SYSTEM_PROMPT = build_system_prompt(
    VISIBILITY_HISTORY_LIMIT,
    MAX_ELEVATION_CHANGE,
)


# Call propose() up to max_attempts times, returning the first legal action.
async def _resolve_action(
    propose: Callable[[str | None], Awaitable[ChosenAction]],
    observed_soldier: ObservedSoldier,
    battlefield: Battlefield,
    soldier: Soldier,
    movement_resolver: MovementResolver,
    shooting_resolver: ShootingResolver,
    max_attempts: int,
) -> Action | None:
    retry_feedback: str | None = None
    for _ in range(max_attempts):
        try:
            action = (await propose(retry_feedback)).action
        except OutputParserException as exc:
            validation_error = exc.__cause__
            if not isinstance(validation_error, ValidationError):
                raise
            details = "; ".join(
                f"{'.'.join(str(part) for part in error['loc'])}: {error['msg']}"
                for error in validation_error.errors(include_url=False)
            )
            retry_feedback = (
                "Your previous structured action did not match the required schema: "
                f"{details}. Return a corrected structured action."
            )
            continue

        if isinstance(action, MoveAction):
            validation = movement_resolver.validate_move_action(
                battlefield, soldier, action
            )
            if validation.valid:
                return action
        else:
            validation = shooting_resolver.validate_shoot_action(
                observed_soldier,
                soldier,
                action,
            )
            if validation.valid:
                return action

        rejection_reason = validation.reason
        if (
            isinstance(action, MoveAction)
            and observed_soldier.survival_status == SurvivalState.ALIVE
        ):
            destination = movement_resolver.resolve_move_position(
                battlefield, soldier, action
            )
            destination_is_visible = destination is not None and any(
                terrain.position == destination
                for terrain in observed_soldier.available_terrain
            )
            if not destination_is_visible:
                rejection_reason = (
                    f"Moving {action.direction.value} was rejected by the movement "
                    "rules."
                )

        retry_feedback = (
            f"Your previous action {action.model_dump_json()} was rejected: "
            f"{rejection_reason} Choose a different legal action."
        )

    return None


# Cloud-hosted (OpenRouter) backend.
async def choose_action(
    agent_context: AgentContext,
    battlefield: Battlefield,
    soldier: Soldier,
    movement_resolver: MovementResolver,
    max_attempts: int = MAX_ACTION_ATTEMPTS,
    model: str = "openai/gpt-oss-120b:nitro",
    shooting_resolver: ShootingResolver | None = None,
    visibility_history_limit: int = VISIBILITY_HISTORY_LIMIT,
) -> Action | None:
    if shooting_resolver is None:
        shooting_resolver = ShootingResolver()

    llm = ChatOpenRouter(model=model)
    # json_schema method might only work with well known providers like OpenAI, might be unstable with DS
    structured_llm = llm.with_structured_output(ChosenAction, method="json_schema")

    async def propose(retry_feedback: str | None) -> ChosenAction:
        human_message = agent_context.model_dump_json()
        if retry_feedback is not None:
            human_message = f"{human_message}\n\nRetry feedback:\n{retry_feedback}"
        chosen = await structured_llm.ainvoke(
            [
                (
                    "system",
                    build_system_prompt(
                        visibility_history_limit,
                        movement_resolver.max_elevation_change,
                    ),
                ),
                ("human", human_message),
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
