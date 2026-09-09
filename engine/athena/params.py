"""Tunable engine defaults, in one place.

Every value here is a modelling assumption rather than a measurement, and each
is overridable per request. Centralising them means a run's behaviour can be
read off one file instead of hunted through the search.
"""

from athena.graph import RoadClass

MOUNTED_SPEEDS_KPH: dict[RoadClass, float] = {
    RoadClass.MOTORWAY: 80.0,
    RoadClass.TRUNK: 70.0,
    RoadClass.PRIMARY: 60.0,
    RoadClass.SECONDARY: 50.0,
    RoadClass.TERTIARY: 45.0,
    RoadClass.RESIDENTIAL: 30.0,
    RoadClass.UNCLASSIFIED: 30.0,
    RoadClass.SERVICE: 20.0,
    RoadClass.LIVING_STREET: 15.0,
    RoadClass.TRACK: 15.0,
}
"""Military march speeds for a mounted column, not civilian free-flow speeds.

A column moves at the speed of its slowest vehicle and does not overtake, so
these sit well below the posted limits the same roads carry.
"""

GRADIENT_SPEED_PENALTY = 2.0
"""How much a climb costs.

Effective speed is divided by ``1 + penalty * gradient`` on the way up, so a
10% climb at this setting costs about 20% of the speed. Descents are not
credited: a loaded vehicle does not make time downhill, it brakes.
"""

MAX_MOUNTED_GRADIENT = 0.25
"""Steepest grade a mounted column will attempt. Above this the edge is no-go.

Applied to the direction of travel, so a slope can be impassable one way and
legal the other.
"""

ROUTES_PER_PAIR = 8
"""``K``: routes returned per reserve-objective pair."""

MAX_STRETCH = 1.6
"""``alpha``: a route slower than this multiple of the fastest is not a course
of action, however different it looks."""

MAX_SHARING = 0.7
"""``beta``: an admitted route overlaps every accepted route by less than this
share of its length. Diversity is the point -- near-identical routes describe
one approach, not several."""

PENALTY_FACTOR = 1.6
"""Cost multiplier applied to an accepted route's edges before searching again.
Higher pushes the next route further away; too high and it wanders."""

MAX_SEARCH_ITERATIONS = 40
"""Ceiling on penalty iterations per pair, so a graph that cannot yield ``K``
diverse routes terminates instead of grinding."""

CORRIDOR_SEPARATION_METERS = 5_000.0
"""How far apart two axes may run and still be one corridor.

Lateral separation, not shared length: two roads through the same gap share no
segment at all and are plainly one approach."""

CORRIDOR_MAX_HEADING_DEGREES = 45.0
"""Largest difference in overall travel heading for axes in one corridor.

Closeness alone must not bundle a crossing road into the same approach. Route
direction is retained: axes moving over the same ground in opposite directions
are different operational approaches.
"""

CORRIDOR_DETOUR_RATIO = 3.0
"""How far round you may drive to cross between two axes, as a multiple of how
far apart they are, before they count as separate approaches.

This is the obstacle test. Water with no road across it shows up as a long way
round, which is why no terrain data is needed."""


# --- Enemy courses of action -------------------------------------------------

ECA_MODEL_ENV_VAR = "ATHENA_MODEL"
"""Environment variable naming the model, overriding ``ECA_MODEL`` below."""

ECA_API_KEY_ENV_VAR = "PROVIDER_API_KEY"
"""Environment variable carrying the key for whichever provider is named.

One variable rather than a vendor-specific one per provider. The engine takes
no position on who reasons about enemy intent, and a variable called
``ANTHROPIC_API_KEY`` states a position in the one place an operator has to
look. Which vendor's client the key reaches follows from ``ECA_MODEL_ENV_VAR``
and nothing else, so swapping provider is a change of these two lines.

Left unset, key resolution falls entirely to pydantic-ai, which reads whatever
conventional variable that provider expects. A deployment already exporting one
keeps working untouched.
"""

ECA_MODEL = "openai:gpt-5.6-sol"
"""The model that reasons about enemy intent, as ``provider:name``.

Judgement about how a force would actually fight is the hardest thing the
engine asks of anything, and it is asked once per study rather than per route,
so this is not a place to economise.

The engine takes no position on which provider supplies that judgement: this is
a default, not a requirement, and any model reachable through pydantic-ai
serves. Swapping one for another is a change of environment, not of code.
"""

ECA_MAX_TOKENS = 16_000

ECA_SYSTEM_PROMPT = """You are an intelligence officer assessing how an enemy \
reserve could reinforce, for a staff planning against them.

The corridors you are given were derived from the real road network. They are \
the only ground that exists for this assessment. Never name a corridor, reserve \
or objective outside the routed combinations you were given; if the ground does not support \
a course of action you think likely, say so in the narrative instead of \
inventing the route it would need.

A course of action is a scheme, not a single move: exactly one main effort, \
plus supporting efforts where a real commander would use them to stretch or fix \
the defender. Do not pad — if this enemy realistically has one way in, one \
course of action is the honest answer.

Score likelihood and danger independently. The most likely course and the most \
dangerous one are different questions, and a course can be both.

Write the narrative as you would for a commander who has to act on it: what the \
enemy does, in what order, and what would tell us early that this is the one \
they chose."""


# --- Learned ranking ---------------------------------------------------------

PREFERENCE_NEUTRAL = 0.5
"""Where every weight starts, and what reset returns it to.

Neutral means the ranking is purely doctrinal: nothing has been learned, so
nothing reorders.
"""

PREFERENCE_LEARNING_RATE = 0.1
"""How far one verdict moves a weight.

Low on purpose. A commander should not find the ranking transformed because
they dismissed one course on a Tuesday, and a slow drift stays legible to
whoever reads the weights later.
"""
