"""Routing over ground a soldier can actually walk on.

The failure this exists for was visible in a real run: a river across the axis
stopped a whole force at the bank, where it stood and traded fire across the
water for the rest of the run. Greedy bearing-plus-a-few-offsets cannot get
round an obstacle; it walks into one.
"""

from athena.navigation import UNREACHABLE, Navigator
from athena.models import Position, Team, TerrainClass
from athena.world_state import Battlefield, Soldier


def _ground(width: int, height: int, water: set[tuple[int, int]]) -> Battlefield:
    terrain = [
        TerrainClass.WATER if (x, y) in water else TerrainClass.OPEN_GROUND
        for y in range(height)
        for x in range(width)
    ]
    return Battlefield(
        width=width,
        height=height,
        soldiers=[],
        surface={Position(x=x, y=y, z=0) for x in range(width) for y in range(height)},
        terrain=terrain,
    )


def test_a_route_goes_round_a_river_rather_than_into_it() -> None:
    # A river across the middle with a gap at the eastern end.
    water = {(x, 5) for x in range(0, 9)}
    battlefield = _ground(10, 11, water)
    navigator = Navigator()

    route = navigator.route(
        battlefield, Position(x=0, y=0, z=0), Position(x=0, y=10, z=0), limit=40
    )

    assert route, "no route found round the river"
    assert all((step.x, step.y) not in water for step in route)
    # It must reach the far bank, which means going out to the gap and back.
    assert any(step.y > 5 for step in route)


def test_distance_reflects_the_detour_not_the_straight_line() -> None:
    water = {(x, 5) for x in range(0, 9)}
    battlefield = _ground(10, 11, water)
    navigator = Navigator()

    across = navigator.distance_to(
        battlefield, Position(x=0, y=0, z=0), Position(x=0, y=10, z=0)
    )

    # Straight line is 10; the detour to the gap at x=9 and back is longer.
    assert across > 10


def test_ground_with_no_crossing_reports_unreachable() -> None:
    # A river with no gap: the far bank cannot be reached at all, and a soldier
    # should be told that rather than walked into the water.
    water = {(x, 5) for x in range(10)}
    battlefield = _ground(10, 11, water)
    navigator = Navigator()

    assert navigator.distance_to(
        battlefield, Position(x=0, y=0, z=0), Position(x=0, y=10, z=0)
    ) == UNREACHABLE
    assert navigator.route(
        battlefield, Position(x=0, y=0, z=0), Position(x=0, y=10, z=0), limit=40
    ) == []


def test_open_ground_routes_straight() -> None:
    battlefield = _ground(10, 10, set())
    navigator = Navigator()

    route = navigator.route(
        battlefield, Position(x=0, y=0, z=0), Position(x=5, y=0, z=0), limit=10
    )

    assert [step.x for step in route] == [1, 2, 3, 4, 5]


def test_a_field_is_computed_once_per_target() -> None:
    # Every soldier reads the same field every tick; recomputing per soldier is
    # what makes real routing unaffordable.
    battlefield = _ground(20, 20, set())
    navigator = Navigator()
    target = Position(x=10, y=10, z=0)

    first = navigator.field(battlefield, target)
    again = navigator.field(battlefield, target)

    assert first is again


def test_elevation_is_respected_the_same_way_movement_respects_it() -> None:
    # A cliff is as impassable as water, and a route that promised to cross one
    # would be a route no soldier could walk.
    surface = set()
    for x in range(6):
        for y in range(3):
            surface.add(Position(x=x, y=y, z=0 if y < 2 else 9))
    battlefield = Battlefield(width=6, height=3, soldiers=[], surface=surface)

    assert Navigator(max_elevation_change=1).distance_to(
        battlefield, Position(x=0, y=0, z=0), Position(x=0, y=2, z=9)
    ) == UNREACHABLE
