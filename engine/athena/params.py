"""Tunable parameters for the Athena engine and its agents."""

from athena.terrain import TERRAIN_LABELS, TerrainClass, TerrainProfile

# Terrain
TERRAIN_PROFILES: dict[TerrainClass, TerrainProfile] = {
    #                            passable, move_cost, opacity/m, conceal, protect
    TerrainClass.OPEN_GROUND: TerrainProfile(True, 1.0, 0.00, 0.00, 0.00),
    TerrainClass.GRASSLAND: TerrainProfile(True, 1.1, 0.01, 0.10, 0.00),
    TerrainClass.SCRUB: TerrainProfile(True, 1.6, 0.03, 0.45, 0.05),
    TerrainClass.DENSE_FOREST: TerrainProfile(True, 2.0, 0.05, 0.70, 0.15),
    TerrainClass.WETLAND: TerrainProfile(True, 2.5, 0.01, 0.15, 0.00),
    TerrainClass.WATER: TerrainProfile(False, 4.0, 0.00, 0.00, 0.00),
    TerrainClass.URBAN: TerrainProfile(True, 1.2, 0.10, 0.60, 0.40),
    TerrainClass.STRUCTURE: TerrainProfile(False, 4.0, 1.00, 0.00, 0.90),
    TerrainClass.ROAD: TerrainProfile(True, 0.8, 0.00, 0.00, 0.00),
    TerrainClass.BARREN_ROCK: TerrainProfile(True, 1.4, 0.08, 0.20, 0.30),
}
"""Terrain effects per class.

These are tunable simulation assumptions, not measured values. Opacity is
calibrated so dense forest blocks sight at roughly 20 m (0.05/m) while a
structure blocks immediately. Impassable classes keep a nominal move_cost so
the table stays total.
"""

DEFAULT_TERRAIN_CLASS = TerrainClass.OPEN_GROUND


def _terrain_names(predicate) -> str:
    """Comma-separated class names matching a profile predicate."""
    return ", ".join(
        TERRAIN_LABELS[terrain_class]
        for terrain_class, profile in TERRAIN_PROFILES.items()
        if predicate(profile)
    )


def impassable_terrain_names() -> str:
    return _terrain_names(lambda profile: not profile.passable)


def build_terrain_guidance() -> str:
    """Describe terrain effects to an agent, derived from the profile table.

    Generated rather than written out so the prompt cannot drift from the
    values the resolvers actually use.
    """
    # Concealment and protection only matter where a soldier can actually
    # stand, so those two sentences exclude impassable classes.
    return (
        f"You cannot enter {impassable_terrain_names()}. "
        f"{_terrain_names(lambda p: p.passable and p.concealment >= 0.4)} "
        "hide you from enemies. "
        f"{_terrain_names(lambda p: p.passable and p.protection >= 0.3)} "
        "reduce the chance of being hit. "
        f"{_terrain_names(lambda p: p.opacity_per_metre >= 0.05)} "
        "also block your own sight over distance."
    )

# Vision
DEFAULT_SOLDIER_VISION_RANGE = 10.0
MAX_VISION_RANGE = 100.0
SOLDIER_EYE_HEIGHT = 1.0

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
    "Your terrain is drawn as a map: one character per grid cell, with a legend "
    "naming each character, and a second grid below it giving each cell's "
    "elevation. Rows run north to south and columns west to east, so moving "
    "north is up the map and east is right. A blank cell is one you have no "
    "line of sight to. Beneath the map your own coordinates are marked; use it "
    "to navigate. "
    "{terrain_guidance} "
    "Recent ticks lists up to {visibility_history_limit} prior ticks, oldest "
    "first, each giving your exact pre-action position and the action you "
    "submitted. That records what you proposed, including doing nothing; it "
    "does not report whether a move was accepted or whether a shot hit. It "
    "does not repeat terrain, because the map above is current. "
    "Radio nets lists every broadcast group you may use, by group_id. "
    "Radio traffic lists up to {communication_history_limit} "
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
    "\n- Moving into impassable terrain ({impassable_terrain})."
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
        terrain_guidance=build_terrain_guidance(),
        impassable_terrain=impassable_terrain_names(),
    )
