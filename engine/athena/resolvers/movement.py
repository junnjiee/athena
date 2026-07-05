from athena.battlefield import Battlefield
from athena.soldier import Soldier
from athena.types import MoveAction, MoveDirection, Position, SurvivalState


MOVE_DIRECTION_DELTAS: dict[MoveDirection, tuple[int, int]] = {
    MoveDirection.NORTH: (0, -1),
    MoveDirection.NORTHEAST: (1, -1),
    MoveDirection.EAST: (1, 0),
    MoveDirection.SOUTHEAST: (1, 1),
    MoveDirection.SOUTH: (0, 1),
    MoveDirection.SOUTHWEST: (-1, 1),
    MoveDirection.WEST: (-1, 0),
    MoveDirection.NORTHWEST: (-1, -1),
}


class MovementResolver:
    def resolve_move_position(
        self,
        soldier: Soldier,
        action: MoveAction,
    ) -> Position:
        x_delta, y_delta = MOVE_DIRECTION_DELTAS[action.direction]
        return Position(
            x=soldier.position.x + x_delta,
            y=soldier.position.y + y_delta,
        )

    def verify_move_action(
        self,
        battlefield: Battlefield,
        soldier: Soldier,
        action: MoveAction,
    ) -> bool:
        return self.verify_move(
            battlefield,
            soldier,
            self.resolve_move_position(soldier, action),
        )

    def verify_move(
        self,
        battlefield: Battlefield,
        soldier: Soldier,
        new_position: Position,
    ) -> bool:
        """
        Returns a boolean representing whether soldier can move to the new position.
        Does not move the soldier itself.
        """
        if soldier.survival_status != SurvivalState.ALIVE:
            return False

        if not battlefield.in_bounds(new_position):
            return False

        if not self._is_single_step(soldier.position, new_position):
            return False

        if new_position in battlefield.cover:
            return False

        return True

    def _is_single_step(self, old_position: Position, new_position: Position) -> bool:
        x_distance = abs(new_position.x - old_position.x)
        y_distance = abs(new_position.y - old_position.y)
        return max(x_distance, y_distance) == 1
