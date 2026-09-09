"""What the operator keeps choosing, and how far one verdict moves it."""

from athena.eca import CourseOfAction, Effort
from athena.preference import (
    Features,
    Verdict,
    Weights,
    extract_features,
    order_by_relevance,
    relevance,
    update_weights,
)
from athena.study import CorridorOut, RouteOut


def route(reserve: str = "res1") -> RouteOut:
    return RouteOut(
        reserve_id=reserve,
        objective_id="obj1",
        edge_ids=["e1"],
        node_ids=[1, 2],
        seconds=600.0,
        length_meters=1000.0,
    )


def corridor(cid: str, seconds: float = 600.0, choke: list[str] | None = None) -> CorridorOut:
    return CorridorOut(
        id=cid,
        routes=[route()],
        choke_edge_ids=choke if choke is not None else ["e1"],
        fastest_seconds=seconds,
    )


def course(
    name: str = "Push",
    corridor_ids: list[str] | None = None,
    likelihood: float = 0.5,
    danger: float = 0.5,
) -> CourseOfAction:
    ids = corridor_ids if corridor_ids is not None else ["fast"]
    efforts = [
        Effort(
            kind="main" if i == 0 else "supporting",
            corridor_id=cid,
            reserve_id="res1",
            rationale="-",
        )
        for i, cid in enumerate(ids)
    ]
    return CourseOfAction(
        name=name, narrative="-", efforts=efforts, likelihood=likelihood, danger=danger
    )


FAST = corridor("fast", seconds=300)
SLOW = corridor("slow", seconds=1200)
OPEN = corridor("open", seconds=600, choke=[])
CORRIDORS = [FAST, SLOW, OPEN]


# Features


def test_the_fastest_corridor_scores_full_speed() -> None:
    assert extract_features(course(corridor_ids=["fast"]), CORRIDORS).speed == 1.0


def test_a_slower_corridor_scores_lower() -> None:
    fast = extract_features(course(corridor_ids=["fast"]), CORRIDORS).speed
    slow = extract_features(course(corridor_ids=["slow"]), CORRIDORS).speed

    assert slow < fast


def test_speed_is_relative_so_it_means_the_same_on_any_ground() -> None:
    """A five-minute study and a five-hour one both have a fastest approach."""
    long_ground = [corridor("a", seconds=36_000), corridor("b", seconds=72_000)]

    assert extract_features(course(corridor_ids=["a"]), long_ground).speed == 1.0


def test_blockability_is_the_share_of_corridors_with_a_choke_point() -> None:
    both = extract_features(course(corridor_ids=["fast", "open"]), CORRIDORS)
    neither = extract_features(course(corridor_ids=["open"]), CORRIDORS)

    assert both.blockable == 0.5
    assert neither.blockable == 0.0


def test_a_single_thrust_has_no_complexity() -> None:
    assert extract_features(course(corridor_ids=["fast"]), CORRIDORS).complexity == 0.0


def test_more_efforts_are_more_complex_up_to_a_point() -> None:
    two = extract_features(course(corridor_ids=["fast", "slow"]), CORRIDORS)
    four = extract_features(course(corridor_ids=["fast", "slow", "open", "fast"]), CORRIDORS)

    assert two.complexity == 0.5
    assert four.complexity == 1.0


def test_the_models_own_scores_pass_through() -> None:
    features = extract_features(course(likelihood=0.9, danger=0.2), CORRIDORS)

    assert features.likelihood == 0.9
    assert features.danger == 0.2


def test_a_course_over_unknown_ground_scores_zero_rather_than_crashing() -> None:
    features = extract_features(course(corridor_ids=["ghost"]), CORRIDORS)

    assert features.speed == 0.0
    assert features.blockable == 0.0


# Learning


def test_weights_start_neutral_so_nothing_reorders() -> None:
    assert Weights().is_neutral()


def test_accepting_a_fast_course_raises_the_weight_on_speed() -> None:
    features = Features(speed=1.0, blockable=0.5, complexity=0.5, likelihood=0.5, danger=0.5)

    updated = update_weights(Weights(), features, Verdict.ACCEPTED)

    assert updated.speed > 0.5


def test_rejecting_the_same_course_lowers_it() -> None:
    features = Features(speed=1.0, blockable=0.5, complexity=0.5, likelihood=0.5, danger=0.5)

    updated = update_weights(Weights(), features, Verdict.REJECTED)

    assert updated.speed < 0.5


def test_a_feature_the_course_was_unremarkable_on_barely_moves() -> None:
    """Otherwise every verdict drags the whole vector."""
    features = Features(speed=1.0, blockable=0.5, complexity=0.5, likelihood=0.5, danger=0.5)

    updated = update_weights(Weights(), features, Verdict.ACCEPTED)

    assert updated.blockable == 0.5


def test_one_verdict_moves_a_weight_only_slightly() -> None:
    """A commander should not find the ranking transformed by one dismissal."""
    features = Features(speed=1.0, blockable=1.0, complexity=1.0, likelihood=1.0, danger=1.0)

    updated = update_weights(Weights(), features, Verdict.ACCEPTED)

    assert updated.speed <= 0.6


def test_weights_never_leave_the_scale() -> None:
    features = Features(speed=1.0, blockable=1.0, complexity=1.0, likelihood=1.0, danger=1.0)
    weights = Weights()
    for _ in range(200):
        weights = update_weights(weights, features, Verdict.ACCEPTED)
    assert weights.speed <= 1.0

    for _ in range(500):
        weights = update_weights(weights, features, Verdict.REJECTED)
    assert weights.speed >= 0.0


def test_accepting_then_rejecting_the_same_course_returns_near_neutral() -> None:
    features = Features(speed=1.0, blockable=0.5, complexity=0.5, likelihood=0.5, danger=0.5)

    once = update_weights(Weights(), features, Verdict.ACCEPTED)
    back = update_weights(once, features, Verdict.REJECTED)

    assert abs(back.speed - 0.5) < 1e-9


# Ordering


def test_neutral_weights_leave_the_doctrinal_order_untouched() -> None:
    given = [course(name="B"), course(name="A")]

    assert [c.name for c in order_by_relevance(given, CORRIDORS, Weights())] == ["B", "A"]


def test_a_learned_taste_for_speed_promotes_the_faster_course() -> None:
    slow = course(name="Slow", corridor_ids=["slow"])
    fast = course(name="Fast", corridor_ids=["fast"])
    speed_lover = Weights(speed=1.0, blockable=0.0, complexity=0.0, likelihood=0.0, danger=0.0)

    ordered = order_by_relevance([slow, fast], CORRIDORS, speed_lover)

    assert [c.name for c in ordered] == ["Fast", "Slow"]


def test_a_taste_for_blockable_ground_promotes_a_different_course() -> None:
    open_ground = course(name="Open", corridor_ids=["open"])
    chokeable = course(name="Chokeable", corridor_ids=["slow"])
    blocker = Weights(speed=0.0, blockable=1.0, complexity=0.0, likelihood=0.0, danger=0.0)

    ordered = order_by_relevance([open_ground, chokeable], CORRIDORS, blocker)

    assert [c.name for c in ordered] == ["Chokeable", "Open"]


def test_ordering_is_deterministic_on_a_tie() -> None:
    a = course(name="Alpha")
    b = course(name="Bravo")
    weights = Weights(speed=1.0)

    assert [c.name for c in order_by_relevance([a, b], CORRIDORS, weights)] == [
        c.name for c in order_by_relevance([b, a], CORRIDORS, weights)
    ]


def test_relevance_is_zero_when_nothing_is_weighted() -> None:
    nothing = Weights(speed=0.0, blockable=0.0, complexity=0.0, likelihood=0.0, danger=0.0)
    features = Features(speed=1.0, blockable=1.0, complexity=1.0, likelihood=1.0, danger=1.0)

    assert relevance(features, nothing) == 0.0
