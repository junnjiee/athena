import pytest
from pydantic import ValidationError

from athena.world_state import Battlefield, Soldier
from athena.models import CommunicationGroup, Position, Team, TerrainClass


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


def test_terrain_defaults_to_open_ground_everywhere() -> None:
    battlefield = Battlefield(width=3, height=2, soldiers=[])

    assert battlefield.terrain_classes == (TerrainClass.OPEN_GROUND,) * 6
    assert battlefield.profile_at(2, 1).passable


def test_sparse_terrain_mapping_places_classes_row_major() -> None:
    battlefield = Battlefield(
        width=3,
        height=2,
        soldiers=[],
        terrain={
            Position(x=2, y=1, z=0): TerrainClass.STRUCTURE,
            Position(x=0, y=1, z=0): TerrainClass.DENSE_FOREST,
        },
    )

    # Row-major: (x=0,y=1) is index 3 and (x=2,y=1) is index 5.
    assert battlefield.terrain_classes[3] == TerrainClass.DENSE_FOREST
    assert battlefield.terrain_classes[5] == TerrainClass.STRUCTURE
    assert battlefield.terrain_at(2, 1) == TerrainClass.STRUCTURE
    assert battlefield.terrain_at(1, 0) == TerrainClass.OPEN_GROUND


def test_dense_terrain_sequence_is_accepted_for_bulk_import() -> None:
    classes = [TerrainClass.ROAD] * 4
    classes[1] = TerrainClass.WATER

    battlefield = Battlefield(width=2, height=2, soldiers=[], terrain=classes)

    assert battlefield.terrain_at(1, 0) == TerrainClass.WATER
    assert not battlefield.profile_at(1, 0).passable
    assert battlefield.profile_at(0, 0).move_cost == 0.8


def test_dense_terrain_sequence_must_match_grid_size() -> None:
    with pytest.raises(ValueError, match="expected 6"):
        Battlefield(width=3, height=2, soldiers=[], terrain=[TerrainClass.ROAD] * 5)


def test_terrain_mapping_rejects_out_of_bounds_position() -> None:
    with pytest.raises(ValueError, match="outside the battlefield"):
        Battlefield(
            width=2,
            height=2,
            soldiers=[],
            terrain={Position(x=9, y=0, z=0): TerrainClass.STRUCTURE},
        )


def test_terrain_classes_are_captured_in_snapshot() -> None:
    battlefield = Battlefield(
        width=2,
        height=1,
        soldiers=[],
        terrain={Position(x=0, y=0, z=0): TerrainClass.WETLAND},
    )

    assert battlefield.snapshot().terrain_classes == (
        TerrainClass.WETLAND,
        TerrainClass.OPEN_GROUND,
    )
