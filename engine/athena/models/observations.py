"""Agent-local perception and visibility-history models."""

from pydantic import BaseModel

from athena.models.common import (
    IMMUTABLE_MODEL_CONFIG,
    Position,
    SurvivalState,
    Team,
)


class VisibleSoldier(BaseModel):
    model_config = IMMUTABLE_MODEL_CONFIG

    team: Team
    position: Position
    survival_status: SurvivalState


class VisibleSoldiers(BaseModel):
    model_config = IMMUTABLE_MODEL_CONFIG

    soldiers: list[VisibleSoldier]


class TerrainCell(BaseModel):
    model_config = IMMUTABLE_MODEL_CONFIG

    position: Position
    has_cover: bool
    has_concealment: bool


class AvailableTerrain(BaseModel):
    model_config = IMMUTABLE_MODEL_CONFIG

    cells: list[TerrainCell]


class ObservedSoldier(BaseModel):
    """Data passed to an agent, bounding what that agent can see."""

    model_config = IMMUTABLE_MODEL_CONFIG

    team: Team
    position: Position
    survival_status: SurvivalState
    visible_soldiers: VisibleSoldiers
    available_terrain: AvailableTerrain


class VisibilityObservation(BaseModel):
    """The local visibility used to choose actions in one completed tick."""

    model_config = IMMUTABLE_MODEL_CONFIG

    tick: int
    visible_soldiers: VisibleSoldiers
    available_terrain: AvailableTerrain


class AgentContext(BaseModel):
    """The current local state and bounded visibility history sent to an agent."""

    model_config = IMMUTABLE_MODEL_CONFIG

    current_observation: ObservedSoldier
    visibility_history: tuple[VisibilityObservation, ...]
