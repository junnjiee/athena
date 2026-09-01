from collections.abc import Mapping, Sequence

from athena.models import (
    BattlefieldSnapshot,
    CommunicationGroup,
    Position,
    SoldierSnapshot,
    TerrainClass,
    TerrainProfile,
)
from athena.params import DEFAULT_TERRAIN_CLASS, TERRAIN_PROFILES
from athena.world_state.soldier import Soldier


class Battlefield:
    width: int
    height: int
    surface: frozenset[Position]
    soldiers: list[Soldier]
    terrain_classes: tuple[TerrainClass, ...]
    communication_groups: tuple[CommunicationGroup, ...]

    def __init__(
        self,
        width: int,
        height: int,
        soldiers: list[Soldier],
        surface: set[Position] | frozenset[Position] | None = None,
        terrain: Mapping[Position, TerrainClass] | Sequence[int] | None = None,
        communication_groups: list[CommunicationGroup]
        | tuple[CommunicationGroup, ...]
        | None = None,
    ) -> None:
        """Build a battlefield.

        ``terrain`` accepts either a sparse mapping of position to class, which
        suits hand-authored scenarios, or a dense row-major sequence of class
        indices, which suits bulk import. Unlisted cells default to open ground.
        """
        self.width = width
        self.height = height
        self.surface = frozenset(
            surface
            if surface is not None
            else (
                Position(x=x, y=y, z=0)
                for x in range(width)
                for y in range(height)
            )
        )
        self.soldiers = soldiers
        self.terrain_classes = self._build_terrain_classes(terrain)
        self.communication_groups = tuple(communication_groups or ())
        self._communication_groups_by_id = self._validate_communication_groups()
        self._surface_by_xy = self._validate_surface()
        self._validate_occupants()

    def _build_terrain_classes(
        self,
        terrain: Mapping[Position, TerrainClass] | Sequence[int] | None,
    ) -> tuple[TerrainClass, ...]:
        cell_count = self.width * self.height

        if terrain is None:
            return (DEFAULT_TERRAIN_CLASS,) * cell_count

        if isinstance(terrain, Mapping):
            classes = [DEFAULT_TERRAIN_CLASS] * cell_count
            for position, terrain_class in terrain.items():
                if not self.in_bounds(position):
                    raise ValueError(
                        f"terrain position is outside the battlefield: {position}"
                    )
                classes[self._index(position.x, position.y)] = TerrainClass(
                    terrain_class
                )
            return tuple(classes)

        if len(terrain) != cell_count:
            raise ValueError(
                f"terrain grid has {len(terrain)} cells; "
                f"expected {cell_count} for {self.width}x{self.height}"
            )
        return tuple(TerrainClass(value) for value in terrain)

    def _index(self, x: int, y: int) -> int:
        """Row-major offset into the flat terrain grid."""
        return y * self.width + x

    def terrain_at(self, x: int, y: int) -> TerrainClass:
        return self.terrain_classes[self._index(x, y)]

    def profile_at(self, x: int, y: int) -> TerrainProfile:
        return TERRAIN_PROFILES[self.terrain_at(x, y)]

    def terrain_for(self, position: Position) -> TerrainClass:
        return self.terrain_at(position.x, position.y)

    def profile_for(self, position: Position) -> TerrainProfile:
        return self.profile_at(position.x, position.y)

    def _validate_communication_groups(self) -> dict[str, CommunicationGroup]:
        groups_by_id: dict[str, CommunicationGroup] = {}
        for group in self.communication_groups:
            if group.group_id in groups_by_id:
                raise ValueError(
                    f"duplicate communication group id: {group.group_id}"
                )
            groups_by_id[group.group_id] = group
        return groups_by_id

    def _validate_surface(self) -> dict[tuple[int, int], Position]:
        expected_coordinates = {
            (x, y) for x in range(self.width) for y in range(self.height)
        }
        surface_by_xy: dict[tuple[int, int], Position] = {}

        for position in self.surface:
            coordinate = (position.x, position.y)
            if coordinate in surface_by_xy:
                raise ValueError(
                    f"battlefield surface has multiple elevations at {coordinate}"
                )
            surface_by_xy[coordinate] = position

        if set(surface_by_xy) != expected_coordinates:
            raise ValueError("battlefield surface must define one position per x/y cell")

        return surface_by_xy

    def _validate_occupants(self) -> None:
        for soldier in self.soldiers:
            if not self.is_surface_position(soldier.position):
                raise ValueError(
                    f"soldier position is not on the battlefield surface: "
                    f"{soldier.position}"
                )
            for group_id in soldier.communication_group_ids:
                group = self._communication_groups_by_id.get(group_id)
                if group is None:
                    raise ValueError(
                        f"soldier references unknown communication group: {group_id}"
                    )
                if group.team != soldier.team:
                    raise ValueError(
                        "soldier cannot join a communication group from another team: "
                        f"{group_id}"
                    )

    def in_bounds(self, position: Position) -> bool:
        return 0 <= position.x < self.width and 0 <= position.y < self.height

    def position_at(self, x: int, y: int) -> Position | None:
        return self._surface_by_xy.get((x, y))

    def is_surface_position(self, position: Position) -> bool:
        return self.position_at(position.x, position.y) == position

    def communication_group(self, group_id: str) -> CommunicationGroup | None:
        return self._communication_groups_by_id.get(group_id)

    def communication_groups_for(
        self,
        soldier: Soldier,
    ) -> tuple[CommunicationGroup, ...]:
        return tuple(
            group
            for group in self.communication_groups
            if group.group_id in soldier.communication_group_ids
        )

    def snapshot(self) -> BattlefieldSnapshot:
        """Capture immutable global truth for execution and replay."""
        return BattlefieldSnapshot(
            width=self.width,
            height=self.height,
            surface=frozenset(self.surface),
            soldiers=tuple(
                SoldierSnapshot(
                    soldier_index=index,
                    team=soldier.team,
                    position=soldier.position,
                    survival_status=soldier.survival_status,
                    vision_range=soldier.vision_range,
                    suppressed=soldier.suppressed,
                    communication_group_ids=soldier.communication_group_ids,
                )
                for index, soldier in enumerate(self.soldiers)
            ),
            communication_groups=self.communication_groups,
            terrain_classes=self.terrain_classes,
        )
