import pytest
from pydantic import ValidationError

from athena.world_state import Battlefield, Soldier
from athena.models import CommunicationGroup, Position, Team


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


def test_communication_group_membership_is_captured_in_snapshot() -> None:
    group = CommunicationGroup(
        group_id="blue-alpha",
        name="Blue Alpha",
        team=Team.BLUE,
    )
    soldier = Soldier(
        Team.BLUE,
        Position(x=0, y=0, z=0),
        communication_group_ids={group.group_id},
    )

    snapshot = Battlefield(
        width=1,
        height=1,
        soldiers=[soldier],
        communication_groups=[group],
    ).snapshot()

    assert snapshot.communication_groups == (group,)
    assert snapshot.soldiers[0].communication_group_ids == frozenset(
        {group.group_id}
    )


def test_rejects_unknown_communication_group_membership() -> None:
    soldier = Soldier(
        Team.BLUE,
        Position(x=0, y=0, z=0),
        communication_group_ids={"missing"},
    )

    with pytest.raises(ValueError, match="unknown communication group"):
        Battlefield(width=1, height=1, soldiers=[soldier])


def test_rejects_cross_team_communication_group_membership() -> None:
    red_group = CommunicationGroup(
        group_id="red-hq",
        name="Red HQ",
        team=Team.RED,
    )
    blue_soldier = Soldier(
        Team.BLUE,
        Position(x=0, y=0, z=0),
        communication_group_ids={red_group.group_id},
    )

    with pytest.raises(ValueError, match="another team"):
        Battlefield(
            width=1,
            height=1,
            soldiers=[blue_soldier],
            communication_groups=[red_group],
        )
