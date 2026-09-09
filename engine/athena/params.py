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

CORRIDOR_SIMILARITY = 0.4
"""Routes sharing at least this fraction of their length belong to one
corridor. The single knob deciding how coarse a corridor is."""


# --- Enemy courses of action -------------------------------------------------

ECA_MODEL = "claude-opus-5"
"""The model that reasons about enemy intent.

Judgement about how a force would actually fight is the hardest thing the
engine asks of anything, and it is asked once per study rather than per route,
so this is not a place to economise.
"""

ECA_MAX_TOKENS = 16_000

ECA_SYSTEM_PROMPT = """You are an intelligence officer assessing how an enemy \
reserve could reinforce, for a staff planning against them.

The corridors you are given were derived from the real road network. They are \
the only ground that exists for this assessment. Never name a corridor or a \
reserve that is not in the list you were given; if the ground does not support \
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
