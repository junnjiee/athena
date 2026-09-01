"""Stable, result-only models consumed by replay clients."""

from typing import Literal

from pydantic import BaseModel

from athena.models.common import (
    IMMUTABLE_MODEL_CONFIG,
    Position,
    SurvivalState,
    Team,
)
from athena.terrain import TerrainClass


class ReplayCommunicationGroup(BaseModel):
    model_config = IMMUTABLE_MODEL_CONFIG

    group_id: str
    name: str
    team: Team
    member_indices: tuple[int, ...]


class ReplayBattlefield(BaseModel):
    """The ground a run was fought over, without repeating its elevation.

    Schema 3 carried a ``surface`` of one object per cell. On an 800x800 ground
    that was 16 MB of the replay's 17 -- about 92% -- and byte-identical in every
    run of a batch, so a hundred-run batch wrote roughly 1.6 GB of the same grid
    over and over. It is dropped in schema 4: elevation is in the terrain grid
    the client already holds, and every soldier and shot in the replay carries
    its own ``z``, which is where elevation actually matters to a viewer.

    The class grid stays. It is a hundredth the size and it is what makes a
    replay describe its own ground rather than depend on a client having the
    right battleground loaded.
    """

    model_config = IMMUTABLE_MODEL_CONFIG

    width: int
    height: int
    terrain_classes: tuple[TerrainClass, ...]
    """Row-major class grid, one entry per width x height cell."""
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


class ReplayDecision(BaseModel):
    """What one agent did this tick, and why it said it did it.

    Only soldiers making decisions appear: a follower running the section policy
    has no intent to report. This is what lets an operator reading a result see
    the reasoning behind it rather than inferring it from a track of positions.
    """

    model_config = IMMUTABLE_MODEL_CONFIG

    soldier_index: int
    action: str
    rationale: str


class ReplayStep(BaseModel):
    model_config = IMMUTABLE_MODEL_CONFIG

    step: int
    soldiers: tuple[ReplaySoldier, ...]
    shots: tuple[ReplayShot, ...]
    messages: tuple[ReplayMessage, ...]
    decisions: tuple[ReplayDecision, ...] = ()


class ReplayLog(BaseModel):
    model_config = IMMUTABLE_MODEL_CONFIG

    schema_version: Literal[4] = 4
    battlefield: ReplayBattlefield
    steps: tuple[ReplayStep, ...]
