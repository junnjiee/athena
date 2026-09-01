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
    # A field work, not ground the classifier found. Protection above urban and
    # below a structure: a dug-in soldier is hard to hit but not behind a wall.
    # Concealment is a defender lying low rather than foliage, and the move cost
    # is the price of getting in and out rather than of the metre itself.
    TerrainClass.TRENCH: TerrainProfile(True, 1.8, 0.02, 0.55, 0.75),
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
MAX_VISION_RANGE = 600.0
"""Ceiling on how far any soldier may detect another.

Raised from 100 so an ORBAT vision range means something: a Recon Section is
drawn at 500 m against a Rifle Section's 300 m, and both used to be clamped.
What this buys is *awareness*, not reach -- see MAX_RENDERED_TERRAIN_RADIUS.
"""

MAX_RENDERED_TERRAIN_RADIUS = 12
"""How far the drawn map an agent reads extends, in cells.

Vision range and rendered ground are separated because they cost different
things. Enemy detection is a pairwise check, so a long range is nearly free.
Terrain is not: the scan is quadratic in radius with a sightline walk per cell,
and every visible cell becomes two characters of prompt on every call of every
tick. Measured at radius 10 that is ~313 cells and ~1,360 input tokens; at 100
the window is 201x201, which is roughly 20k tokens per soldier per tick.

This is also what keeps the shooting model honest. A soldier engages only what
is on its drawn map, so engagements stay inside this radius, where a flat
90% base hit probability with no range term is a defensible approximation.
Beyond it a soldier knows a bearing and a distance band and nothing more.
Giving long-range vision *reach* as well needs a range-dependent hit model
first.
"""

NIGHT_VISION_MULTIPLIER = 0.5
"""What a soldier's vision range becomes when the plan's H-hour is at night.

A balance decision, not a measurement. Weather is still not modelled -- exported
visibility runs to thousands of metres, far beyond any vision range the engine
uses -- but daylight is the one field with real bite, and without this a plan
drawn for an 0300 approach simulated exactly like a midday one.
"""

SOLDIER_EYE_HEIGHT = 1.0

# Movement
MAX_ELEVATION_CHANGE = 1

MAX_MOVE_DISTANCE = 10
"""Hard ceiling on cells a soldier may request in one tick.

A tick used to be exactly one metre, which is why a sixty-tick run could not
cross ground eight hundred metres wide: two forces drawn three hundred metres
apart never met, and the batch reported "both sides alive" as though that were a
modelling result rather than the clock. A tick is now a bound rather than a
distance. The ceiling exists so the action schema stays finite and a soldier
cannot cross the whole battlefield between observations.
"""

DEFAULT_MOVE_BUDGET = 5.0
"""Terrain cost a soldier may spend moving in one tick.

Entering a cell costs that cell's ``move_cost``, so the allowance buys about five
cells of open ground, six of road, two of dense forest. This is what gives
``move_cost`` an effect: before it was tabulated per class and read by nothing,
so wetland and road cost a soldier the same.
"""

MARCH_MOVE_BUDGET = 18.0
"""Movement allowance for a soldier that is not in contact.

Forces move fast when nobody is shooting at them and slowly when someone is.
Without the distinction, crossing a kilometre of empty ground at a fighting pace
took more ticks than any sensible budget allowed, so a plan whose sections start
far apart could not be simulated at all -- and every one of those ticks was a
model call spent walking.

Applied when a soldier can see no enemy and is not suppressed. The gait budget
takes over the moment either becomes true.
"""

MOVE_BUDGET_BY_GAIT = {
    "prowl": 2.0,
    "patrol": 5.0,
    "charge": 8.0,
}
"""Movement allowance by the gait its route was drawn with.

A gait had no mechanical effect at all before, because nothing in the engine
consumed distance. Prowling trades ground for the option to stay in cover;
charging buys ground at the cost of arriving somewhere unobserved, since vision
is unchanged and a soldier can now cross more ground than it can see.
"""

# Shooting
BASE_HIT_PROBABILITY = 0.90
ELEVATION_HIT_MODIFIER_PER_LEVEL = 0.02
MINIMUM_HIT_PROBABILITY = 0.50
MAXIMUM_HIT_PROBABILITY = 0.99

MAGAZINE_ROUNDS = 30
"""Rounds a soldier fires before it must reload."""

SUPPRESSION_HIT_MULTIPLIER = 0.35
"""What a soldier's accuracy becomes while it is under fire.

A soldier being shot at is not shooting back as well. Without this the model had
no answer to incoming fire at all, so two sides inside effective range simply
traded near-certain hits and a firefight resolved in two or three ticks with
both sides destroyed -- a result that told a commander nothing about the plan
being tested. Suppression is what makes a firefight last long enough for
position, cover and manoeuvre to decide it.

A balance decision, not a measurement.
"""

RIFLE_EFFECTIVE_RANGE = 50.0
"""Distance out to which marksmanship alone decides a shot, in metres.

Inside this, a shot is governed by the base probability, elevation, and the
target's cover, exactly as it always was.
"""

RIFLE_MAXIMUM_RANGE = 400.0
"""Distance at which a shot is as unlikely as the model allows.

Between the effective and maximum ranges the chance falls linearly to the
long-range floor. Without this the model had no range term at all: a soldier hit
90% of the time at any distance it could see, which was harmless while vision was
ten metres and indefensible once vision reached an establishment's real range.
"""

LONG_RANGE_HIT_FLOOR = 0.05
"""Multiplier applied to the hit chance at and beyond the maximum range.

Not zero: a lucky round at long range is possible, it is just not a plan.
"""

# OpenRouter provider settings
AGENT_REASONING_EFFORT = "low"
"""Reasoning budget asked of the model.

gpt-oss-120b reasons by default, and unconstrained it spends more tokens
thinking than answering: measured at 348-381 reasoning tokens against a ~40
token action. At "low" that falls to ~115, which is a third of the output bill
and roughly a second off every call. A soldier picking one of eight directions
from a drawn map is not a problem that rewards a long deliberation.
"""

AGENT_MAX_OUTPUT_TOKENS = 900
"""Ceiling on tokens the model may return.

Not primarily a cost control: OpenRouter reserves credit against this value, and
with it unset the reservation is the model's full 65536-token budget. An account
holding less than that is refused outright -- a PaymentRequiredResponseError on
every call -- while the request itself needs a few hundred tokens. Leaving this
unset makes runs fail for lack of credit the run would never have spent.

Raised from 512 once a turn had to carry a rationale and an order duration as
well as an action. Reasoning is what fills this, and on a real battlefield
prompt it was reaching the ceiling and returning an empty completion -- which
surfaces as a parse failure, costs a retry, and falls back to a standing order.
Still two orders of magnitude below the unset reservation.
"""

AGENT_REQUEST_TIMEOUT_MS = 20_000
"""Deadline for one model request.

Without it a stalled request has no bound at all: the provider SDK retries with
backoff up to max_retries * 150 s, the chooser wraps that in its own attempt
loop, and a tick waits on its slowest soldier. One unlucky call could hold a
simulation for many minutes.

Tightened from 30 s once commanders had a deterministic standing order to fall
back on. A call that has not answered in twenty seconds is worth abandoning: the
fallback is a sensible order and costs nothing, where waiting costs the whole
tick and usually yields nothing anyway. Measured, a healthy call answers in
one to seven seconds.
"""

AGENT_TRANSPORT_RETRIES = 1
"""Provider-SDK retries for transport failures.

Distinct from MAX_ACTION_ATTEMPTS, which re-asks after an *illegal* action. The
SDK default of 2 stacks a second multiplier under the chooser's own loop; one
retry keeps a blip survivable without compounding the tail.
"""

FOLLOWER_COHESION_DISTANCE = 4.0
"""How far a non-commanding soldier lets its section commander get, in metres.

Inside this it holds its ground; beyond it, it closes. Small enough that a
section stays a section, large enough that six soldiers are not all trying to
stand on the same cell.
"""

REASONING_MAX_LENGTH = 100
"""Characters an agent may spend saying why it did something.

Short on purpose: it is output tokens on every call of every tick, and the point
is a legible one-line intent an operator can scan down a column, not an essay.
"""

CLOSE_CONTACT_DISTANCE = 15.0
"""Distance at which an enemy counts as close rather than merely in range.

One of the bands that make a commander re-decide. The bands exist so that
"in contact" is not automatically a model call every tick: what is worth
rethinking is the enemy appearing, coming into weapon range, or closing to this,
rather than being a metre nearer than last tick.
"""

WAYPOINT_REACHED_DISTANCE = 6.0
"""How close counts as having reached a waypoint, in metres.

Generous, because a waypoint is a point on a drawn line rather than a place a
soldier must stand: insisting on the exact cell would have a section circling it.
"""

MAX_ORDER_TICKS = 10
"""Longest an agent may declare its own order good for.

A commander is asked how many ticks its decision should stand, not just what to
do. "Advance to the treeline" is one decision covering ten ticks, not ten
identical decisions -- and because ticks are serial, ten ticks that need no call
are ten ticks that cost no wall-clock time either. Bounded so an order can never
outlive the run's ability to notice it has gone wrong, and overridden the moment
the situation changes.
"""

STALL_TICKS = 4
"""Ticks without progress before a commander is asked again.

A standing order that is not getting anywhere is the deterministic layer failing
at something, and the whole point of having agents is that they handle what it
cannot. Short, because a stalled section is wasting the run.
"""

AGENT_HEARTBEAT_TICKS = 12
"""How long a commander may go on its own judgement before being asked again.

A commander out of contact is executing an order, not making a decision, so it
advances along its drawn axis without a model call. This bounds how stale that
gets: even with nothing happening it is asked afresh this often, which is what
keeps a long approach from running entirely on a decision made at tick one.
"""

# Agent loop
MAX_ACTION_ATTEMPTS = 2
"""Times a commander is re-asked after proposing an illegal action.

Was three. A rejected proposal costs a whole round trip, and measured latency
runs to several seconds by mid-run, so a third attempt is several seconds spent
to improve on a standing order that is already reasonable. Two attempts, then
the fallback.
"""

VISIBILITY_HISTORY_LIMIT = 4
COMMUNICATION_HISTORY_LIMIT = 4
"""How many past ticks an agent is shown.

Both were ten. Measured over a twelve-tick run, the prompt grew from 5.4k to
7.2k characters as these filled, and per-call latency climbed from 1.6 s to
7 s -- latency here is set by how much the model reads and reasons over, not by
transport. Four ticks is still enough to see a trend and costs a fraction of
the wall clock.
"""
TEAM_MESSAGE_MAX_LENGTH = 280
INCOMING_FIRE_RADIUS = 10.0
INCOMING_FIRE_NEAR_DISTANCE = 5.0
INCOMING_FIRE_MEDIUM_DISTANCE = 10.0
INCOMING_FIRE_HISTORY_LIMIT = 5

# OpenRouter agent prompt
DEFAULT_TEAM_OBJECTIVE_LINES = {
    "blue": "\n- Blue: advance toward the right/east side of the battlefield.",
    "red": "\n- Red: advance toward the left/west side of the battlefield.",
}
"""Fallback orders per side, keyed by the payload's own side names.

Split per side so a scenario that gives one team a drawn objective can leave the
other on the compass default without restating it -- see athena.hosted.orders.
"""

DEFAULT_TEAM_OBJECTIVES = "".join(DEFAULT_TEAM_OBJECTIVE_LINES.values())

OPENROUTER_SYSTEM_PROMPT_TEMPLATE = (
    "You are a soldier-agent in a grid battlefield simulation. "
    "Choose exactly one action: hold position, move, or shoot. "
    "Holding keeps your current position and does not fire your weapon. "
    "A move names one of eight directions and how many cells to travel along "
    "it, from 1 to {max_move_distance}. "
    "Entering a cell spends that cell's movement cost against your allowance "
    "for the tick, which is {move_budget}; open ground costs 1.0, road 0.8, "
    "dense forest 2.0, wetland 2.5. You advance as far along your chosen "
    "direction as the ground and that allowance permit and then stop, so asking "
    "for more cells than you can afford is not an error -- you simply travel "
    "less far. You stop early at the battlefield edge, at terrain you cannot "
    "enter or climb, and on reaching another soldier. "
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
    "Incoming fire lists shots directed near you during recent ticks. Each "
    "entry gives an approximate bearing and distance to the source, without "
    "revealing the shooter's identity or exact position. "
    "Radio nets lists every broadcast group you may use, by group_id. "
    "Radio traffic lists up to {communication_history_limit} "
    "messages you previously sent or received, ordered from oldest to newest. "
    "You may attach one optional broadcast to the same turn as your physical "
    "action. Select only a listed communication group and keep the message at "
    "most {message_max_length} characters. Other group members receive it on "
    "the next tick. "
    "Always give a rationale: one short sentence, at most {reasoning_max_length} "
    "characters, saying why you chose this action. It is read by the operator "
    "reviewing the battle afterwards, so state your intent, not the rules. "
    "Also give hold_for: how many ticks, from 1 to {max_order_ticks}, this "
    "decision should stand before you are asked again. Your order is carried out "
    "for that many ticks, and is interrupted immediately anyway if an enemy "
    "appears, comes into range, closes on you, opens fire, or you lose someone. "
    "So choose a long hold_for when you are crossing ground you expect to be "
    "empty, and a short one when you expect the situation to change. "
    "Return only the structured turn."
    "\n\nTeam objectives:"
    "{team_objectives}"
    "\n\nIllegal actions:"
    "\n- Moving when the very first cell in your chosen direction is off the "
    "battlefield, impassable ({impassable_terrain}), differs in elevation by "
    "more than {elevation_limit}, or costs more than your remaining allowance."
    "\n- Moving a distance below 1 or above {max_move_distance}."
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
    move_budget: float = DEFAULT_MOVE_BUDGET,
    max_move_distance: int = MAX_MOVE_DISTANCE,
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
        max_order_ticks=MAX_ORDER_TICKS,
        reasoning_max_length=REASONING_MAX_LENGTH,
        move_budget=f"{move_budget:g}",
        max_move_distance=max_move_distance,
        visibility_history_limit=visibility_history_limit,
        communication_history_limit=communication_history_limit,
        message_max_length=message_max_length,
        elevation_limit=elevation_limit,
        team_objectives=rendered_team_objectives,
        terrain_guidance=build_terrain_guidance(),
        impassable_terrain=impassable_terrain_names(),
    )
