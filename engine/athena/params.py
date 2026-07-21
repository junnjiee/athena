"""Tunable parameters for the Athena engine and its agents."""

# Vision
DEFAULT_SOLDIER_VISION_RANGE = 10.0
MAX_VISION_RANGE = 100.0
SOLDIER_EYE_HEIGHT = 1.0
CONCEALMENT_HIDE_PROBABILITY = 0.0

# Movement
MAX_ELEVATION_CHANGE = 1

# Shooting
BASE_HIT_PROBABILITY = 0.90
ELEVATION_HIT_MODIFIER_PER_LEVEL = 0.02
MINIMUM_HIT_PROBABILITY = 0.50
MAXIMUM_HIT_PROBABILITY = 0.99

# Agent loop
MAX_ACTION_ATTEMPTS = 3
VISIBILITY_HISTORY_LIMIT = 10
COMMUNICATION_HISTORY_LIMIT = 10
TEAM_MESSAGE_MAX_LENGTH = 280

# OpenRouter agent prompt
DEFAULT_TEAM_OBJECTIVES = (
    "\n- Blue: advance toward the right/east side of the battlefield."
    "\n- Red: advance toward the left/west side of the battlefield."
)

OPENROUTER_SYSTEM_PROMPT_TEMPLATE = (
    "You are a soldier-agent in a grid battlefield simulation. "
    "Choose exactly one action: hold position, move one grid cell, or shoot. "
    "Holding keeps your current position and does not fire your weapon. "
    "The available_terrain cells describe every grid cell in your local range, "
    "including elevation, cover, and concealment; use them to navigate. "
    "The visibility_history contains up to {visibility_history_limit} prior tick "
    "observations ordered from oldest to newest. Each entry includes your exact "
    "pre-action position and submitted_action. The submitted action records what "
    "you proposed, including null for no action; it does not report whether a move "
    "was accepted or whether a shot hit. "
    "The communication_groups list contains every broadcast group you may use. "
    "The communication_history contains up to {communication_history_limit} "
    "messages you previously sent or received, ordered from oldest to newest. "
    "You may attach one optional broadcast to the same turn as your physical "
    "action. Select only a listed communication group and keep the message at "
    "most {message_max_length} characters. Other group members receive it on "
    "the next tick. Return only the structured turn."
    "\n\nTeam objectives:"
    "{team_objectives}"
    "\n\nIllegal actions:"
    "\n- Moving outside the battlefield."
    "\n- Moving more than one grid cell."
    "\n- Moving into a cover cell."
    "\n- Moving to a cell whose elevation differs by more than "
    "{elevation_limit}."
    "\n- Moving into a cell occupied by a casualty or dead soldier."
    "\n- Moving into a cell occupied by a stationary living soldier."
    "\n- Shooting a friendly, casualty, dead, or non-visible soldier."
    "\n- Shooting coordinates other than the visible living enemy's exact x, y, and z."
)


def build_system_prompt(
    visibility_history_limit: int,
    max_elevation_change: int,
    communication_history_limit: int = COMMUNICATION_HISTORY_LIMIT,
    message_max_length: int = TEAM_MESSAGE_MAX_LENGTH,
    team_objectives: str | None = None,
) -> str:
    """Render the OpenRouter prompt with the effective engine limits."""
    rendered_team_objectives = (
        DEFAULT_TEAM_OBJECTIVES
        if team_objectives is None
        else team_objectives
    )
    elevation_limit = (
        "one level"
        if max_elevation_change == 1
        else f"{max_elevation_change} levels"
    )
    return OPENROUTER_SYSTEM_PROMPT_TEMPLATE.format(
        visibility_history_limit=visibility_history_limit,
        communication_history_limit=communication_history_limit,
        message_max_length=message_max_length,
        elevation_limit=elevation_limit,
        team_objectives=rendered_team_objectives,
    )
