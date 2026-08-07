"""Immutable snapshots and results produced during tick execution."""

from pydantic import BaseModel

from athena.models.actions import Action
from athena.models.communications import CommunicationGroup, TeamMessage
from athena.models.common import (
    IMMUTABLE_MODEL_CONFIG,
    Position,
    SurvivalState,
    Team,
)
from athena.models.observations import VisibilityObservation
from athena.params import TERRAIN_PROFILES
from athena.terrain import TerrainClass, TerrainProfile


class SoldierSnapshot(BaseModel):
    model_config = IMMUTABLE_MODEL_CONFIG

    soldier_index: int
    team: Team
    position: Position
    survival_status: SurvivalState
    vision_range: float
    communication_group_ids: frozenset[str]


class BattlefieldSnapshot(BaseModel):
    model_config = IMMUTABLE_MODEL_CONFIG

    width: int
    height: int
    surface: frozenset[Position]
    soldiers: tuple[SoldierSnapshot, ...]
    communication_groups: tuple[CommunicationGroup, ...]
    terrain_classes: tuple[TerrainClass, ...]
    """Row-major class grid, one entry per width x height cell."""

    def terrain_at(self, x: int, y: int) -> TerrainClass:
        return self.terrain_classes[y * self.width + x]

    def profile_at(self, x: int, y: int) -> TerrainProfile:
        return TERRAIN_PROFILES[self.terrain_at(x, y)]


class ShotOutcome(BaseModel):
    model_config = IMMUTABLE_MODEL_CONFIG

    shooter_index: int
    target_index: int
    hit_probability: float
    roll: float
    hit: bool


class ExecutionResult(BaseModel):
    model_config = IMMUTABLE_MODEL_CONFIG

    actions: tuple[Action | None, ...]
    shot_outcomes: tuple[ShotOutcome, ...]
    observations: tuple[VisibilityObservation, ...]
    before: BattlefieldSnapshot
    after: BattlefieldSnapshot
    team_messages: tuple[TeamMessage, ...] = ()
