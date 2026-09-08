"""Which forces a commander can put on which approach."""

from athena.blocking import plan_blocks
from athena.graph import Edge, RoadGraph
from athena.orbat import Availability, Orbat, Unit
from athena.study import CorridorOut, RouteOut
from athena.units import Echelon

from .conftest import node


def unit(
    unit_id: str,
    echelon: Echelon,
    lon: float,
    parent_id: str | None = None,
    availability: Availability = Availability.UNCOMMITTED,
) -> Unit:
    return Unit(
        unit_id=unit_id,
        name=unit_id,
        echelon=echelon,
        parent_id=parent_id,
        lon=lon,
        lat=0.0,
        strength=7,
        availability=availability,
    )


def corridor(corridor_id: str, choke: list[str], seconds: float = 600.0) -> CorridorOut:
    return CorridorOut(
        id=corridor_id,
        routes=[
            RouteOut(
                reserve_id="res1",
                objective_id="obj1",
                edge_ids=choke or ["e-none"],
                node_ids=[],
                seconds=seconds,
                length_meters=1000.0,
            )
        ],
        choke_edge_ids=choke,
        fastest_seconds=seconds,
    )


def choke_edge(edge_id: str, a: int, b: int, lon: float) -> Edge:
    """An edge with real geometry, so distance to it is meaningful."""
    return Edge.model_validate(
        {
            "id": edge_id,
            "wayId": a,
            "from": a,
            "to": b,
            "roadClass": "secondary",
            "nodes": [a, b],
            "points": [[lon, 0.0], [lon + 0.01, 0.0]],
            "lengthMeters": 1000.0,
        }
    )


def graph_with_chokes() -> RoadGraph:
    """Two choke edges: one near lon 0, one near lon 10."""
    return RoadGraph(
        nodes=(node(1, 0), node(2, 1), node(3, 10), node(4, 11)),
        edges=(
            choke_edge("11:0", 1, 2, 0.0),
            choke_edge("22:0", 3, 4, 10.0),
        ),
    )


GRAPH = graph_with_chokes()
WEST = corridor("cor_west", ["11:0"], seconds=300)
EAST = corridor("cor_east", ["22:0"], seconds=900)


# Candidates


def test_offers_every_available_unit_against_a_corridor() -> None:
    orbat = Orbat(units=(unit("a", Echelon.SECTION, 0), unit("b", Echelon.SECTION, 10)))

    plan = plan_blocks(GRAPH, [WEST], orbat, ceiling=Echelon.SECTION)

    assert [c.unit_id for c in plan.corridors[0].candidates] == ["a", "b"]


def test_candidates_are_ordered_by_distance_to_the_choke_point() -> None:
    orbat = Orbat(units=(unit("far", Echelon.SECTION, 10), unit("near", Echelon.SECTION, 0)))

    plan = plan_blocks(GRAPH, [WEST], orbat, ceiling=Echelon.SECTION)

    assert [c.unit_id for c in plan.corridors[0].candidates] == ["near", "far"]


def test_a_committed_unit_is_never_offered() -> None:
    orbat = Orbat(
        units=(
            unit("free", Echelon.SECTION, 0),
            unit("busy", Echelon.SECTION, 0, availability=Availability.COMMITTED),
        )
    )

    plan = plan_blocks(GRAPH, [WEST], orbat, ceiling=Echelon.SECTION)

    assert [c.unit_id for c in plan.corridors[0].candidates] == ["free"]


def test_the_ceiling_keeps_a_larger_formation_out() -> None:
    orbat = Orbat(
        units=(unit("coy", Echelon.COMPANY, 0), unit("sec", Echelon.SECTION, 0)),
    )

    plan = plan_blocks(GRAPH, [WEST], orbat, ceiling=Echelon.SECTION)

    assert [c.unit_id for c in plan.corridors[0].candidates] == ["sec"]


# Corridors that cannot be blocked


def test_a_corridor_with_no_choke_point_cannot_be_blocked() -> None:
    """Its routes share no ground, so there is nowhere to stand."""
    diffuse = corridor("cor_diffuse", [])
    orbat = Orbat(units=(unit("a", Echelon.SECTION, 0),))

    plan = plan_blocks(GRAPH, [diffuse], orbat, ceiling=Echelon.SECTION)

    assert plan.corridors == []
    assert len(plan.unblockable) == 1
    assert "choke" in plan.unblockable[0].reason


def test_a_corridor_with_no_force_left_is_reported_not_omitted() -> None:
    """'Nothing can cover this' is the finding an S3 most needs to see."""
    orbat = Orbat(units=(unit("coy", Echelon.COMPANY, 0),))

    plan = plan_blocks(GRAPH, [WEST], orbat, ceiling=Echelon.SECTION)

    assert len(plan.unblockable) == 1
    assert plan.unblockable[0].corridor_id == "cor_west"


def test_a_choke_point_missing_from_the_graph_is_reported() -> None:
    stale = corridor("cor_stale", ["gone:0"])
    orbat = Orbat(units=(unit("a", Echelon.SECTION, 0),))

    plan = plan_blocks(GRAPH, [stale], orbat, ceiling=Echelon.SECTION)

    assert len(plan.unblockable) == 1


# Allocation


def test_no_unit_is_allocated_to_two_corridors() -> None:
    orbat = Orbat(units=(unit("only", Echelon.SECTION, 0),))

    plan = plan_blocks(GRAPH, [WEST, EAST], orbat, ceiling=Echelon.SECTION)

    assert [a.unit_id for a in plan.allocation] == ["only"]
    assert len(plan.allocation) == 1


def test_the_quickest_approach_is_covered_first() -> None:
    """Fastest corridor is the most urgent, so it gets the scarce force."""
    orbat = Orbat(units=(unit("only", Echelon.SECTION, 10),))

    plan = plan_blocks(GRAPH, [EAST, WEST], orbat, ceiling=Echelon.SECTION)

    assert plan.allocation[0].corridor_id == "cor_west"


def test_each_corridor_takes_the_nearest_force_still_free() -> None:
    orbat = Orbat(units=(unit("w", Echelon.SECTION, 0), unit("e", Echelon.SECTION, 10)))

    plan = plan_blocks(GRAPH, [WEST, EAST], orbat, ceiling=Echelon.SECTION)

    assigned = {a.corridor_id: a.unit_id for a in plan.allocation}
    assert assigned == {"cor_west": "w", "cor_east": "e"}


def test_allocating_a_section_spends_the_platoon_above_it() -> None:
    """The same men must not be committed twice under two names."""
    orbat = Orbat(
        units=(
            unit("pl1", Echelon.PLATOON, 0),
            unit("sec1", Echelon.SECTION, 0, parent_id="pl1"),
        )
    )

    plan = plan_blocks(GRAPH, [WEST, EAST], orbat, ceiling=Echelon.PLATOON)

    assert len(plan.allocation) == 1
    assert [u.corridor_id for u in plan.uncovered] == ["cor_east"]


def test_a_corridor_left_uncovered_is_named() -> None:
    orbat = Orbat(units=(unit("only", Echelon.SECTION, 0),))

    plan = plan_blocks(GRAPH, [WEST, EAST], orbat, ceiling=Echelon.SECTION)

    assert [u.corridor_id for u in plan.uncovered] == ["cor_east"]


def test_nothing_is_uncovered_when_every_corridor_is_allocated() -> None:
    orbat = Orbat(units=(unit("w", Echelon.SECTION, 0), unit("e", Echelon.SECTION, 10)))

    plan = plan_blocks(GRAPH, [WEST, EAST], orbat, ceiling=Echelon.SECTION)

    assert plan.uncovered == []


def test_is_deterministic() -> None:
    orbat = Orbat(units=(unit("w", Echelon.SECTION, 0), unit("e", Echelon.SECTION, 10)))

    first = plan_blocks(GRAPH, [WEST, EAST], orbat, ceiling=Echelon.SECTION)
    second = plan_blocks(GRAPH, [WEST, EAST], orbat, ceiling=Echelon.SECTION)

    assert first == second


def test_an_empty_orbat_covers_nothing_and_says_so() -> None:
    plan = plan_blocks(GRAPH, [WEST], Orbat(units=()), ceiling=Echelon.COMPANY)

    assert plan.allocation == []
    assert len(plan.unblockable) == 1
