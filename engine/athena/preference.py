"""What this operator keeps promoting, learned from what they accept.

The engine ranks courses of action doctrinally: most likely and most dangerous.
Those two are the answer a staff school would give, and they are not learnable —
nothing here can move them. What *is* learnable is the order of everything else,
because two commanders reading the same study reasonably attend to different
things: one to speed, another to what can actually be blocked.

Learning is over **features of a course, not the course itself**. A course has no
identity across runs — the model rewrites it every time — but "fast", "blockable"
and "multi-pronged" are properties of the ground and the scheme, and they mean
the same thing next week. That is what makes feedback attachable at all.

The rule is deliberately simple and legible. Accepting a course that scored high
on a feature raises that feature's weight; rejecting it lowers it. An operator
can read the weights, disagree, and reset them.
"""

from enum import StrEnum

from pydantic import BaseModel, Field

from athena.eca import CourseOfAction
from athena.params import PREFERENCE_LEARNING_RATE, PREFERENCE_NEUTRAL
from athena.study import CorridorOut

FEATURE_NAMES = ("speed", "blockable", "complexity", "likelihood", "danger")


class Verdict(StrEnum):
    ACCEPTED = "accepted"
    REJECTED = "rejected"


class Features(BaseModel):
    """What a course looks like, on axes an operator would recognise.

    Every value is 0-1 so one weight vector spans them all, and each is named
    for the thing a commander would say out loud about a course.
    """

    model_config = {"frozen": True}

    speed: float = Field(ge=0.0, le=1.0)
    """How fast the main effort's corridor is, against the fastest in the study."""
    blockable: float = Field(ge=0.0, le=1.0)
    """Share of the corridors used that can be blocked at a single point."""
    complexity: float = Field(ge=0.0, le=1.0)
    """How many efforts the scheme has: a single thrust is 0."""
    likelihood: float = Field(ge=0.0, le=1.0)
    danger: float = Field(ge=0.0, le=1.0)

    def as_tuple(self) -> tuple[float, ...]:
        return tuple(getattr(self, name) for name in FEATURE_NAMES)


class Weights(BaseModel):
    """How much this operator has shown they care about each feature.

    Starts neutral. Kept visible and resettable on purpose: a ranking that
    drifts for reasons nobody can see is worse than no ranking at all.
    """

    speed: float = Field(default=PREFERENCE_NEUTRAL, ge=0.0, le=1.0)
    blockable: float = Field(default=PREFERENCE_NEUTRAL, ge=0.0, le=1.0)
    complexity: float = Field(default=PREFERENCE_NEUTRAL, ge=0.0, le=1.0)
    likelihood: float = Field(default=PREFERENCE_NEUTRAL, ge=0.0, le=1.0)
    danger: float = Field(default=PREFERENCE_NEUTRAL, ge=0.0, le=1.0)

    def as_tuple(self) -> tuple[float, ...]:
        return tuple(getattr(self, name) for name in FEATURE_NAMES)

    def is_neutral(self) -> bool:
        """Nothing has been learned yet, so ranking is purely doctrinal."""
        return all(value == PREFERENCE_NEUTRAL for value in self.as_tuple())


def _clamp(value: float) -> float:
    return min(1.0, max(0.0, value))


def extract_features(
    course: CourseOfAction,
    corridors: list[CorridorOut],
) -> Features:
    """Reads a course's shape off the ground it uses."""
    by_id = {corridor.id: corridor for corridor in corridors}
    used = [by_id[e.corridor_id] for e in course.efforts if e.corridor_id in by_id]

    if used:
        fastest = min(c.fastest_seconds for c in corridors)
        main = next((e for e in course.efforts if e.kind == "main"), None)
        main_corridor = by_id.get(main.corridor_id) if main else None
        # Relative to the quickest approach on this ground, so "fast" means the
        # same thing whether the study spans five minutes or five hours.
        speed = (
            _clamp(fastest / main_corridor.fastest_seconds)
            if main_corridor and main_corridor.fastest_seconds > 0
            else 0.0
        )
        blockable = sum(1 for c in used if c.choke_edge_ids) / len(used)
    else:
        speed = 0.0
        blockable = 0.0

    # Three or more efforts is as complex as this scale distinguishes; beyond
    # that the difference stops being one a commander would act on.
    complexity = _clamp((len(course.efforts) - 1) / 2)

    return Features(
        speed=speed,
        blockable=blockable,
        complexity=complexity,
        likelihood=course.likelihood,
        danger=course.danger,
    )


def update_weights(
    weights: Weights,
    features: Features,
    verdict: Verdict,
    rate: float = PREFERENCE_LEARNING_RATE,
) -> Weights:
    """Moves each weight toward or away from what the judged course looked like.

    A feature above the neutral mark is one the course was strong on. Accepting
    such a course raises its weight; rejecting it lowers it. A course that was
    unremarkable on a feature barely moves that weight at all, which is what
    stops every verdict from dragging the whole vector.
    """
    direction = 1.0 if verdict is Verdict.ACCEPTED else -1.0
    updated = {
        name: _clamp(weight + direction * rate * (feature - PREFERENCE_NEUTRAL))
        for name, weight, feature in zip(
            FEATURE_NAMES, weights.as_tuple(), features.as_tuple()
        )
    }
    return Weights(**updated)


def relevance(features: Features, weights: Weights) -> float:
    """How well a course matches what this operator keeps choosing.

    Neutral weights give every course the same score, so before any feedback the
    order is exactly the doctrinal one.
    """
    total = sum(weights.as_tuple())
    if total <= 0:
        return 0.0
    paired = zip(features.as_tuple(), weights.as_tuple())
    return sum(feature * weight for feature, weight in paired) / total


def order_by_relevance(
    courses: list[CourseOfAction],
    corridors: list[CorridorOut],
    weights: Weights,
) -> list[CourseOfAction]:
    """Reorders the list an operator reads.

    This never touches the doctrinal pair. Most likely and most dangerous are
    selected from the model's scores and stay whatever they were; learning only
    decides which of the remaining courses a commander sees first.
    """
    if weights.is_neutral():
        return list(courses)
    scored = [
        (relevance(extract_features(course, corridors), weights), course.name, course)
        for course in courses
    ]
    # Ties break on name, so the same weights always give the same order.
    scored.sort(key=lambda entry: (-entry[0], entry[1]))
    return [course for _, _, course in scored]
