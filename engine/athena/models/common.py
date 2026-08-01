"""Shared domain values used throughout the Athena engine."""

from enum import StrEnum

from pydantic import BaseModel, ConfigDict


IMMUTABLE_MODEL_CONFIG = ConfigDict(frozen=True)
"""Core value/action models are immutable after validation.

The engine should replace state intentionally through resolver decisions instead
of mutating shared action or position objects in place.
"""


class Position(BaseModel):
    model_config = IMMUTABLE_MODEL_CONFIG

    x: int
    y: int
    z: int


class SurvivalState(StrEnum):
    ALIVE = "alive"
    CASUALTY = "casualty"
    DEAD = "dead"


class Team(StrEnum):
    BLUE = "blue"
    RED = "red"
