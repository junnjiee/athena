"""Every terrain class, on every axis a resolver actually consumes.

The profile table is the engine's only statement of how ground behaves, and
each field is read by exactly one resolver: passable by movement, concealment
and opacity_per_metre by vision, protection by shooting. A value can therefore
be wrong in two ways -- the number is wrong, or the number is wired to nothing.

The pinned table below catches the first. The sweeps that follow derive their
expectations from the table and push all ten classes through the resolvers,
which catches the second: a class whose entry is never read fails here instead
of quietly doing nothing in a battle.

move_cost is deliberately absent. No resolver reads it yet, so there is no
behaviour to assert.
"""

from math import ceil
from random import Random

import pytest

from athena.models import (
    TERRAIN_LABELS,
    MoveAction,
    MoveDirection,
    Position,
    ShootAction,
    Team,
    TerrainClass,
)
from athena.params import BASE_HIT_PROBABILITY, TERRAIN_PROFILES
from athena.resolvers.movement import MovementResolver
from athena.resolvers.shooting import ShootingResolver
from athena.resolvers.vision import VisionResolver
from athena.world_state import Battlefield, Soldier


DOCUMENTED_PROFILES: dict[TerrainClass, tuple[bool, float, float, float]] = {
    #                          passable, opacity/m, conceal, protect
    TerrainClass.OPEN_GROUND: (True, 0.00, 0.00, 0.00),
    TerrainClass.GRASSLAND: (True, 0.01, 0.10, 0.00),
    TerrainClass.SCRUB: (True, 0.03, 0.45, 0.05),
    TerrainClass.DENSE_FOREST: (True, 0.05, 0.70, 0.15),
    TerrainClass.WETLAND: (True, 0.01, 0.15, 0.00),
    TerrainClass.WATER: (False, 0.00, 0.00, 0.00),
    TerrainClass.URBAN: (True, 0.10, 0.60, 0.40),
    TerrainClass.STRUCTURE: (False, 1.00, 0.00, 0.90),
    TerrainClass.ROAD: (True, 0.00, 0.00, 0.00),
    TerrainClass.BARREN_ROCK: (True, 0.08, 0.20, 0.30),
}
"""The tuned values, spelled out so a silent edit to the table fails a test.

The sweeps read TERRAIN_PROFILES rather than this copy, so they keep testing
the wiring even while a value is being retuned; only this one test has to be
updated deliberately when a number changes.
"""


def classes_where(predicate) -> list[TerrainClass]:
    return [
        terrain_class
        for terrain_class in TerrainClass
        if predicate(TERRAIN_PROFILES[terrain_class])
    ]


CONCEALING_CLASSES = classes_where(lambda profile: profile.concealment > 0)
EXPOSED_CLASSES = classes_where(lambda profile: profile.concealment == 0)
OPAQUE_CLASSES = classes_where(lambda profile: profile.opacity_per_metre > 0)
TRANSPARENT_CLASSES = classes_where(lambda profile: profile.opacity_per_metre == 0)


def class_name(terrain_class: TerrainClass) -> str:
    return terrain_class.name


def test_every_class_has_the_documented_profile() -> None:
    assert set(TERRAIN_PROFILES) == set(TerrainClass)

    for terrain_class, expected in DOCUMENTED_PROFILES.items():
        profile = TERRAIN_PROFILES[terrain_class]
        assert (
            profile.passable,
            profile.opacity_per_metre,
            profile.concealment,
            profile.protection,
        ) == pytest.approx(expected), f"{terrain_class.name} profile drifted"


def test_the_sweeps_below_cover_every_class_on_every_axis() -> None:
    # Each axis is split into two parametrized cases by the value it carries;
    # a new class must land in one half of each split, or it goes untested.
    assert set(CONCEALING_CLASSES) | set(EXPOSED_CLASSES) == set(TerrainClass)
    assert set(OPAQUE_CLASSES) | set(TRANSPARENT_CLASSES) == set(TerrainClass)
    assert not set(CONCEALING_CLASSES) & set(EXPOSED_CLASSES)
    assert not set(OPAQUE_CLASSES) & set(TRANSPARENT_CLASSES)


# Movement: passable


@pytest.mark.parametrize("terrain_class", list(TerrainClass), ids=class_name)
def test_movement_admits_exactly_the_passable_classes(
    terrain_class: TerrainClass,
) -> None:
    soldier = Soldier(Team.BLUE, Position(x=0, y=0, z=0))
    destination = Position(x=1, y=0, z=0)
    battlefield = Battlefield(
        width=2,
        height=1,
        soldiers=[soldier],
        terrain={destination: terrain_class},
    )

    accepted = MovementResolver().verify_move_action(
        battlefield,
        soldier,
        MoveAction(direction=MoveDirection.EAST),
    )

    assert accepted is TERRAIN_PROFILES[terrain_class].passable


@pytest.mark.parametrize(
    "terrain_class",
    classes_where(lambda profile: not profile.passable),
    ids=class_name,
)
def test_impassable_rejection_names_the_terrain(
    terrain_class: TerrainClass,
) -> None:
    # The agent is told why a move failed, so the label has to reach the
    # rejection text rather than a bare "invalid move".
    soldier = Soldier(Team.BLUE, Position(x=0, y=0, z=0))
    destination = Position(x=1, y=0, z=0)
    battlefield = Battlefield(
        width=2,
        height=1,
        soldiers=[soldier],
        terrain={destination: terrain_class},
    )

    validation = MovementResolver().validate_move_action(
        battlefield,
        soldier,
        MoveAction(direction=MoveDirection.EAST),
    )

    assert not validation.valid
    assert validation.reason is not None
    assert f"impassable terrain ({TERRAIN_LABELS[terrain_class]})" in validation.reason


# Vision: concealment


def vision_rolling(roll: float) -> VisionResolver:
    """A resolver whose concealment roll is fixed, so the threshold is exact."""
    resolver = VisionResolver()
    resolver.rng.random = lambda: roll
    return resolver


def facing_enemy(terrain_class: TerrainClass) -> tuple[Battlefield, Soldier, Soldier]:
    """Adjacent observer and enemy, the enemy standing in the given class.

    Adjacency leaves no intervening cell, which keeps opacity out of the
    result: whatever the sightline does here, concealment decided it.
    """
    observer = Soldier(Team.BLUE, Position(x=0, y=0, z=0), vision_range=5)
    target = Soldier(Team.RED, Position(x=1, y=0, z=0), vision_range=5)
    battlefield = Battlefield(
        width=2,
        height=1,
        soldiers=[observer, target],
        terrain={target.position: terrain_class},
    )
    return battlefield, observer, target


@pytest.mark.parametrize("terrain_class", CONCEALING_CLASSES, ids=class_name)
def test_concealment_hides_a_target_below_its_own_threshold(
    terrain_class: TerrainClass,
) -> None:
    concealment = TERRAIN_PROFILES[terrain_class].concealment
    battlefield, observer, target = facing_enemy(terrain_class)

    # A roll under the class's own value hides the target; the same roll one
    # notch higher does not. Each class therefore has to be read individually,
    # not lumped in with whatever value the previous class carried.
    assert not vision_rolling(concealment - 0.01).verify_los(
        battlefield, observer, target
    )
    assert vision_rolling(concealment).verify_los(battlefield, observer, target)


@pytest.mark.parametrize("terrain_class", EXPOSED_CLASSES, ids=class_name)
def test_classes_without_concealment_never_hide_a_target(
    terrain_class: TerrainClass,
) -> None:
    # Water and structure are impassable, so no soldier should stand there in
    # play; the resolver still reads the cell it is given, and open ground that
    # started hiding people would be a serious regression.
    battlefield, observer, target = facing_enemy(terrain_class)

    assert vision_rolling(0.0).verify_los(battlefield, observer, target)


def test_concealment_comes_from_the_target_cell_not_the_observer_cell() -> None:
    # An observer sitting in dense forest is hidden from others, not blinded;
    # reading concealment from the wrong end of the sightline would invert that.
    observer = Soldier(Team.BLUE, Position(x=0, y=0, z=0), vision_range=5)
    target = Soldier(Team.RED, Position(x=1, y=0, z=0), vision_range=5)
    battlefield = Battlefield(
        width=2,
        height=1,
        soldiers=[observer, target],
        terrain={observer.position: TerrainClass.DENSE_FOREST},
    )

    assert vision_rolling(0.0).verify_los(battlefield, observer, target)


# Vision: opacity_per_metre


def uniform_corridor(width: int, terrain_class: TerrainClass) -> Battlefield:
    """Flat ground of one class, one metre per cell, so only opacity can block."""
    return Battlefield(
        width=width,
        height=1,
        soldiers=[],
        surface={Position(x=x, y=0, z=0) for x in range(width)},
        terrain=[terrain_class] * width,
    )


def long_sighted_resolver() -> VisionResolver:
    """Range large enough that distance never decides these tests."""
    return VisionResolver(max_vision_range=1000.0)


def sees_along(battlefield: Battlefield, target_x: int) -> bool:
    return long_sighted_resolver().verify_terrain_los(
        battlefield,
        Position(x=0, y=0, z=0),
        Position(x=target_x, y=0, z=0),
        observer_vision_range=1000.0,
    )


@pytest.mark.parametrize("terrain_class", OPAQUE_CLASSES, ids=class_name)
def test_opacity_blocks_sight_at_the_distance_its_value_implies(
    terrain_class: TerrainClass,
) -> None:
    # Opacity accumulates per metre, so each class has its own reach: sight
    # survives one cell short of 1.0 accumulated and dies past it. A class
    # blocking at the wrong distance -- or at the distance of a different
    # class -- fails one of these two assertions.
    opacity = TERRAIN_PROFILES[terrain_class].opacity_per_metre
    cells_to_block = ceil(1.0 / opacity)
    battlefield = uniform_corridor(cells_to_block + 3, terrain_class)

    # A target at x leaves x - 1 intervening cells at one metre each.
    assert sees_along(battlefield, cells_to_block)
    assert not sees_along(battlefield, cells_to_block + 2)


@pytest.mark.parametrize("terrain_class", TRANSPARENT_CLASSES, ids=class_name)
def test_classes_without_opacity_never_block_sight(
    terrain_class: TerrainClass,
) -> None:
    # Water is impassable but not opaque -- a soldier can be seen across a
    # river. Solidity and sight are separate axes and must stay separate.
    battlefield = uniform_corridor(60, terrain_class)

    assert sees_along(battlefield, 59)


def test_denser_terrain_blocks_sight_sooner_than_thinner_terrain() -> None:
    # The per-class tests each check one distance in isolation; this one checks
    # they rank correctly against each other, which is the property an agent
    # relies on when it prefers forest over scrub for cover.
    def first_blocked_distance(terrain_class: TerrainClass) -> int | None:
        battlefield = uniform_corridor(120, terrain_class)
        for target_x in range(1, 120):
            if not sees_along(battlefield, target_x):
                return target_x
        return None

    by_descending_opacity = sorted(
        OPAQUE_CLASSES,
        key=lambda terrain_class: TERRAIN_PROFILES[
            terrain_class
        ].opacity_per_metre,
        reverse=True,
    )
    distances = [
        first_blocked_distance(terrain_class)
        for terrain_class in by_descending_opacity
    ]

    assert None not in distances, "an opaque class never blocked within 120 m"
    assert distances == sorted(distances)


# Shooting: protection


@pytest.mark.parametrize("terrain_class", list(TerrainClass), ids=class_name)
def test_protection_reduces_the_hit_probability_of_every_class(
    terrain_class: TerrainClass,
) -> None:
    shooter = Soldier(Team.BLUE, Position(x=0, y=0, z=0))
    target = Soldier(Team.RED, Position(x=1, y=0, z=0))
    battlefield = Battlefield(
        width=2,
        height=1,
        soldiers=[shooter, target],
        terrain={target.position: terrain_class},
    )

    outcome = ShootingResolver(rng=Random(0)).resolve_shot(
        battlefield.snapshot(),
        0,
        ShootAction(target_position=target.position),
    )

    # Level ground, so the elevation modifier is out and protection is the only
    # thing between the base probability and the result.
    assert outcome is not None
    assert outcome.hit_probability == pytest.approx(
        BASE_HIT_PROBABILITY * (1.0 - TERRAIN_PROFILES[terrain_class].protection)
    )


def test_protection_shelters_the_target_not_the_shooter() -> None:
    # Firing from behind a wall must not make the shot harder to land; reading
    # protection from the shooter's cell would do exactly that.
    shooter = Soldier(Team.BLUE, Position(x=0, y=0, z=0))
    target = Soldier(Team.RED, Position(x=1, y=0, z=0))
    battlefield = Battlefield(
        width=2,
        height=1,
        soldiers=[shooter, target],
        terrain={shooter.position: TerrainClass.STRUCTURE},
    )

    outcome = ShootingResolver(rng=Random(0)).resolve_shot(
        battlefield.snapshot(),
        0,
        ShootAction(target_position=target.position),
    )

    assert outcome is not None
    assert outcome.hit_probability == pytest.approx(BASE_HIT_PROBABILITY)
