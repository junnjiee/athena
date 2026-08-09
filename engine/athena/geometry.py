"""Shared geometry calculations for grid positions."""

from math import atan2, floor, pi

from athena.models.actions import MoveDirection
from athena.models.common import Position


def squared_distance(start: Position, end: Position) -> int:
    """Return full 3D Euclidean distance squared between two grid cells."""
    dx = end.x - start.x
    dy = end.y - start.y
    dz = end.z - start.z
    return dx * dx + dy * dy + dz * dz


def bearing_toward(start: Position, end: Position) -> MoveDirection | None:
    """Return the nearest eight-way grid bearing from start toward end."""
    dx = end.x - start.x
    dy = end.y - start.y
    if dx == 0 and dy == 0:
        return None

    directions = (
        MoveDirection.EAST,
        MoveDirection.SOUTHEAST,
        MoveDirection.SOUTH,
        MoveDirection.SOUTHWEST,
        MoveDirection.WEST,
        MoveDirection.NORTHWEST,
        MoveDirection.NORTH,
        MoveDirection.NORTHEAST,
    )
    octant = floor((atan2(dy, dx) + pi / 8) / (pi / 4)) % 8
    return directions[octant]
