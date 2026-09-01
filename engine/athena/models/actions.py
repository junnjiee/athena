"""Action models exchanged between soldier agents and engine adjudication."""

import json
from enum import StrEnum
from typing import Any, Literal, TypeAlias

from pydantic import BaseModel, Field, model_validator
from pydantic.json_schema import JsonSchemaValue
from pydantic_core import CoreSchema

from athena.models.communications import BroadcastDraft
from athena.models.common import IMMUTABLE_MODEL_CONFIG, Position
from athena.params import (
    MAX_MOVE_DISTANCE,
    MAX_ORDER_TICKS,
    REASONING_MAX_LENGTH,
)


class ActionKind(StrEnum):
    HOLD = "hold"
    MOVE = "move"
    SHOOT = "shoot"


class MoveDirection(StrEnum):
    NORTH = "north"
    NORTHEAST = "northeast"
    EAST = "east"
    SOUTHEAST = "southeast"
    SOUTH = "south"
    SOUTHWEST = "southwest"
    WEST = "west"
    NORTHWEST = "northwest"


class MoveAction(BaseModel):
    model_config = IMMUTABLE_MODEL_CONFIG

    kind: Literal[ActionKind.MOVE] = ActionKind.MOVE
    direction: MoveDirection
    # Cells to travel along the direction. Defaults to one so every scenario and
    # test written when a move was exactly one cell still means what it did.
    # The soldier travels as far as terrain and its allowance permit, so this is
    # a request rather than a guarantee.
    distance: int = Field(default=1, ge=1, le=MAX_MOVE_DISTANCE)

    @classmethod
    def __get_pydantic_json_schema__(
        cls,
        core_schema: CoreSchema,
        handler: Any,
    ) -> JsonSchemaValue:
        """Make ``distance`` required in the schema the model is shown.

        A Python default makes a field optional in the generated schema, and a
        model shown an optional field simply omits it -- which silently defaults
        every move back to one cell and undoes multi-cell movement entirely.
        The default is still wanted on the Python side, where scenarios and
        tests written before distances existed construct a MoveAction without
        one, so the two are deliberately decoupled here.
        """
        schema = handler(core_schema)
        schema["required"] = sorted({*schema.get("required", []), "distance"})
        return schema


class ShootAction(BaseModel):
    model_config = IMMUTABLE_MODEL_CONFIG

    kind: Literal[ActionKind.SHOOT] = ActionKind.SHOOT
    target_position: Position


class HoldAction(BaseModel):
    model_config = IMMUTABLE_MODEL_CONFIG

    kind: Literal[ActionKind.HOLD] = ActionKind.HOLD


Action: TypeAlias = HoldAction | MoveAction | ShootAction


class ChosenAction(BaseModel):
    model_config = IMMUTABLE_MODEL_CONFIG

    action: MoveAction | ShootAction

    @model_validator(mode="before")
    @classmethod
    def _unwrap_stringified_action(cls, data: Any) -> Any:
        """Normalize the LLM boundary before validation.

        models emit the nested ``action`` as an escaped JSON string, e.g.
        ``{"action": "{\\"kind\\": \\"move\\", ...}"}`` instead of a real nested
        object.
        Pydantic will not coerce a str into a nested model, so that shape
        raises a model_type ValidationError. Parse only that case back into a
        dict; a properly nested object passes through untouched.
        """
        if isinstance(data, dict) and isinstance(data.get("action"), str):
            try:
                parsed = json.loads(data["action"])
            except json.JSONDecodeError as exc:
                raise ValueError("action must be valid JSON") from exc
            return {**data, "action": parsed}
        return data


class ActionValidationResult(BaseModel):
    """Internal legality result used to explain rejected actions to an agent."""

    model_config = IMMUTABLE_MODEL_CONFIG

    valid: bool
    reason: str | None = None

    @classmethod
    def accepted(cls) -> "ActionValidationResult":
        return cls(valid=True)

    @classmethod
    def rejected(cls, reason: str) -> "ActionValidationResult":
        return cls(valid=False, reason=reason)


class ChosenTurn(BaseModel):
    """OpenRouter's physical action plus an optional team broadcast."""

    model_config = IMMUTABLE_MODEL_CONFIG

    action: HoldAction | MoveAction | ShootAction
    broadcast: BroadcastDraft | None = None

    @classmethod
    def __get_pydantic_json_schema__(
        cls,
        core_schema: CoreSchema,
        handler: Any,
    ) -> JsonSchemaValue:
        """Make ``rationale`` required in the schema the model is shown.

        A Python default makes a field optional, and a model shown an optional
        field omits it -- which would leave every recorded decision blank. The
        default stays for engine-side callers, which have nothing to explain.
        """
        schema = handler(core_schema)
        schema["required"] = sorted(
            {*schema.get("required", []), "rationale", "hold_for"}
        )
        return schema

    # One short sentence on why. Recorded in the replay so an operator reading a
    # result can see what each commander thought it was doing, rather than
    # inferring intent from a track of positions. Bounded because it is output
    # tokens on every call of every tick.
    rationale: str = Field(default="", max_length=REASONING_MAX_LENGTH)
    # How many ticks this decision stands for before the commander is asked
    # again. The situation changing overrides it, so this only ever lengthens
    # the quiet stretches. Defaults to one so an engine-side caller that does
    # not set it behaves exactly as before.
    hold_for: int = Field(default=1, ge=1, le=MAX_ORDER_TICKS)

    @model_validator(mode="before")
    @classmethod
    def _unwrap_stringified_action(cls, data: Any) -> Any:
        if isinstance(data, dict) and isinstance(data.get("action"), str):
            try:
                parsed = json.loads(data["action"])
            except json.JSONDecodeError as exc:
                raise ValueError("action must be valid JSON") from exc
            return {**data, "action": parsed}
        return data
