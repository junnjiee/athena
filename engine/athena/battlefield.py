from athena.soldier import Soldier
from athena.types import BattlefieldSnapshot, Position, SoldierSnapshot


class Battlefield:
    width: int
    height: int
    soldiers: list[Soldier]
    cover: set[Position]
    concealment: set[Position]

    def __init__(
        self,
        width: int,
        height: int,
        soldiers: list[Soldier],
        cover: set[Position] | None = None,
        concealment: set[Position] | None = None,
    ) -> None:
        self.width = width
        self.height = height
        self.soldiers = soldiers
        self.cover = cover or set()
        self.concealment = concealment or set()

    def in_bounds(self, position: Position) -> bool:
        return 0 <= position.x < self.width and 0 <= position.y < self.height

    def snapshot(self) -> BattlefieldSnapshot:
        """Capture immutable global truth for execution and replay."""
        return BattlefieldSnapshot(
            width=self.width,
            height=self.height,
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
