"""Stable, result-only models consumed by replay clients."""

from typing import Literal

from pydantic import BaseModel

from athena.models.common import (
    IMMUTABLE_MODEL_CONFIG,
    Position,
    SurvivalState,
    Team,
)


class ReplayBattlefield(BaseModel):
    model_config = IMMUTABLE_MODEL_CONFIG

    width: int
    height: int
    surface: tuple[Position, ...]
    cover: tuple[Position, ...]
    concealment: tuple[Position, ...]


class ReplaySoldier(BaseModel):
    model_config = IMMUTABLE_MODEL_CONFIG

    soldier_index: int
    team: Team
    position: Position
    survival_status: SurvivalState


class ReplayShot(BaseModel):
    model_config = IMMUTABLE_MODEL_CONFIG

    shooter_index: int
    target_index: int
    shooter_position: Position
    target_position: Position
    hit: bool


class ReplayStep(BaseModel):
    model_config = IMMUTABLE_MODEL_CONFIG

    step: int
    soldiers: tuple[ReplaySoldier, ...]
    shots: tuple[ReplayShot, ...]


class ReplayLog(BaseModel):
    model_config = IMMUTABLE_MODEL_CONFIG

    schema_version: Literal[1] = 1
    battlefield: ReplayBattlefield
    steps: tuple[ReplayStep, ...]
