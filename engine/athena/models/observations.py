"""Agent-local perception and visibility-history models."""

from pydantic import BaseModel, computed_field

from athena.models.actions import Action
from athena.models.common import (
    IMMUTABLE_MODEL_CONFIG,
    Position,
    SurvivalState,
    Team,
)
from athena.models.communications import CommunicationGroup, TeamMessage
from athena.terrain import TERRAIN_LABELS, TerrainClass


class VisibleSoldier(BaseModel):
    model_config = IMMUTABLE_MODEL_CONFIG

    team: Team
    position: Position
    survival_status: SurvivalState


class TerrainCell(BaseModel):
    model_config = IMMUTABLE_MODEL_CONFIG

    position: Position
    terrain_class: TerrainClass

    @computed_field
    @property
    def terrain(self) -> str:
        """The class name, so an agent reads terrain rather than an index."""
        return TERRAIN_LABELS[self.terrain_class]


class ObservedSoldier(BaseModel):
    """Data passed to an agent, bounding what that agent can see."""

    model_config = IMMUTABLE_MODEL_CONFIG

    team: Team
    position: Position
    survival_status: SurvivalState
    visible_soldiers: list[VisibleSoldier]
    available_terrain: list[TerrainCell]


class VisibilityObservation(BaseModel):
    """The local context and submitted action from one completed tick."""

    model_config = IMMUTABLE_MODEL_CONFIG

    tick: int
    position: Position
    submitted_action: Action | None
    visible_soldiers: list[VisibleSoldier]
    available_terrain: list[TerrainCell]


class AgentContext(BaseModel):
    """Local state plus bounded visibility and communication history."""

    model_config = IMMUTABLE_MODEL_CONFIG

    current_observation: ObservedSoldier
    visibility_history: tuple[VisibilityObservation, ...]
    communication_groups: tuple[CommunicationGroup, ...] = ()
    communication_history: tuple[TeamMessage, ...] = ()
