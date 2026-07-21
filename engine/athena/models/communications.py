"""Communication groups and messages exchanged between soldier agents."""

from pydantic import BaseModel, Field

from athena.models.common import IMMUTABLE_MODEL_CONFIG, Team
from athena.params import TEAM_MESSAGE_MAX_LENGTH


class CommunicationGroup(BaseModel):
    """A same-faction broadcast group available to selected soldiers."""

    model_config = IMMUTABLE_MODEL_CONFIG

    group_id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    team: Team


class BroadcastDraft(BaseModel):
    """An agent's proposed broadcast before the engine attaches sender metadata."""

    model_config = IMMUTABLE_MODEL_CONFIG

    group_id: str = Field(min_length=1)
    content: str = Field(min_length=1, max_length=TEAM_MESSAGE_MAX_LENGTH)


class TeamMessage(BaseModel):
    """A validated broadcast visible to members of one communication group."""

    model_config = IMMUTABLE_MODEL_CONFIG

    sent_tick: int
    group_id: str
    sender_index: int
    content: str = Field(min_length=1, max_length=TEAM_MESSAGE_MAX_LENGTH)
