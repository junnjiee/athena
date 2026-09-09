"""Which forces a commander can put on which approach."""

import pytest

from athena.blocking import (
    BlockEstablishmentInput,
    BlockPointInput,
    DelayAssessmentInput,
    plan_blocks,
)
from athena.graph import Edge, RoadGraph
from athena.orbat import Availability, Orbat, Unit, WeaponHolding, WeaponSystem
from athena.study import (
    AggressorEchelon,
    CompositionModifier,
    CorridorOut,
    Mark,
    PlatformCount,
    ReserveTiming,
    RouteOut,
    RouteTerminalOut,
    TaskOrganizationElement,
)
from athena.units import Echelon

from .conftest import node


def unit(
    unit_id: str,
    echelon: Echelon,
    lon: float,
    lat: float = 0.0,
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
        lat=lat,
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


def reserve(
    platform: str = "BTR-90",
    count: int = 10,
    modifier: CompositionModifier = CompositionModifier.FULL,
    timing: ReserveTiming | None = None,
) -> Mark:
    return Mark(
        id="res1",
        name="Reserve 1",
        lon=0,
        lat=0,
        timing=timing,
        task_organization=[
            TaskOrganizationElement(
                id="rrc",
                designation="RRC",
                echelon=AggressorEchelon.COMPANY,
                modifier=modifier,
                order_of_move=1,
                platforms=[
                    PlatformCount(id="target", platform=platform, establishment_count=count)
                ],
            )
        ],
    )


def test_an_operator_block_point_times_enemy_contact_on_the_inlet() -> None:
    force = Orbat(units=(unit("near", Echelon.SECTION, 0.0),))
    route = CorridorOut(
        id="cor_contact",
        routes=[
            RouteOut(
                reserve_id="res1",
                objective_id="obj1",
                edge_ids=["11:0"],
                node_ids=[1, 2],
                seconds=300,
                length_meters=1000,
            )
        ],
        choke_edge_ids=["11:0"],
        fastest_seconds=300,
    )
    baseline = plan_blocks(GRAPH, [route], force)
    inlet_id = baseline.inlets[0].inlet_id

    result = plan_blocks(
        GRAPH,
        [route],
        force,
        reserves=[
            reserve(timing=ReserveTiming(decision_minutes=10, readiness_minutes=20))
        ],
        block_points=[BlockPointInput(inlet_id=inlet_id, lon=0.005, lat=0)],
    )

    point = result.block_points[0]
    reaction = result.sealing[0].reaction
    assert point.lon == 0.005
    assert point.snap_distance_meters == 0
    assert result.allocation[0].block_point == point
    assert reaction.contact_minutes == 30 + point.enemy_movement_seconds / 60
    assert not any("block position" in unknown for unknown in reaction.unknowns)


def test_a_block_point_cannot_snap_past_a_mid_edge_objective_endpoint() -> None:
    force = Orbat(units=(unit("near", Echelon.SECTION, 0.0),))
    route = CorridorOut(
        id="cor_partial",
        routes=[
            RouteOut(
                reserve_id="res1",
                objective_id="obj1",
                edge_ids=["11:0"],
                node_ids=[1],
                seconds=36,
                length_meters=500,
                terminal=RouteTerminalOut(
                    edge_id="11:0",
                    lon=0.005,
                    lat=0,
                    edge_fraction=0.5,
                ),
            )
        ],
        choke_edge_ids=["11:0"],
        fastest_seconds=36,
    )
    inlet_id = plan_blocks(GRAPH, [route], force).inlets[0].inlet_id

    result = plan_blocks(
        GRAPH,
        [route],
        force,
        block_points=[BlockPointInput(inlet_id=inlet_id, lon=0.01, lat=0)],
    )

    assert result.block_points == []
    assert result.rejected_block_points[0].inlet_id == inlet_id

    at_boundary = plan_blocks(
        GRAPH,
        [route],
        force,
        block_points=[BlockPointInput(inlet_id=inlet_id, lon=0.005, lat=0)],
    )
    assert at_boundary.block_points[0].enemy_movement_seconds == pytest.approx(36)


def test_operator_establishment_time_compares_the_block_force_with_contact() -> None:
    force = Orbat(
        units=(
            unit(
                "near",
                Echelon.SECTION,
                0.0,
                weapons=(WeaponHolding(id="atgm", weapon=WeaponSystem.ATGM, count=10),),
            ),
        )
    )
    baseline = plan_blocks(GRAPH, [WEST], force)
    inlet_id = baseline.inlets[0].inlet_id
    point = BlockPointInput(inlet_id=inlet_id, lon=0.005, lat=0)
    timed = reserve(
        timing=ReserveTiming(
            decision_minutes=10,
            readiness_minutes=20,
            deployment_minutes=15,
        )
    )

    ready = plan_blocks(
        GRAPH,
        [WEST],
        force,
        [timed],
        [point],
        block_establishments=[
            BlockEstablishmentInput(
                inlet_id=inlet_id,
                unit_id="near",
                block_point_lon=0.005,
                block_point_lat=0,
                established_minutes=25,
            )
        ],
    )
    late = plan_blocks(
        GRAPH,
        [WEST],
        force,
        [timed],
        [point],
        block_establishments=[
            BlockEstablishmentInput(
                inlet_id=inlet_id,
                unit_id="near",
                block_point_lon=0.005,
                block_point_lat=0,
                established_minutes=60,
            )
        ],
    )

    assert ready.sealing[0].reaction.block_established_minutes == 25
    assert ready.sealing[0].reaction.block_established_by_contact is True
    assert ready.sealing[0].reaction.objective_outcome == "did_not_reach"
    assert late.sealing[0].outcome == "destroyed_at_block"
    assert late.sealing[0].reaction.block_established_by_contact is False
    assert late.sealing[0].reaction.delay_minutes == 0
    assert late.sealing[0].reaction.remnant_continued is True
    assert late.sealing[0].reaction.objective_arrival_minutes == 30 + 301 / 60 + 15
    assert late.sealing[0].reaction.objective_outcome == "reached"


def test_moving_a_block_point_rejects_its_stale_establishment_time() -> None:
    force = Orbat(units=(unit("near", Echelon.SECTION, 0.0),))
    inlet_id = plan_blocks(GRAPH, [WEST], force).inlets[0].inlet_id

    result = plan_blocks(
        GRAPH,
        [WEST],
        force,
        block_points=[BlockPointInput(inlet_id=inlet_id, lon=0.006, lat=0)],
        block_establishments=[
            BlockEstablishmentInput(
                inlet_id=inlet_id,
                unit_id="near",
                block_point_lon=0.005,
                block_point_lat=0,
                established_minutes=20,
            )
        ],
    )

    assert result.block_establishments == []
    assert "different block point" in result.rejected_block_establishments[0].reason


def test_a_block_point_away_from_or_outside_the_study_is_rejected() -> None:
    force = Orbat(units=(unit("near", Echelon.SECTION, 0.0),))
    baseline = plan_blocks(GRAPH, [WEST], force)
    inlet_id = baseline.inlets[0].inlet_id

    result = plan_blocks(
        GRAPH,
        [WEST],
        force,
        block_points=[
            BlockPointInput(inlet_id=inlet_id, lon=5, lat=5),
            BlockPointInput(inlet_id="inlet_invented", lon=0, lat=0),
        ],
    )

    assert result.block_points == []
    assert {rejection.inlet_id for rejection in result.rejected_block_points} == {
        inlet_id,
        "inlet_invented",
    }


def test_block_point_timing_follows_a_reverse_route_direction() -> None:
    force = Orbat(units=(unit("near", Echelon.SECTION, 0.0),))
    route = CorridorOut(
        id="cor_reverse",
        routes=[
            RouteOut(
                reserve_id="res1",
                objective_id="obj1",
                edge_ids=["11:0"],
                node_ids=[2, 1],
                seconds=300,
                length_meters=1000,
            )
        ],
        choke_edge_ids=["11:0"],
        fastest_seconds=300,
    )
    inlet_id = plan_blocks(GRAPH, [route], force).inlets[0].inlet_id

    result = plan_blocks(
        GRAPH,
        [route],
        force,
        block_points=[BlockPointInput(inlet_id=inlet_id, lon=0.009, lat=0)],
    )

    point = result.block_points[0]
    assert point.lon == 0.009
    assert point.enemy_movement_seconds < 30


# Candidates


def test_offers_every_available_unit_against_a_corridor() -> None:
    orbat = Orbat(units=(unit("a", Echelon.SECTION, 0), unit("b", Echelon.SECTION, 10)))

    plan = plan_blocks(GRAPH, [WEST], orbat)

    assert [c.unit_id for c in plan.inlets[0].candidates] == ["a", "b"]


def test_candidates_are_ordered_by_distance_to_the_inlet() -> None:
    orbat = Orbat(units=(unit("far", Echelon.SECTION, 10), unit("near", Echelon.SECTION, 0)))

    plan = plan_blocks(GRAPH, [WEST], orbat)

    assert [c.unit_id for c in plan.inlets[0].candidates] == ["near", "far"]


def test_candidate_distance_projects_to_the_middle_of_a_long_road_segment() -> None:
    long_edge = Edge.model_validate(
        {
            "id": "99:0",
            "wayId": 99,
            "from": 1,
            "to": 2,
            "roadClass": "secondary",
            "nodes": [1, 2],
            "points": [[0, 0], [10, 0]],
            "lengthMeters": 1_000_000,
        }
    )
    graph = RoadGraph(nodes=(node(1, 0), node(2, 10)), edges=(long_edge,))
    approach = corridor("cor_long", ["99:0"])
    orbat = Orbat(
        units=(
            unit("near-middle", Echelon.SECTION, 5, lat=0.001),
            unit("near-vertex", Echelon.SECTION, 0, lat=0.05),
        )
    )

    plan = plan_blocks(graph, [approach], orbat)

    candidates = plan.inlets[0].candidates
    assert [candidate.unit_id for candidate in candidates] == [
        "near-middle",
        "near-vertex",
    ]
    assert candidates[0].distance_meters == pytest.approx(111.32, rel=0.001)
    assert candidates[1].distance_meters == pytest.approx(5_566, rel=0.001)


def test_candidate_distance_takes_the_short_segment_across_the_antimeridian() -> None:
    dateline_edge = Edge.model_validate(
        {
            "id": "100:0",
            "wayId": 100,
            "from": 1,
            "to": 2,
            "roadClass": "secondary",
            "nodes": [1, 2],
            "points": [[179, 0], [-179, 0]],
            "lengthMeters": 222_640,
        }
    )
    graph = RoadGraph(
        nodes=(node(1, 179), node(2, -179)),
        edges=(dateline_edge,),
    )
    approach = corridor("cor_dateline", ["100:0"])
    orbat = Orbat(
        units=(
            unit("dateline", Echelon.SECTION, 180, lat=0.1),
            unit("greenwich", Echelon.SECTION, 0),
        )
    )

    candidates = plan_blocks(graph, [approach], orbat).inlets[0].candidates

    assert [candidate.unit_id for candidate in candidates] == ["dateline", "greenwich"]
    assert candidates[0].distance_meters == pytest.approx(11_132, rel=0.001)
    assert candidates[1].distance_meters > 10_000_000


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


# Sealing assessment


def test_effective_weapons_destroy_the_hardest_platforms_when_sufficient() -> None:
    orbat = Orbat(
        units=(
            unit(
                "block",
                Echelon.SECTION,
                0,
                weapons=(
                    WeaponHolding(id="atgm", weapon=WeaponSystem.ATGM, count=10),
                ),
            ),
        )
    )

    plan = plan_blocks(GRAPH, [WEST], orbat, [reserve()])

    assessment = plan.sealing[0]
    assert assessment.outcome == "destroyed_at_block"
    assert assessment.target_hardness == "hard_skin_light"
    assert assessment.target_platform_count.model_dump() == {"numerator": 10, "denominator": 1}
    assert assessment.effective_weapon_count == 10
    assert assessment.remaining_platform_count is not None
    assert assessment.remaining_platform_count.numerator == 0
    assert assessment.reaction.remnant_continued is False
    assert assessment.reaction.objective_outcome == "did_not_reach"


def test_fractional_reserve_composition_is_never_rounded() -> None:
    orbat = Orbat(
        units=(
            unit(
                "block",
                Echelon.SECTION,
                0,
                weapons=(WeaponHolding(id="atgm", weapon=WeaponSystem.ATGM, count=3),),
            ),
        )
    )

    plan = plan_blocks(
        GRAPH,
        [WEST],
        orbat,
        [reserve(modifier=CompositionModifier.EQUAL)],
    )

    assessment = plan.sealing[0]
    assert assessment.outcome == "delayed_and_attrited"
    assert assessment.target_platform_count is not None
    assert assessment.target_platform_count.model_dump() == {"numerator": 10, "denominator": 3}
    assert assessment.remaining_platform_count is not None
    assert assessment.remaining_platform_count.model_dump() == {"numerator": 1, "denominator": 3}
    assert assessment.reaction.remnant_continued is True
    assert assessment.reaction.objective_outcome == "reached"
    assert assessment.reaction.objective_arrival_minutes is None
    assert "delay duration is not assessed" in assessment.reaction.unknowns


def test_operator_assessed_delay_completes_delayed_objective_arrival() -> None:
    orbat = Orbat(
        units=(
            unit(
                "block",
                Echelon.SECTION,
                0,
                weapons=(WeaponHolding(id="atgm", weapon=WeaponSystem.ATGM, count=3),),
            ),
        )
    )
    timed = reserve(
        modifier=CompositionModifier.EQUAL,
        timing=ReserveTiming(
            decision_minutes=10,
            readiness_minutes=20,
            deployment_minutes=15,
        ),
    )
    inlet_id = plan_blocks(GRAPH, [WEST], orbat, [timed]).inlets[0].inlet_id

    plan = plan_blocks(
        GRAPH,
        [WEST],
        orbat,
        [timed],
        delay_assessments=[
            DelayAssessmentInput(inlet_id=inlet_id, unit_id="block", delay_minutes=45)
        ],
    )

    reaction = plan.sealing[0].reaction
    assert plan.delay_assessments[0].delay_minutes == 45
    assert reaction.delay_minutes == 45
    assert reaction.objective_arrival_minutes == 30 + 301 / 60 + 15 + 45
    assert "delay duration is not assessed" not in reaction.unknowns


def test_delay_assessment_for_unknown_or_duplicate_inlet_is_rejected() -> None:
    force = Orbat(units=(unit("near", Echelon.SECTION, 0.0),))
    inlet_id = plan_blocks(GRAPH, [WEST], force).inlets[0].inlet_id

    result = plan_blocks(
        GRAPH,
        [WEST],
        force,
        delay_assessments=[
            DelayAssessmentInput(inlet_id=inlet_id, unit_id="near", delay_minutes=10),
            DelayAssessmentInput(inlet_id=inlet_id, unit_id="near", delay_minutes=20),
            DelayAssessmentInput(inlet_id="unknown", unit_id="near", delay_minutes=30),
        ],
    )

    assert result.delay_assessments == []
    assert {(entry.inlet_id, entry.reason) for entry in result.rejected_delay_assessments} == {
        (inlet_id, "delay assessment was supplied more than once"),
        ("unknown", "delay assessment names an inlet outside this study"),
    }


def test_delay_assessment_is_rejected_when_the_allocated_force_changed() -> None:
    force = Orbat(
        units=(
            unit(
                "block",
                Echelon.SECTION,
                0,
                weapons=(WeaponHolding(id="atgm", weapon=WeaponSystem.ATGM, count=3),),
            ),
        )
    )
    inlet_id = plan_blocks(GRAPH, [WEST], force).inlets[0].inlet_id

    result = plan_blocks(
        GRAPH,
        [WEST],
        force,
        [reserve(modifier=CompositionModifier.EQUAL)],
        delay_assessments=[
            DelayAssessmentInput(inlet_id=inlet_id, unit_id="old-unit", delay_minutes=30)
        ],
    )

    assert result.delay_assessments == []
    assert "different allocated block force" in result.rejected_delay_assessments[0].reason


def test_delay_assessment_is_dropped_when_the_reserve_is_not_delayed() -> None:
    force = Orbat(
        units=(
            unit(
                "block",
                Echelon.SECTION,
                0,
                weapons=(WeaponHolding(id="gpmg", weapon=WeaponSystem.GPMG, count=3),),
            ),
        )
    )
    inlet_id = plan_blocks(GRAPH, [WEST], force).inlets[0].inlet_id

    result = plan_blocks(
        GRAPH,
        [WEST],
        force,
        [reserve()],
        delay_assessments=[
            DelayAssessmentInput(inlet_id=inlet_id, unit_id="block", delay_minutes=30)
        ],
    )

    assert result.sealing[0].outcome == "passed"
    assert result.delay_assessments == []
    assert "requires a delayed" in result.rejected_delay_assessments[0].reason


def test_conditional_or_ineffective_weapons_do_not_claim_a_kill() -> None:
    orbat = Orbat(
        units=(
            unit(
                "block",
                Echelon.SECTION,
                0,
                weapons=(WeaponHolding(id="gpmg", weapon=WeaponSystem.GPMG, count=20),),
            ),
        )
    )

    plan = plan_blocks(GRAPH, [WEST], orbat, [reserve()])

    assert plan.sealing[0].outcome == "passed"
    assert plan.sealing[0].effective_weapon_count == 0


def test_unimpeded_reserve_reaction_has_a_computable_objective_arrival() -> None:
    orbat = Orbat(
        units=(
            unit(
                "block",
                Echelon.SECTION,
                0,
                weapons=(WeaponHolding(id="gpmg", weapon=WeaponSystem.GPMG, count=20),),
            ),
        )
    )
    timed = reserve(
        timing=ReserveTiming(
            decision_minutes=10,
            readiness_minutes=20,
            deployment_minutes=15,
        )
    )

    plan = plan_blocks(GRAPH, [WEST], orbat, [timed])

    reaction = plan.sealing[0].reaction
    assert reaction.commencement_minutes == 30
    assert reaction.contact_minutes is None
    assert reaction.delay_minutes == 0
    assert reaction.objective_arrival_minutes == 30 + 301 / 60 + 15
    assert reaction.objective_outcome == "reached"
    assert reaction.unknowns == [
        "contact time needs an operator-set block position",
        "block-force establishment time is not assessed",
    ]


def test_missing_composition_stays_unknown_without_affecting_coverage() -> None:
    orbat = Orbat(units=(unit("block", Echelon.SECTION, 0),))

    plan = plan_blocks(
        GRAPH,
        [WEST],
        orbat,
        [Mark(id="res1", name="Reserve 1", lon=0, lat=0)],
    )

    assert len(plan.allocation) == 1
    assert plan.sealing[0].outcome == "unknown"
    assert "no catalogued" in plan.sealing[0].reason
    assert plan.sealing[0].reaction.objective_outcome == "unknown"
