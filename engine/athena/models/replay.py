"""Stable, result-only models consumed by replay clients."""

from typing import Literal

from pydantic import BaseModel

from athena.models.common import (
    IMMUTABLE_MODEL_CONFIG,
    Position,
    SurvivalState,
    Team,
)


class ReplayCommunicationGroup(BaseModel):
    model_config = IMMUTABLE_MODEL_CONFIG

    group_id: str
    name: str
    team: Team
    member_indices: tuple[int, ...]


class ReplayBattlefield(BaseModel):
    model_config = IMMUTABLE_MODEL_CONFIG

    width: int
    height: int
    surface: tuple[Position, ...]
    cover: tuple[Position, ...]
    concealment: tuple[Position, ...]
    communication_groups: tuple[ReplayCommunicationGroup, ...]


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


class ReplayMessage(BaseModel):
    model_config = IMMUTABLE_MODEL_CONFIG

    sender_index: int
    group_id: str
    content: str


class ReplayStep(BaseModel):
    model_config = IMMUTABLE_MODEL_CONFIG

    step: int
    soldiers: tuple[ReplaySoldier, ...]
    shots: tuple[ReplayShot, ...]
    messages: tuple[ReplayMessage, ...]


class ReplayLog(BaseModel):
    model_config = IMMUTABLE_MODEL_CONFIG

    schema_version: Literal[2] = 2
    battlefield: ReplayBattlefield
    steps: tuple[ReplayStep, ...]
