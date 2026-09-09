"""Which forces a commander can put on which approach."""

from athena.blocking import plan_blocks
from athena.graph import Edge, RoadGraph
from athena.orbat import Availability, Orbat, Unit, WeaponHolding, WeaponSystem
from athena.study import CorridorOut, RouteOut
from athena.units import Echelon

from .conftest import node


def unit(
    unit_id: str,
    echelon: Echelon,
    lon: float,
    parent_id: str | None = None,
    availability: Availability = Availability.UNCOMMITTED,
    weapons: tuple[WeaponHolding, ...] = (),
) -> Unit:
    return Unit(
        unit_id=unit_id,
        name=unit_id,
        echelon=echelon,
        parent_id=parent_id,
        lon=lon,
        lat=0.0,
        strength=7,
        weapons=weapons,
        availability=availability,
    )


def corridor(
    corridor_id: str,
    choke: list[str],
    seconds: float = 600.0,
    route_edges: list[list[str]] | None = None,
) -> CorridorOut:
    route_edges = route_edges or [choke or ["e-none"]]
    return CorridorOut(
        id=corridor_id,
        routes=[
            RouteOut(
                reserve_id="res1",
                objective_id=f"obj{index}",
                edge_ids=edge_ids,
                node_ids=[],
                seconds=seconds + index,
                length_meters=1000.0,
            )
            for index, edge_ids in enumerate(route_edges, start=1)
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

    plan = plan_blocks(GRAPH, [WEST], orbat)

    assert [c.unit_id for c in plan.inlets[0].candidates] == ["a", "b"]


def test_candidates_are_ordered_by_distance_to_the_inlet() -> None:
    orbat = Orbat(units=(unit("far", Echelon.SECTION, 10), unit("near", Echelon.SECTION, 0)))

    plan = plan_blocks(GRAPH, [WEST], orbat)

    assert [c.unit_id for c in plan.inlets[0].candidates] == ["near", "far"]


def test_a_committed_unit_is_never_offered() -> None:
    orbat = Orbat(
        units=(
            unit("free", Echelon.SECTION, 0),
            unit("busy", Echelon.SECTION, 0, availability=Availability.COMMITTED),
        )
    )

    plan = plan_blocks(GRAPH, [WEST], orbat)

    assert [c.unit_id for c in plan.inlets[0].candidates] == ["free"]


def test_all_available_echelons_are_offered() -> None:
    orbat = Orbat(
        units=(unit("coy", Echelon.COMPANY, 0), unit("sec", Echelon.SECTION, 0)),
    )

    plan = plan_blocks(GRAPH, [WEST], orbat)

    assert [c.unit_id for c in plan.inlets[0].candidates] == ["coy", "sec"]


def test_candidate_weapons_aggregate_the_task_organised_force() -> None:
    orbat = Orbat(
        units=(
            unit(
                "pl",
                Echelon.PLATOON,
                0,
                weapons=(WeaponHolding(id="atgm", weapon=WeaponSystem.ATGM, count=2),),
            ),
            unit(
                "sec",
                Echelon.SECTION,
                0,
                parent_id="pl",
                weapons=(
                    WeaponHolding(id="law", weapon=WeaponSystem.LAW, count=3),
                    WeaponHolding(id="gpmg", weapon=WeaponSystem.GPMG, count=1),
                ),
            ),
        )
    )

    plan = plan_blocks(GRAPH, [WEST], orbat)
    by_unit = {candidate.unit_id: candidate for candidate in plan.inlets[0].candidates}

    assert [(entry.weapon, entry.count) for entry in by_unit["pl"].weapons] == [
        (WeaponSystem.ATGM, 2),
        (WeaponSystem.LAW, 3),
        (WeaponSystem.GPMG, 1),
    ]
    assert [(entry.weapon, entry.count) for entry in by_unit["sec"].weapons] == [
        (WeaponSystem.LAW, 3),
        (WeaponSystem.GPMG, 1),
    ]
    assert "strength" not in by_unit["pl"].model_dump()


# Corridors that cannot be blocked


def test_a_corridor_with_no_common_choke_is_blocked_axis_by_axis() -> None:
    """A missing common choke does not erase the separate ways in."""
    diffuse = corridor("cor_diffuse", [], route_edges=[["11:0"], ["22:0"]])
    orbat = Orbat(units=(unit("a", Echelon.SECTION, 0),))

    plan = plan_blocks(GRAPH, [diffuse], orbat)

    assert len(plan.inlets) == 2
    assert plan.inlets[0].corridor_id == "cor_diffuse"
    assert plan.inlets[0].inlet_id != plan.inlets[1].inlet_id
    assert len(plan.allocation) == 1
    assert len(plan.uncovered) == 1


def test_a_four_axis_corridor_requires_four_separate_block_positions() -> None:
    four_inlets = corridor(
        "cor_four",
        [],
        route_edges=[["11:0"], ["22:0"], ["11:0"], ["22:0"]],
    )
    orbat = Orbat(
        units=tuple(unit(f"sec-{index}", Echelon.SECTION, index) for index in range(4))
    )

    plan = plan_blocks(GRAPH, [four_inlets], orbat)

    assert len(plan.inlets) == 4
    assert [entry.inlet_number for entry in plan.inlets] == [1, 2, 3, 4]
    assert len({entry.inlet_id for entry in plan.inlets}) == 4
    assert len(plan.allocation) == 4
    assert plan.uncovered == []


def test_a_corridor_with_no_available_force_is_reported_not_omitted() -> None:
    """'Nothing can cover this' is the finding an S3 most needs to see."""
    orbat = Orbat(
        units=(unit("coy", Echelon.COMPANY, 0, availability=Availability.COMMITTED),)
    )

    plan = plan_blocks(GRAPH, [WEST], orbat)

    assert len(plan.unblockable) == 1
    assert plan.unblockable[0].corridor_id == "cor_west"


def test_an_inlet_missing_from_the_graph_is_reported() -> None:
    stale = corridor("cor_stale", ["gone:0"])
    orbat = Orbat(units=(unit("a", Echelon.SECTION, 0),))

    plan = plan_blocks(GRAPH, [stale], orbat)

    assert len(plan.unblockable) == 1


# Allocation


def test_no_unit_is_allocated_to_two_corridors() -> None:
    orbat = Orbat(units=(unit("only", Echelon.SECTION, 0),))

    plan = plan_blocks(GRAPH, [WEST, EAST], orbat)

    assert [a.unit_id for a in plan.allocation] == ["only"]
    assert len(plan.allocation) == 1


def test_the_quickest_approach_is_covered_first() -> None:
    """Fastest corridor is the most urgent, so it gets the scarce force."""
    orbat = Orbat(units=(unit("only", Echelon.SECTION, 10),))

    plan = plan_blocks(GRAPH, [EAST, WEST], orbat)

    assert plan.allocation[0].corridor_id == "cor_west"


def test_each_corridor_takes_the_nearest_force_still_free() -> None:
    orbat = Orbat(units=(unit("w", Echelon.SECTION, 0), unit("e", Echelon.SECTION, 10)))

    plan = plan_blocks(GRAPH, [WEST, EAST], orbat)

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

    plan = plan_blocks(GRAPH, [WEST, EAST], orbat)

    assert len(plan.allocation) == 1
    assert [u.corridor_id for u in plan.uncovered] == ["cor_east"]


def test_nearest_formation_is_skipped_when_it_would_reduce_inlet_coverage() -> None:
    """Distance may choose among full-coverage plans, never reduce coverage."""
    two_inlets = corridor(
        "cor_two",
        [],
        route_edges=[["11:0"], ["22:0"]],
    )
    orbat = Orbat(
        units=(
            unit("coy", Echelon.COMPANY, 0),
            unit("west", Echelon.SECTION, 1, parent_id="coy"),
            unit("east", Echelon.SECTION, 10, parent_id="coy"),
        )
    )

    plan = plan_blocks(GRAPH, [two_inlets], orbat)

    assert len(plan.allocation) == 2
    assert {entry.unit_id for entry in plan.allocation} == {"west", "east"}
    assert plan.uncovered == []


def test_nearest_formation_can_be_used_when_it_does_not_cost_coverage() -> None:
    """The coverage guard is not an implicit echelon ceiling."""
    orbat = Orbat(
        units=(
            unit("coy", Echelon.COMPANY, 0),
            unit("section", Echelon.SECTION, 10, parent_id="coy"),
        )
    )

    plan = plan_blocks(GRAPH, [WEST], orbat)

    assert [entry.unit_id for entry in plan.allocation] == ["coy"]


def test_a_corridor_left_uncovered_is_named() -> None:
    orbat = Orbat(units=(unit("only", Echelon.SECTION, 0),))

    plan = plan_blocks(GRAPH, [WEST, EAST], orbat)

    assert [u.corridor_id for u in plan.uncovered] == ["cor_east"]


def test_nothing_is_uncovered_when_every_corridor_is_allocated() -> None:
    orbat = Orbat(units=(unit("w", Echelon.SECTION, 0), unit("e", Echelon.SECTION, 10)))

    plan = plan_blocks(GRAPH, [WEST, EAST], orbat)

    assert plan.uncovered == []


def test_is_deterministic() -> None:
    orbat = Orbat(units=(unit("w", Echelon.SECTION, 0), unit("e", Echelon.SECTION, 10)))

    first = plan_blocks(GRAPH, [WEST, EAST], orbat)
    second = plan_blocks(GRAPH, [WEST, EAST], orbat)

    assert first == second


def test_an_empty_orbat_covers_nothing_and_says_so() -> None:
    plan = plan_blocks(GRAPH, [WEST], Orbat(units=()))

    assert plan.allocation == []
    assert len(plan.unblockable) == 1
