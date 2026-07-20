import pytest
from pydantic import ValidationError

from athena.world_state import Battlefield, Soldier
from athena.types import Position, Team


def test_position_requires_xyz_coordinates() -> None:
    with pytest.raises(ValidationError):
        Position.model_validate({"x": 0, "y": 0})


def test_custom_surface_is_captured_in_snapshot() -> None:
    surface = {
        Position(x=0, y=0, z=0),
        Position(x=1, y=0, z=1),
    }
    soldier = Soldier(Team.BLUE, Position(x=1, y=0, z=1))

    battlefield = Battlefield(
        width=2,
        height=1,
        soldiers=[soldier],
        surface=surface,
    )

    assert battlefield.position_at(1, 0) == Position(x=1, y=0, z=1)
    assert battlefield.snapshot().surface == frozenset(surface)


def test_surface_requires_exactly_one_elevation_per_xy_cell() -> None:
    with pytest.raises(ValueError, match="multiple elevations"):
        Battlefield(
            width=1,
            height=1,
            soldiers=[],
            surface={
                Position(x=0, y=0, z=0),
                Position(x=0, y=0, z=1),
            },
        )


def test_surface_cannot_omit_an_xy_cell() -> None:
    with pytest.raises(ValueError, match="one position per x/y cell"):
        Battlefield(
            width=2,
            height=1,
            soldiers=[],
            surface={Position(x=0, y=0, z=0)},
        )


def test_rejects_soldier_position_that_is_not_on_surface() -> None:
    soldier = Soldier(Team.BLUE, Position(x=0, y=0, z=1))

    with pytest.raises(ValueError, match="soldier position"):
        Battlefield(width=1, height=1, soldiers=[soldier])
