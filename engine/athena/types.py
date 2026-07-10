import json
from enum import StrEnum
from typing import Any, Literal, TypeAlias

from pydantic import BaseModel, ConfigDict, model_validator


IMMUTABLE_MODEL_CONFIG = ConfigDict(frozen=True)
"""Core value/action models are immutable after validation.

The engine should replace state intentionally through resolver decisions instead
of mutating shared action or position objects in place.
"""


class Position(BaseModel):
    model_config = IMMUTABLE_MODEL_CONFIG

    x: int
    y: int


class SurvivalState(StrEnum):
    ALIVE = "alive"
    CASUALTY = "casualty"
    DEAD = "dead"


class Team(StrEnum):
    BLUE = "blue"
    RED = "red"


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
                raise ValueError(
                    f"action was a string but not valid JSON: {data['action']!r}"
                ) from exc
            return {**data, "action": parsed}
        return data


class VisibleSoldier(BaseModel):
    model_config = IMMUTABLE_MODEL_CONFIG

    team: Team
    position: Position
    survival_status: SurvivalState


class VisibleSoldiers(BaseModel):
    model_config = IMMUTABLE_MODEL_CONFIG

    soldiers: list[VisibleSoldier]


class AvailableTerrain(BaseModel):
    model_config = IMMUTABLE_MODEL_CONFIG

    cover: list[Position]
    concealment: list[Position]


class ObservedSoldier(BaseModel):
    """
    Data that will be passed to the agent. This type bounds
    what the agent can see.
    """

    model_config = IMMUTABLE_MODEL_CONFIG

    team: Team
    position: Position
    survival_status: SurvivalState
    visible_soldiers: VisibleSoldiers
    available_terrain: AvailableTerrain
