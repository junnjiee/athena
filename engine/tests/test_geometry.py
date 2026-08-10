import pytest

from athena.geometry import bearing_toward, squared_distance
from athena.models import MoveDirection, Position


def test_squared_distance_uses_all_three_axes() -> None:
    assert squared_distance(
        Position(x=1, y=2, z=3),
        Position(x=4, y=6, z=15),
    ) == 169


@pytest.mark.parametrize(
    ("end", "expected"),
    [
        (Position(x=0, y=-4, z=0), MoveDirection.NORTH),
        (Position(x=3, y=-3, z=0), MoveDirection.NORTHEAST),
        (Position(x=4, y=0, z=0), MoveDirection.EAST),
        (Position(x=3, y=3, z=0), MoveDirection.SOUTHEAST),
        (Position(x=0, y=4, z=0), MoveDirection.SOUTH),
        (Position(x=-3, y=3, z=0), MoveDirection.SOUTHWEST),
        (Position(x=-4, y=0, z=0), MoveDirection.WEST),
        (Position(x=-3, y=-3, z=0), MoveDirection.NORTHWEST),
    ],
)
def test_bearing_toward_uses_battlefield_orientation(
    end: Position,
    expected: MoveDirection,
) -> None:
    assert bearing_toward(Position(x=0, y=0, z=0), end) == expected


def test_bearing_is_absent_for_the_same_xy_cell() -> None:
    assert bearing_toward(
        Position(x=2, y=3, z=0),
        Position(x=2, y=3, z=4),
    ) is None
