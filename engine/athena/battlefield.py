from athena.soldier import Soldier
from athena.types import BattlefieldSnapshot, Position, SoldierSnapshot


class Battlefield:
    width: int
    height: int
    surface: frozenset[Position]
    soldiers: list[Soldier]
    cover: set[Position]
    concealment: set[Position]

    def __init__(
        self,
        width: int,
        height: int,
        soldiers: list[Soldier],
        surface: set[Position] | frozenset[Position] | None = None,
        cover: set[Position] | None = None,
        concealment: set[Position] | None = None,
    ) -> None:
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
        self.cover = cover or set()
        self.concealment = concealment or set()
        self._surface_by_xy = self._validate_surface()
        self._validate_occupants()

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

        for terrain_name, positions in (
            ("cover", self.cover),
            ("concealment", self.concealment),
        ):
            for position in positions:
                if not self.is_surface_position(position):
                    raise ValueError(
                        f"{terrain_name} position is not on the battlefield surface: "
                        f"{position}"
                    )

    def in_bounds(self, position: Position) -> bool:
        return 0 <= position.x < self.width and 0 <= position.y < self.height

    def position_at(self, x: int, y: int) -> Position | None:
        return self._surface_by_xy.get((x, y))

    def is_surface_position(self, position: Position) -> bool:
        return self.position_at(position.x, position.y) == position

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
                )
                for index, soldier in enumerate(self.soldiers)
            ),
            cover=frozenset(self.cover),
            concealment=frozenset(self.concealment),
        )
