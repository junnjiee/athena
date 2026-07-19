from random import Random

import pytest

from athena.battlefield import Battlefield
from athena.loop import LoopEngine
from athena.resolvers.movement import MovementResolver
from athena.resolvers.vision import VisionResolver
from athena.soldier import Soldier
from athena.types import Position, SurvivalState, Team


def surface_for(*positions: Position) -> set[Position]:
    return set(positions)


def test_high_ground_extends_vision_and_low_ground_reduces_it() -> None:
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

    assert resolver.verify_los(battlefield, high, low)
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

    visible_friendly = loop.visible_soldiers_map()[0].soldiers[0]

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


def test_effective_vision_range_has_minimum_of_one_cell() -> None:
    resolver = VisionResolver()

    assert resolver.is_in_vision_range(
        Position(x=0, y=0, z=0),
        Position(x=1, y=0, z=20),
        observer_vision_range=5,
    )
    assert not resolver.is_in_vision_range(
        Position(x=0, y=0, z=0),
        Position(x=2, y=0, z=20),
        observer_vision_range=5,
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
        cover={cover},
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
        cover={cover},
    )

    assert VisionResolver().verify_los(battlefield, observer, target)


def test_concealment_detection_still_uses_xyz_target_position() -> None:
    observer = Soldier(Team.BLUE, Position(x=0, y=0, z=1), vision_range=5)
    target = Soldier(Team.RED, Position(x=1, y=0, z=0), vision_range=5)
    battlefield = Battlefield(
        width=2,
        height=1,
        soldiers=[observer, target],
        surface={observer.position, target.position},
        concealment={target.position},
    )

    assert not VisionResolver(
        concealment_detection_penalty=1.0,
        rng=Random(0),
    ).verify_los(battlefield, observer, target)


def test_nearby_terrain_includes_every_in_range_cell_with_attributes() -> None:
    observer = Soldier(Team.BLUE, Position(x=0, y=0, z=2), vision_range=2)
    distant_cover = Position(x=4, y=0, z=0)
    concealed_position = Position(x=2, y=0, z=0)
    battlefield = Battlefield(
        width=6,
        height=1,
        soldiers=[observer],
        surface={
            Position(x=x, y=0, z=2 if x == 0 else 0)
            for x in range(6)
        },
        cover={distant_cover},
        concealment={concealed_position},
    )
    loop = LoopEngine(
        battlefield=battlefield,
        vision_resolver=VisionResolver(),
        movement_resolver=MovementResolver(),
    )

    cells = loop.nearby_terrain_map()[0].cells

    assert [cell.position for cell in cells] == [
        Position(x=0, y=0, z=2),
        Position(x=1, y=0, z=0),
        Position(x=2, y=0, z=0),
        Position(x=3, y=0, z=0),
        Position(x=4, y=0, z=0),
    ]
    assert cells[2].has_concealment
    assert not cells[2].has_cover
    assert cells[4].has_cover
    assert not cells[4].has_concealment


def test_in_range_terrain_behind_hill_remains_available_for_navigation() -> None:
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

    assert behind_hill in {
        cell.position for cell in loop.nearby_terrain_map()[0].cells
    }
