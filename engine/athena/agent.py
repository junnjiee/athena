from typing import Awaitable, Callable

from langchain_core.exceptions import OutputParserException
from langchain_openrouter import ChatOpenRouter
from pydantic import ValidationError

from functools import lru_cache

from athena.params import (
    AGENT_MAX_OUTPUT_TOKENS,
    AGENT_REASONING_EFFORT,
    AGENT_REQUEST_TIMEOUT_MS,
    AGENT_TRANSPORT_RETRIES,
    COMMUNICATION_HISTORY_LIMIT,
    MAX_ACTION_ATTEMPTS,
    MAX_ELEVATION_CHANGE,
    VISIBILITY_HISTORY_LIMIT,
    build_system_prompt,
)
from athena.context_view import render_agent_context
from athena.world_state import Battlefield
from athena.resolvers.movement import MovementResolver
from athena.resolvers.shooting import ShootingResolver
from athena.world_state import Soldier
from athena.models import (
    AgentContext,
    ChosenTurn,
    HoldAction,
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


@lru_cache(maxsize=8)
def _structured_client(model: str):
    """One client per model, reused for every soldier and every tick.

    Building a ChatOpenRouter constructs an httpx.AsyncClient eagerly, so the
    old per-call construction meant a fresh connection pool -- and therefore a
    fresh TCP and TLS handshake -- for every decision any soldier ever made. A
    hundred-run batch would have opened a client per soldier per tick.

    strict=True is what makes the schema binding rather than advisory:
    langchain_openrouter omits the "strict" field entirely when it is None, and a
    provider that is only shown a schema will happily return something else
    shaped like one -- the schema envelope itself, most often. OpenRouter routes
    each request to whichever provider is fastest, so without this the failure is
    intermittent and looks like a flaky model rather than a missing flag.
    """
    llm = ChatOpenRouter(
        model=model,
        reasoning={"effort": AGENT_REASONING_EFFORT},
        max_tokens=AGENT_MAX_OUTPUT_TOKENS,
        request_timeout=AGENT_REQUEST_TIMEOUT_MS,
        max_retries=AGENT_TRANSPORT_RETRIES,
    )
    return llm.with_structured_output(ChosenTurn, method="json_schema", strict=True)


# Call propose() up to max_attempts times, returning the first legal action.
async def _resolve_action(
    propose: Callable[[str | None], Awaitable[ChosenTurn]],
    observed_soldier: ObservedSoldier,
    battlefield: Battlefield,
    soldier: Soldier,
    movement_resolver: MovementResolver,
    shooting_resolver: ShootingResolver,
    max_attempts: int,
) -> ChosenTurn | None:
    retry_feedback: str | None = None
    for _ in range(max_attempts):
        try:
            chosen_turn = await propose(retry_feedback)
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

        action = chosen_turn.action
        broadcast = chosen_turn.broadcast
        if (
            broadcast is not None
            and broadcast.group_id not in soldier.communication_group_ids
        ):
            chosen_turn = chosen_turn.model_copy(update={"broadcast": None})

        if isinstance(action, HoldAction):
            return chosen_turn
        if isinstance(action, MoveAction):
            validation = movement_resolver.validate_move_action(
                battlefield, soldier, action
            )
            if validation.valid:
                return chosen_turn
        else:
            validation = shooting_resolver.validate_shoot_action(
                observed_soldier,
                soldier,
                action,
            )
            if validation.valid:
                return chosen_turn

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
    communication_history_limit: int = COMMUNICATION_HISTORY_LIMIT,
    team_objectives: str | None = None,
) -> ChosenTurn | None:
    if shooting_resolver is None:
        shooting_resolver = ShootingResolver()

    structured_llm = _structured_client(model)

    async def propose(retry_feedback: str | None) -> ChosenTurn:
        human_message = render_agent_context(agent_context)
        if retry_feedback is not None:
            human_message = f"{human_message}\n\nRetry feedback:\n{retry_feedback}"
        chosen = await structured_llm.ainvoke(
            [
                (
                    "system",
                    build_system_prompt(
                        visibility_history_limit,
                        movement_resolver.max_elevation_change,
                        communication_history_limit,
                        team_objectives=team_objectives,
                    ),
                ),
                ("human", human_message),
            ]
        )
        # LangChain types structured output as BaseModel | dict, even when a
        # Pydantic schema is provided. Keep the external LLM boundary explicit
        # before resolving an engine action.
        if not isinstance(chosen, ChosenTurn):
            raise TypeError("Expected ChosenTurn from structured LLM output.")
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
