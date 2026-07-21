from random import Random

from athena.world_state import Battlefield, Soldier
from athena.models import (
    ActionValidationResult,
    MoveAction,
    MoveDirection,
    Position,
    SurvivalState,
)
from athena.params import MAX_ELEVATION_CHANGE


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
    def __init__(
        self,
        max_elevation_change: int = MAX_ELEVATION_CHANGE,
        rng: Random | None = None,
    ) -> None:
        """Treat elevation as terrain, not as a separate vertical move action."""
        self.max_elevation_change = max_elevation_change
        self.rng = rng or Random()

    def select_competing_mover(self, soldier_indices: list[int]) -> int:
        """Select one uniformly random winner for a contested destination."""
        return self.rng.choice(soldier_indices)

    def resolve_move_position(
        self,
        battlefield: Battlefield,
        soldier: Soldier,
        action: MoveAction,
    ) -> Position | None:
        x_delta, y_delta = MOVE_DIRECTION_DELTAS[action.direction]
        return battlefield.position_at(
            soldier.position.x + x_delta,
            soldier.position.y + y_delta,
        )

    def verify_move_action(
        self,
        battlefield: Battlefield,
        soldier: Soldier,
        action: MoveAction,
    ) -> bool:
        return self.validate_move_action(battlefield, soldier, action).valid

    def validate_move_action(
        self,
        battlefield: Battlefield,
        soldier: Soldier,
        action: MoveAction,
    ) -> ActionValidationResult:
        new_position = self.resolve_move_position(battlefield, soldier, action)
        if new_position is None:
            return ActionValidationResult.rejected(
                f"Moving {action.direction.value} would leave the battlefield."
            )
        return self.validate_move(battlefield, soldier, new_position)

    def validate_move(
        self,
        battlefield: Battlefield,
        soldier: Soldier,
        new_position: Position,
    ) -> ActionValidationResult:
        if soldier.survival_status != SurvivalState.ALIVE:
            return ActionValidationResult.rejected("Only an alive soldier can move.")

        if not battlefield.in_bounds(new_position):
            return ActionValidationResult.rejected(
                f"Destination {new_position.model_dump_json()} is outside the battlefield."
            )

        if not battlefield.is_surface_position(new_position):
            return ActionValidationResult.rejected(
                f"Destination {new_position.model_dump_json()} does not match the battlefield surface."
            )

        if not self._is_single_step(soldier.position, new_position):
            return ActionValidationResult.rejected(
                f"Destination {new_position.model_dump_json()} is not one grid step away."
            )

        elevation_change = abs(new_position.z - soldier.position.z)
        if elevation_change > self.max_elevation_change:
            return ActionValidationResult.rejected(
                f"Destination elevation differs by {elevation_change} levels; "
                f"the maximum is {self.max_elevation_change}."
            )

        if new_position in battlefield.cover:
            return ActionValidationResult.rejected(
                f"Destination {new_position.model_dump_json()} contains impassable cover."
            )

        return ActionValidationResult.accepted()

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
        return self.validate_move(battlefield, soldier, new_position).valid

    def _is_single_step(self, old_position: Position, new_position: Position) -> bool:
        x_distance = abs(new_position.x - old_position.x)
        y_distance = abs(new_position.y - old_position.y)
        return max(x_distance, y_distance) == 1
