from random import Random

import pytest

from athena.world_state import Battlefield
from athena.loop import LoopEngine
from athena.resolvers.movement import MovementResolver
from athena.resolvers.vision import VisionResolver
from athena.params import MAX_VISION_RANGE
from athena.world_state import Soldier
from athena.models import Position, SurvivalState, Team, TerrainClass


def surface_for(*positions: Position) -> set[Position]:
    return set(positions)


def test_elevation_does_not_extend_vision_range() -> None:
    # High ground no longer sees farther: a low target 7 away and 2 down is
    # sqrt(49 + 4) ~= 7.3 away in 3D, beyond a range of 5, from either side.
    high = Soldier(Team.BLUE, Position(x=0, y=0, z=2), vision_range=5)
    low = Soldier(Team.RED, Position(x=7, y=0, z=0), vision_range=5)
    battlefield = Battlefield(
        width=8,
        height=1,
        soldiers=[high, low],
        surface={
            Position(x=x, y=0, z=2 if x == 0 else 0)
            for x in range(8)
        },
    )
    resolver = VisionResolver()

    assert not resolver.verify_los(battlefield, high, low)
    assert not resolver.verify_los(battlefield, low, high)


@pytest.mark.parametrize(
    "survival_status",
    [SurvivalState.CASUALTY, SurvivalState.DEAD],
)
def test_alive_observer_sees_friendly_non_living_status(
    survival_status: SurvivalState,
) -> None:
    observer = Soldier(Team.BLUE, Position(x=0, y=0, z=0))
    friendly = Soldier(
        Team.BLUE,
        Position(x=1, y=0, z=0),
        survival_status=survival_status,
    )
    battlefield = Battlefield(width=2, height=1, soldiers=[observer, friendly])
    loop = LoopEngine(
        battlefield=battlefield,
        vision_resolver=VisionResolver(),
        movement_resolver=MovementResolver(),
    )

    visible_friendly = loop.visible_soldiers_map()[0][0]

    assert visible_friendly.position == friendly.position
    assert visible_friendly.survival_status == survival_status


@pytest.mark.parametrize(
    "survival_status",
    [SurvivalState.CASUALTY, SurvivalState.DEAD],
)
def test_enemy_non_living_soldier_remains_hidden(
    survival_status: SurvivalState,
) -> None:
    observer = Soldier(Team.BLUE, Position(x=0, y=0, z=0))
    enemy = Soldier(
        Team.RED,
        Position(x=1, y=0, z=0),
        survival_status=survival_status,
    )
    battlefield = Battlefield(width=2, height=1, soldiers=[observer, enemy])

    assert not VisionResolver().verify_los(battlefield, observer, enemy)


def test_friendly_casualty_behind_hill_remains_hidden() -> None:
    observer = Soldier(Team.BLUE, Position(x=0, y=0, z=0), vision_range=5)
    friendly = Soldier(
        Team.BLUE,
        Position(x=2, y=0, z=0),
        survival_status=SurvivalState.CASUALTY,
    )
    battlefield = Battlefield(
        width=3,
        height=1,
        soldiers=[observer, friendly],
        surface={
            observer.position,
            Position(x=1, y=0, z=1),
            friendly.position,
        },
    )

    assert not VisionResolver().verify_los(battlefield, observer, friendly)


@pytest.mark.parametrize("target_team", [Team.BLUE, Team.RED])
def test_hill_blocks_soldier_los_for_both_teams(target_team: Team) -> None:
    observer = Soldier(Team.BLUE, Position(x=0, y=0, z=0), vision_range=5)
    target = Soldier(target_team, Position(x=2, y=0, z=0), vision_range=5)
    battlefield = Battlefield(
        width=3,
        height=1,
        soldiers=[observer, target],
        surface={
            observer.position,
            Position(x=1, y=0, z=1),
            target.position,
        },
    )

    assert not VisionResolver().verify_los(battlefield, observer, target)


def test_soldier_eye_height_is_configurable() -> None:
    observer = Soldier(Team.BLUE, Position(x=0, y=0, z=0), vision_range=5)
    target = Soldier(Team.RED, Position(x=2, y=0, z=0), vision_range=5)
    battlefield = Battlefield(width=3, height=1, soldiers=[observer, target])

    assert VisionResolver().verify_los(battlefield, observer, target)
    assert not VisionResolver(soldier_eye_height=0).verify_los(
        battlefield,
        observer,
        target,
    )


def test_high_observer_can_see_over_terrain_below_sightline() -> None:
    observer = Soldier(Team.BLUE, Position(x=0, y=0, z=2), vision_range=5)
    target = Soldier(Team.RED, Position(x=2, y=0, z=0), vision_range=5)
    battlefield = Battlefield(
        width=3,
        height=1,
        soldiers=[observer, target],
        surface={
            observer.position,
            Position(x=1, y=0, z=1),
            target.position,
        },
    )

    assert VisionResolver().verify_los(battlefield, observer, target)


def test_terrain_meeting_sightline_blocks_high_observer() -> None:
    observer = Soldier(Team.BLUE, Position(x=0, y=0, z=2), vision_range=5)
    target = Soldier(Team.RED, Position(x=2, y=0, z=0), vision_range=5)
    battlefield = Battlefield(
        width=3,
        height=1,
        soldiers=[observer, target],
        surface={
            observer.position,
            Position(x=1, y=0, z=2),
            target.position,
        },
    )

    assert not VisionResolver().verify_los(battlefield, observer, target)


def test_equal_elevation_uses_base_vision_range() -> None:
    resolver = VisionResolver()

    assert resolver.is_in_vision_range(
        Position(x=0, y=0, z=3),
        Position(x=5, y=0, z=3),
        observer_vision_range=5,
    )
    assert not resolver.is_in_vision_range(
        Position(x=0, y=0, z=3),
        Position(x=6, y=0, z=3),
        observer_vision_range=5,
    )


def test_elevation_difference_counts_toward_distance() -> None:
    resolver = VisionResolver()

    # One step away horizontally but 20 levels up is ~20 away in 3D: out of range.
    assert not resolver.is_in_vision_range(
        Position(x=0, y=0, z=0),
        Position(x=1, y=0, z=20),
        observer_vision_range=5,
    )
    # The same horizontal step at equal elevation is comfortably in range.
    assert resolver.is_in_vision_range(
        Position(x=0, y=0, z=0),
        Position(x=1, y=0, z=0),
        observer_vision_range=5,
    )


def test_vision_range_is_capped() -> None:
    resolver = VisionResolver()

    # An enormous nominal vision range still cannot see past the cap, which is
    # set high enough for a Recon Section's real 500 m to survive it.
    assert resolver.is_in_vision_range(
        Position(x=0, y=0, z=0),
        Position(x=int(MAX_VISION_RANGE), y=0, z=0),
        observer_vision_range=10_000,
    )
    assert not resolver.is_in_vision_range(
        Position(x=0, y=0, z=0),
        Position(x=int(MAX_VISION_RANGE) + 1, y=0, z=0),
        observer_vision_range=10_000,
    )


def test_an_orbat_vision_range_survives_the_cap() -> None:
    # Recon is drawn at 500 m against a Rifle Section's 300 m. Both used to be
    # clamped to 100, which made the distinction decorative.
    resolver = VisionResolver()

    assert resolver.is_in_vision_range(
        Position(x=0, y=0, z=0),
        Position(x=480, y=0, z=0),
        observer_vision_range=500,
    )
    assert not resolver.is_in_vision_range(
        Position(x=0, y=0, z=0),
        Position(x=480, y=0, z=0),
        observer_vision_range=300,
    )


def test_max_vision_range_is_configurable() -> None:
    # The cap is a resolver setting: lowering it shrinks how far a soldier sees.
    tight = VisionResolver(max_vision_range=3)

    assert tight.is_in_vision_range(
        Position(x=0, y=0, z=0),
        Position(x=3, y=0, z=0),
        observer_vision_range=50,
    )
    assert not tight.is_in_vision_range(
        Position(x=0, y=0, z=0),
        Position(x=4, y=0, z=0),
        observer_vision_range=50,
    )


def test_high_observer_cannot_see_cell_far_below_despite_adjacency() -> None:
    resolver = VisionResolver()

    # Standing on a 300-high peak, the ground cell one step away is ~300 away in
    # 3D, so it is out of range even though horizontally adjacent.
    assert not resolver.is_in_vision_range(
        Position(x=0, y=0, z=300),
        Position(x=1, y=0, z=0),
        observer_vision_range=100,
    )


def test_cover_still_blocks_xy_sightline_on_elevated_surface() -> None:
    observer = Soldier(Team.BLUE, Position(x=0, y=0, z=0), vision_range=5)
    target = Soldier(Team.RED, Position(x=2, y=0, z=2), vision_range=5)
    cover = Position(x=1, y=0, z=1)
    battlefield = Battlefield(
        width=3,
        height=1,
        soldiers=[observer, target],
        surface=surface_for(observer.position, cover, target.position),
        terrain={cover: TerrainClass.STRUCTURE},
    )

    assert not VisionResolver().verify_los(battlefield, observer, target)


def test_friendly_soldier_still_ignores_hard_cover_below_sightline() -> None:
    observer = Soldier(Team.BLUE, Position(x=0, y=0, z=0), vision_range=5)
    target = Soldier(Team.BLUE, Position(x=2, y=0, z=0), vision_range=5)
    cover = Position(x=1, y=0, z=0)
    battlefield = Battlefield(
        width=3,
        height=1,
        soldiers=[observer, target],
        surface=surface_for(observer.position, cover, target.position),
        terrain={cover: TerrainClass.STRUCTURE},
    )

    assert VisionResolver().verify_los(battlefield, observer, target)


def test_concealment_uses_the_target_cell_terrain_value() -> None:
    observer = Soldier(Team.BLUE, Position(x=0, y=0, z=1), vision_range=5)
    target = Soldier(Team.RED, Position(x=1, y=0, z=0), vision_range=5)

    def battlefield_with(terrain_class: TerrainClass) -> Battlefield:
        return Battlefield(
            width=2,
            height=1,
            soldiers=[observer, target],
            surface={observer.position, target.position},
            terrain={target.position: terrain_class},
        )

    # Dense forest conceals at 0.70. Random(1) first yields ~0.134, which is
    # below that, so the target stays hidden; open ground never rolls at all.
    assert not VisionResolver(rng=Random(1)).verify_los(
        battlefield_with(TerrainClass.DENSE_FOREST),
        observer,
        target,
    )
    assert VisionResolver(rng=Random(1)).verify_los(
        battlefield_with(TerrainClass.OPEN_GROUND),
        observer,
        target,
    )
    # Random(0) first yields ~0.844, above 0.70, so the same forest cell is seen.
    assert VisionResolver(rng=Random(0)).verify_los(
        battlefield_with(TerrainClass.DENSE_FOREST),
        observer,
        target,
    )


def test_opacity_accumulates_with_distance_through_forest() -> None:
    # One metre of dense forest must not blind an observer, but a long run of
    # it must: 0.05 per metre crosses the threshold at roughly twenty metres.
    def forest_corridor(width: int) -> tuple[Battlefield, Soldier, Soldier]:
        observer = Soldier(Team.BLUE, Position(x=0, y=0, z=0), vision_range=40)
        target = Soldier(Team.RED, Position(x=width - 1, y=0, z=0), vision_range=40)
        battlefield = Battlefield(
            width=width,
            height=1,
            soldiers=[observer, target],
            surface={Position(x=x, y=0, z=0) for x in range(width)},
            terrain=[TerrainClass.DENSE_FOREST] * width,
        )
        return battlefield, observer, target

    resolver = VisionResolver(rng=Random(0))

    short_battlefield, short_observer, short_target = forest_corridor(4)
    assert not resolver._opacity_blocks_los(
        short_battlefield, short_observer.position, short_target.position
    )

    long_battlefield, long_observer, long_target = forest_corridor(30)
    assert resolver._opacity_blocks_los(
        long_battlefield, long_observer.position, long_target.position
    )


def test_a_single_structure_cell_blocks_sight_immediately() -> None:
    observer = Soldier(Team.BLUE, Position(x=0, y=0, z=0), vision_range=10)
    target = Soldier(Team.RED, Position(x=2, y=0, z=0), vision_range=10)
    blocker = Position(x=1, y=0, z=0)
    battlefield = Battlefield(
        width=3,
        height=1,
        soldiers=[observer, target],
        surface={Position(x=x, y=0, z=0) for x in range(3)},
        terrain={blocker: TerrainClass.STRUCTURE},
    )

    assert not VisionResolver().verify_los(battlefield, observer, target)


def test_nearby_terrain_includes_every_in_range_cell_with_attributes() -> None:
    observer = Soldier(Team.BLUE, Position(x=0, y=0, z=0), vision_range=4)
    distant_cover = Position(x=4, y=0, z=0)
    concealed_position = Position(x=2, y=0, z=0)
    battlefield = Battlefield(
        width=6,
        height=1,
        soldiers=[observer],
        surface={Position(x=x, y=0, z=0) for x in range(6)},
        terrain={
            distant_cover: TerrainClass.STRUCTURE,
            concealed_position: TerrainClass.SCRUB,
        },
    )
    loop = LoopEngine(
        battlefield=battlefield,
        vision_resolver=VisionResolver(),
        movement_resolver=MovementResolver(),
    )

    cells = loop.nearby_terrain_map()[0]

    assert [cell.position for cell in cells] == [
        Position(x=0, y=0, z=0),
        Position(x=1, y=0, z=0),
        Position(x=2, y=0, z=0),
        Position(x=3, y=0, z=0),
        Position(x=4, y=0, z=0),
    ]
    assert cells[2].terrain_class == TerrainClass.SCRUB
    assert cells[2].terrain == "Scrub / Bush"
    assert cells[4].terrain_class == TerrainClass.STRUCTURE
    assert cells[0].terrain_class == TerrainClass.OPEN_GROUND


def test_in_range_terrain_behind_hill_is_hidden() -> None:
    observer = Soldier(Team.BLUE, Position(x=0, y=0, z=0), vision_range=5)
    behind_hill = Position(x=2, y=0, z=0)
    battlefield = Battlefield(
        width=3,
        height=1,
        soldiers=[observer],
        surface={
            observer.position,
            Position(x=1, y=0, z=1),
            behind_hill,
        },
    )
    loop = LoopEngine(
        battlefield=battlefield,
        vision_resolver=VisionResolver(),
        movement_resolver=MovementResolver(),
    )

    assert behind_hill not in {
        cell.position for cell in loop.nearby_terrain_map()[0]
    }


def test_high_observer_sees_terrain_beyond_lower_rise() -> None:
    observer = Soldier(Team.BLUE, Position(x=0, y=0, z=2), vision_range=5)
    beyond_rise = Position(x=2, y=0, z=0)
    battlefield = Battlefield(
        width=3,
        height=1,
        soldiers=[observer],
        surface={
            observer.position,
            Position(x=1, y=0, z=1),
            beyond_rise,
        },
    )
    loop = LoopEngine(
        battlefield=battlefield,
        vision_resolver=VisionResolver(),
        movement_resolver=MovementResolver(),
    )

    assert beyond_rise in {
        cell.position for cell in loop.nearby_terrain_map()[0]
    }


def test_terrain_los_blocked_by_tall_wall() -> None:
    resolver = VisionResolver()
    battlefield = Battlefield(
        width=3,
        height=1,
        soldiers=[],
        surface={
            Position(x=0, y=0, z=1),
            Position(x=1, y=0, z=10),
            Position(x=2, y=0, z=1),
        },
    )

    assert not resolver.verify_terrain_los(
        battlefield,
        Position(x=0, y=0, z=1),
        Position(x=2, y=0, z=1),
        observer_vision_range=6,
    )


def forest_battlefield(width: int, soldiers: list[Soldier]) -> Battlefield:
    """Flat ground, uniformly dense forest, so only opacity can block."""
    return Battlefield(
        width=width,
        height=1,
        soldiers=soldiers,
        surface={Position(x=x, y=0, z=0) for x in range(width)},
        terrain=tuple([int(TerrainClass.DENSE_FOREST)] * width),
    )


def test_terrain_beyond_opaque_foliage_is_not_reported() -> None:
    # Dense forest is 0.05 opacity/m, so sight accumulates to opaque at ~21 m.
    # Ground past that point must not be reported, or a soldier is handed
    # terrain it cannot see through.
    observer = Soldier(Team.BLUE, Position(x=0, y=0, z=0), vision_range=30)
    resolver = VisionResolver()
    battlefield = forest_battlefield(40, [observer])

    assert resolver.verify_terrain_los(
        battlefield, observer.position, Position(x=15, y=0, z=0), 30
    )
    assert not resolver.verify_terrain_los(
        battlefield, observer.position, Position(x=25, y=0, z=0), 30
    )


def test_terrain_visibility_matches_soldier_visibility() -> None:
    # The cell an enemy stands on must not outlive the enemy: if foliage hides
    # the soldier, it hides the ground too.
    observer = Soldier(Team.BLUE, Position(x=0, y=0, z=0), vision_range=30)
    target = Soldier(Team.RED, Position(x=25, y=0, z=0), vision_range=30)
    battlefield = forest_battlefield(40, [observer, target])

    # A roll that never hides isolates opacity from the concealment check.
    resolver = VisionResolver(rng=Random())
    resolver.rng.random = lambda: 1.0

    assert not resolver.verify_los(battlefield, observer, target)
    assert not resolver.verify_terrain_los(
        battlefield, observer.position, target.position, 30
    )


def test_a_soldier_may_see_and_engage_at_its_full_vision_range() -> None:
    # Detection used to be reported only within the ground the agent was shown,
    # because a flat hit probability with no range term made a 300 m shot as
    # reliable as a 5 m one. The shooting resolver now discounts distance, so
    # what a soldier can see it can shoot at -- badly, at range.
    from athena.world_state import Soldier
    from athena.models import Team

    observer = Soldier(Team.BLUE, Position(x=0, y=40, z=0), vision_range=500)
    far_enemy = Soldier(Team.RED, Position(x=80, y=40, z=0))
    battlefield = Battlefield(
        width=120,
        height=80,
        soldiers=[observer, far_enemy],
        surface={
            Position(x=x, y=y, z=0) for x in range(120) for y in range(80)
        },
    )
    loop = LoopEngine(
        battlefield=battlefield,
        vision_resolver=VisionResolver(),
        movement_resolver=MovementResolver(),
    )

    observed = loop.observed_soldiers_map()[0]

    assert [s.position for s in observed.visible_soldiers] == [
        Position(x=80, y=40, z=0)
    ]


def test_the_drawn_map_stays_bounded_however_far_a_soldier_can_see() -> None:
    # Terrain is quadratic in radius with a sightline walk per cell, and every
    # cell it returns becomes prompt tokens on every call of every tick. A
    # 500 m vision range must not turn into a 1001x1001 character map.
    from athena.params import MAX_RENDERED_TERRAIN_RADIUS
    from athena.world_state import Soldier
    from athena.models import Team

    observer = Soldier(Team.BLUE, Position(x=60, y=60, z=0), vision_range=500)
    battlefield = Battlefield(
        width=140,
        height=140,
        soldiers=[observer],
        surface={
            Position(x=x, y=y, z=0) for x in range(140) for y in range(140)
        },
    )
    loop = LoopEngine(
        battlefield=battlefield,
        vision_resolver=VisionResolver(),
        movement_resolver=MovementResolver(),
    )

    cells = loop.nearby_terrain_map()[0]
    span = MAX_RENDERED_TERRAIN_RADIUS

    assert cells
    assert all(
        abs(cell.position.x - 60) <= span and abs(cell.position.y - 60) <= span
        for cell in cells
    )
