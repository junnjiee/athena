"""Enemy courses of action: what the model is given, and what it is allowed back."""

import pytest
from pydantic_ai.messages import ModelResponse, TextPart
from pydantic_ai.models.function import FunctionModel
from pydantic_ai.models.test import TestModel

from athena.eca import (
    CourseOfAction,
    DraftCourses,
    Effort,
    RefusedError,
    build_prompt,
    describe_corridors,
    generate_courses,
    ground_courses,
    model_generator,
    rank_courses,
)
from athena.intent import EnemyIntent, Posture
from athena.study import CorridorOut, Mark, RouteOut


def route(reserve: str = "res1", objective: str = "obj1") -> RouteOut:
    return RouteOut(
        reserve_id=reserve,
        objective_id=objective,
        edge_ids=["e1"],
        node_ids=[1, 2],
        seconds=600.0,
        length_meters=1000.0,
    )


def corridor(corridor_id: str, choke: list[str] | None = None, seconds: float = 600.0) -> CorridorOut:
    return CorridorOut(
        id=corridor_id,
        routes=[route()],
        choke_edge_ids=choke if choke is not None else ["e1"],
        fastest_seconds=seconds,
    )


def effort(corridor_id: str = "cor_a", reserve: str = "res1", kind: str = "main") -> Effort:
    return Effort(kind=kind, corridor_id=corridor_id, reserve_id=reserve, rationale="because")


def course(
    name: str = "Northern push",
    efforts: list[Effort] | None = None,
    likelihood: float = 0.5,
    danger: float = 0.5,
) -> CourseOfAction:
    return CourseOfAction(
        name=name,
        narrative="They come north.",
        efforts=efforts if efforts is not None else [effort()],
        likelihood=likelihood,
        danger=danger,
    )


CORRIDORS = [corridor("cor_a"), corridor("cor_b", choke=[], seconds=1200)]
RESERVES = [Mark(id="res1", name="Depot", lon=0, lat=0)]
OBJECTIVES = [Mark(id="obj1", name="Bridge", lon=1, lat=0)]


# What the model is shown


def test_corridors_are_described_by_id_time_and_choke() -> None:
    described = describe_corridors(CORRIDORS, RESERVES)

    assert "cor_a" in described
    assert "10 min" in described
    assert "Depot (res1)" in described


def test_a_corridor_with_no_choke_point_says_so() -> None:
    """The model should not propose blocking ground that cannot be blocked."""
    assert "cannot be blocked at a single point" in describe_corridors(CORRIDORS, RESERVES)


def test_route_geometry_is_withheld() -> None:
    # It would fill the context without changing any judgement being asked for.
    described = describe_corridors(CORRIDORS, RESERVES)

    assert "e1" not in described
    assert "node" not in described.lower()


def test_the_prompt_carries_the_intent_narrative_unedited() -> None:
    intent = EnemyIntent(posture=Posture.ATTACKING, narrative="They want the bridge by dawn.")

    prompt = build_prompt(CORRIDORS, RESERVES, OBJECTIVES, intent)

    assert "They want the bridge by dawn." in prompt
    assert "attacking" in prompt


def test_unstated_objectives_are_declared_in_play_rather_than_omitted() -> None:
    prompt = build_prompt(CORRIDORS, RESERVES, OBJECTIVES, EnemyIntent())

    assert "every objective as in play" in prompt


def test_the_prompt_forbids_inventing_ground() -> None:
    prompt = build_prompt(CORRIDORS, RESERVES, OBJECTIVES, EnemyIntent())

    assert "do not invent" in prompt.lower()


# Grounding — what the model is allowed back


def test_a_course_over_real_ground_is_kept() -> None:
    accepted, rejected = ground_courses(DraftCourses(courses=[course()]), CORRIDORS, RESERVES)

    assert len(accepted) == 1
    assert rejected == []


def test_an_invented_corridor_is_rejected_and_reported() -> None:
    """The failure this whole design exists to catch."""
    invented = course(efforts=[effort(corridor_id="cor_imaginary")])

    accepted, rejected = ground_courses(DraftCourses(courses=[invented]), CORRIDORS, RESERVES)

    assert accepted == []
    assert rejected[0].corridor_id == "cor_imaginary"
    assert "no such corridor" in rejected[0].reason


def test_an_invented_reserve_is_rejected() -> None:
    invented = course(efforts=[effort(reserve="res_ghost")])

    accepted, rejected = ground_courses(DraftCourses(courses=[invented]), CORRIDORS, RESERVES)

    assert accepted == []
    assert rejected[0].reserve_id == "res_ghost"


def test_a_bad_effort_drops_the_whole_course() -> None:
    """Removing one effort leaves a scheme nobody proposed and nobody judged."""
    mixed = course(efforts=[effort(), effort(corridor_id="cor_ghost", kind="supporting")])

    accepted, _ = ground_courses(DraftCourses(courses=[mixed]), CORRIDORS, RESERVES)

    assert accepted == []


def test_a_course_with_no_effort_is_rejected() -> None:
    accepted, rejected = ground_courses(
        DraftCourses(courses=[course(efforts=[])]), CORRIDORS, RESERVES
    )

    assert accepted == []
    assert "describes nothing" in rejected[0].reason


def test_a_scheme_needs_exactly_one_main_effort() -> None:
    two_mains = course(efforts=[effort(), effort(corridor_id="cor_b")])
    none_main = course(efforts=[effort(kind="supporting")])

    for bad in (two_mains, none_main):
        accepted, rejected = ground_courses(DraftCourses(courses=[bad]), CORRIDORS, RESERVES)
        assert accepted == []
        assert any("one main effort" in r.reason for r in rejected)


def test_a_good_course_survives_alongside_a_bad_one() -> None:
    good = course(name="Real")
    bad = course(name="Invented", efforts=[effort(corridor_id="cor_ghost")])

    accepted, rejected = ground_courses(DraftCourses(courses=[good, bad]), CORRIDORS, RESERVES)

    assert [c.name for c in accepted] == ["Real"]
    assert rejected[0].course_name == "Invented"


# Ranking — decided in code, not by the model


def test_the_pair_is_selected_from_the_scores() -> None:
    likely = course(name="Likely", likelihood=0.9, danger=0.1)
    dangerous = course(name="Dangerous", likelihood=0.1, danger=0.9)

    most_likely, most_dangerous = rank_courses([likely, dangerous])

    assert most_likely.name == "Likely"
    assert most_dangerous.name == "Dangerous"


def test_one_course_can_be_both() -> None:
    """When they coincide, that is the finding rather than a problem."""
    only = course(name="Only", likelihood=0.9, danger=0.9)

    most_likely, most_dangerous = rank_courses([only])

    assert most_likely.name == most_dangerous.name == "Only"


def test_no_courses_means_no_pair() -> None:
    assert rank_courses([]) == (None, None)


def test_ranking_is_deterministic_on_a_tie() -> None:
    a = course(name="Alpha", likelihood=0.5, danger=0.5)
    b = course(name="Bravo", likelihood=0.5, danger=0.5)

    assert rank_courses([a, b])[0].name == rank_courses([b, a])[0].name


# End to end, with the model stubbed


def test_generates_ranks_and_reports_in_one_pass() -> None:
    def generator(system: str, prompt: str) -> DraftCourses:
        assert "cor_a" in prompt
        return DraftCourses(
            courses=[
                course(name="Real", likelihood=0.8, danger=0.2),
                course(name="Invented", efforts=[effort(corridor_id="cor_ghost")]),
            ]
        )

    ranked = generate_courses(CORRIDORS, RESERVES, OBJECTIVES, EnemyIntent(), generator)

    assert [c.name for c in ranked.courses] == ["Real"]
    assert ranked.most_likely.name == "Real"
    assert ranked.rejected[0].course_name == "Invented"


def test_courses_come_back_most_likely_first() -> None:
    def generator(system: str, prompt: str) -> DraftCourses:
        return DraftCourses(
            courses=[
                course(name="Unlikely", likelihood=0.2),
                course(name="Probable", likelihood=0.9),
            ]
        )

    ranked = generate_courses(CORRIDORS, RESERVES, OBJECTIVES, EnemyIntent(), generator)

    assert [c.name for c in ranked.courses] == ["Probable", "Unlikely"]


def test_no_corridors_means_the_model_is_never_asked() -> None:
    """With no ground, a model would fill the silence — which is the failure
    the grounding check exists to catch. Cheaper not to ask."""

    def generator(system: str, prompt: str) -> DraftCourses:
        raise AssertionError("should not be called")

    ranked = generate_courses([], RESERVES, OBJECTIVES, EnemyIntent(), generator)

    assert ranked.courses == []
    assert ranked.most_likely is None


def test_an_empty_intent_is_recognisable() -> None:
    assert EnemyIntent().is_empty()
    assert not EnemyIntent(posture=Posture.ATTACKING).is_empty()
    assert not EnemyIntent(narrative="They want the bridge.").is_empty()


# --- The model call itself ---------------------------------------------------
#
# Driven through pydantic-ai's own test models, so the engine's one model call
# is exercised without naming a provider or touching a network.


def test_generator_returns_the_structured_courses() -> None:
    generate = model_generator(TestModel())
    draft = generate(system="assess", prompt="the ground")
    assert isinstance(draft, DraftCourses)


def test_output_that_is_not_an_assessment_is_a_refusal() -> None:
    """A decline, a truncation and prose are one case: no courses came back."""

    def declines(messages: object, info: object) -> ModelResponse:
        return ModelResponse(parts=[TextPart("I will not assess this.")])

    generate = model_generator(FunctionModel(declines))
    with pytest.raises(RefusedError):
        generate(system="assess", prompt="the ground")
