"""Enemy courses of action, reasoned over corridors that actually exist.

This is the first place a model enters the engine, and the boundary is drawn on
purpose. The model supplies judgement — which approaches an enemy with this
intent would actually use, and how they would combine — while the corridors, the
routes and the ground remain the deterministic output of the route substrate.

Two rules make an end-to-end agent acceptable here:

1. **It can only reference ground that exists.** Every effort names a corridor
   id from the study. An id the model invents is rejected and reported, never
   quietly rendered as a real approach.
2. **It does not decide the ranking.** It scores each course of action; the
   doctrinal pair — most likely and most dangerous — is selected in code from
   those scores.
"""

import json
from typing import Literal, Protocol

from pydantic import BaseModel, Field

from athena.intent import EnemyIntent
from athena.params import ECA_MAX_TOKENS, ECA_MODEL, ECA_SYSTEM_PROMPT
from athena.study import CorridorOut, Mark


class Effort(BaseModel):
    """One part of a scheme: a force moving along one corridor."""

    kind: Literal["main", "supporting"]
    corridor_id: str
    reserve_id: str
    rationale: str = Field(max_length=400)


class CourseOfAction(BaseModel):
    """A way the enemy could reinforce, as a scheme rather than a single route.

    A real attack has a main effort and things done to stretch the defender, so
    an ECA that is only ever one corridor would describe a simpler enemy than
    the one being planned against.
    """

    name: str = Field(max_length=80)
    narrative: str = Field(max_length=1200)
    efforts: list[Effort]
    likelihood: float = Field(ge=0.0, le=1.0)
    """How probable this is given the stated intent."""
    danger: float = Field(ge=0.0, le=1.0)
    """How much it costs us if it happens, regardless of probability."""


class DraftCourses(BaseModel):
    """What the model returns, before anything has been checked."""

    courses: list[CourseOfAction]


class RejectedReference(BaseModel):
    """Ground the model named that the study does not contain.

    Surfaced rather than swallowed. A model inventing a corridor is the failure
    this design exists to catch, and hiding it would remove the only evidence
    that it happened.
    """

    course_name: str
    corridor_id: str | None = None
    reserve_id: str | None = None
    reason: str


class RankedCourses(BaseModel):
    """The staff answer: every valid course, plus the doctrinal pair."""

    courses: list[CourseOfAction]
    most_likely: CourseOfAction | None = None
    most_dangerous: CourseOfAction | None = None
    rejected: list[RejectedReference] = Field(default_factory=list)


class CourseGenerator(Protocol):
    """The model call, narrow enough to substitute in tests."""

    def __call__(self, system: str, prompt: str) -> DraftCourses: ...


def describe_corridors(corridors: list[CorridorOut], reserves: list[Mark]) -> str:
    """The ground, as the model is allowed to see it.

    Only what a course of action can be built from: which corridor, whose
    reserve, how long, and whether it can be blocked at one point. Route
    geometry is withheld — it would fill the context without changing any
    judgement the model is being asked for.
    """
    names = {mark.id: mark.name for mark in reserves}
    lines: list[str] = []
    for corridor in corridors:
        serving = sorted({route.reserve_id for route in corridor.routes})
        described = ", ".join(f"{names.get(r, r)} ({r})" for r in serving)
        choke = (
            f"{len(corridor.choke_edge_ids)} segment(s)"
            if corridor.choke_edge_ids
            else "none — cannot be blocked at a single point"
        )
        lines.append(
            f"- {corridor.id}: {round(corridor.fastest_seconds / 60)} min by the "
            f"fastest of {len(corridor.routes)} route(s). "
            f"Reserves able to use it: {described}. Choke point: {choke}."
        )
    return "\n".join(lines)


def build_prompt(
    corridors: list[CorridorOut],
    reserves: list[Mark],
    objectives: list[Mark],
    intent: EnemyIntent,
) -> str:
    """Everything the model is given. Pure, so it can be asserted on."""
    objective_lines = "\n".join(f"- {m.id}: {m.name}" for m in objectives)
    wanted = (
        ", ".join(intent.objective_ids)
        if intent.objective_ids
        else "not stated — treat every objective as in play"
    )
    narrative = intent.narrative.strip() or "(none given)"

    return (
        "## Corridors found on this ground\n"
        f"{describe_corridors(corridors, reserves)}\n\n"
        "## Objectives\n"
        f"{objective_lines}\n\n"
        "## Enemy intent\n"
        f"Posture: {intent.posture}\n"
        f"Objectives believed sought: {wanted}\n"
        f"Assessment from the S2:\n{narrative}\n\n"
        "## Task\n"
        "Give the courses of action this enemy could realistically take. Each is "
        "a scheme: exactly one main effort, plus any supporting efforts that "
        "stretch or fix the defender. Every effort must name a corridor id and a "
        "reserve id from the lists above — do not invent either. Score each "
        "course on likelihood given the stated intent, and on danger to us if it "
        "happens, independently."
    )


def ground_courses(
    draft: DraftCourses,
    corridors: list[CorridorOut],
    reserves: list[Mark],
) -> tuple[list[CourseOfAction], list[RejectedReference]]:
    """Keeps only courses whose every effort names ground that exists.

    A course is dropped whole rather than repaired: an effort removed from a
    scheme leaves a scheme the model did not propose and nobody has judged.
    """
    known_corridors = {corridor.id for corridor in corridors}
    known_reserves = {mark.id for mark in reserves}

    accepted: list[CourseOfAction] = []
    rejected: list[RejectedReference] = []

    for course in draft.courses:
        problems: list[RejectedReference] = []
        for effort in course.efforts:
            if effort.corridor_id not in known_corridors:
                problems.append(
                    RejectedReference(
                        course_name=course.name,
                        corridor_id=effort.corridor_id,
                        reason="no such corridor in this study",
                    )
                )
            if effort.reserve_id not in known_reserves:
                problems.append(
                    RejectedReference(
                        course_name=course.name,
                        reserve_id=effort.reserve_id,
                        reason="no such enemy reserve in this study",
                    )
                )

        if not course.efforts:
            problems.append(
                RejectedReference(
                    course_name=course.name,
                    reason="a course of action with no effort describes nothing",
                )
            )
        elif sum(1 for e in course.efforts if e.kind == "main") != 1:
            problems.append(
                RejectedReference(
                    course_name=course.name,
                    reason="a scheme has exactly one main effort",
                )
            )

        if problems:
            rejected.extend(problems)
        else:
            accepted.append(course)

    return accepted, rejected


def rank_courses(courses: list[CourseOfAction]) -> tuple[CourseOfAction | None, ...]:
    """The doctrinal pair, chosen in code rather than by the model.

    Most likely and most dangerous are different questions and may well be the
    same course; when they are, that is itself the finding. Ties break on name
    so the same scores always name the same course.
    """
    if not courses:
        return None, None
    most_likely = max(courses, key=lambda c: (c.likelihood, c.name))
    most_dangerous = max(courses, key=lambda c: (c.danger, c.name))
    return most_likely, most_dangerous


def generate_courses(
    corridors: list[CorridorOut],
    reserves: list[Mark],
    objectives: list[Mark],
    intent: EnemyIntent,
    generator: CourseGenerator,
    weights: "Weights | None" = None,
) -> RankedCourses:
    """Ask the model, check what it said, then rank it."""
    if not corridors:
        # Nothing to reason over. Asking anyway invites the model to fill the
        # silence, which is exactly the failure the grounding check exists for.
        return RankedCourses(courses=[])

    prompt = build_prompt(corridors, reserves, objectives, intent)
    draft = generator(system=ECA_SYSTEM_PROMPT, prompt=prompt)
    accepted, rejected = ground_courses(draft, corridors, reserves)
    # The doctrinal pair is chosen before any learned weighting touches the
    # list. Most likely and most dangerous are not preferences to be learned
    # away.
    most_likely, most_dangerous = rank_courses(accepted)

    ordered = sorted(accepted, key=lambda c: (-c.likelihood, c.name))
    if weights is not None:
        from athena.preference import order_by_relevance

        ordered = order_by_relevance(ordered, corridors, weights)

    return RankedCourses(
        courses=ordered,
        most_likely=most_likely,
        most_dangerous=most_dangerous,
        rejected=rejected,
    )


class RefusedError(RuntimeError):
    """The model declined to answer.

    Its own error, because a refusal must never reach an operator as an empty
    list of courses. 'The enemy has no options' and 'we did not get an answer'
    are opposite findings.
    """


def anthropic_generator(client: object | None = None) -> CourseGenerator:
    """The real model call.

    Structured output is used rather than server-side refusal fallbacks: the two
    do not compose cleanly on this endpoint, and for this product a decline
    should surface loudly rather than be quietly re-run on another model.
    """

    def generate(system: str, prompt: str) -> DraftCourses:
        import anthropic

        api = client or anthropic.Anthropic()
        response = api.messages.parse(
            model=ECA_MODEL,
            max_tokens=ECA_MAX_TOKENS,
            thinking={"type": "adaptive"},
            system=system,
            messages=[{"role": "user", "content": prompt}],
            output_format=DraftCourses,
        )
        if response.stop_reason == "refusal":
            raise RefusedError(
                "the model declined to assess this intent: "
                f"{getattr(response.stop_details, 'explanation', 'no explanation given')}"
            )
        parsed = response.parsed_output
        if parsed is None:
            raise RefusedError("the model returned no parsable courses of action")
        return parsed

    return generate


def parse_draft(payload: str) -> DraftCourses:
    """For replaying a recorded model response in tests and fixtures."""
    return DraftCourses.model_validate(json.loads(payload))
