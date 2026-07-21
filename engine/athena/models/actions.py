"""Action models exchanged between soldier agents and engine adjudication."""

import json
from enum import StrEnum
from typing import Any, Literal, TypeAlias

from pydantic import BaseModel, model_validator

from athena.models.communications import BroadcastDraft
from athena.models.common import IMMUTABLE_MODEL_CONFIG, Position


class ActionKind(StrEnum):
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


class ShootAction(BaseModel):
    model_config = IMMUTABLE_MODEL_CONFIG

    kind: Literal[ActionKind.SHOOT] = ActionKind.SHOOT
    target_position: Position


Action: TypeAlias = MoveAction | ShootAction


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

    action: MoveAction | ShootAction
    broadcast: BroadcastDraft | None = None

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
