from random import Random

from athena.geometry import squared_distance
from athena.world_state import Battlefield, Soldier
from athena.models import (
    TERRAIN_LABELS,
    ActionValidationResult,
    MoveAction,
    MoveDirection,
    Position,
    SurvivalState,
)
from athena.params import (
    MARCH_MOVE_BUDGET,
    MAX_ELEVATION_CHANGE,
    MAX_MOVE_DISTANCE,
)


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

    def movement_allowance(self, battlefield: Battlefield, soldier: Soldier) -> float:
        """What this soldier may spend on movement this tick.

        A soldier out of contact marches; one that can see an enemy or is under
        fire moves at the pace its gait was drawn with. Forces cross open ground
        quickly and close ground slowly, which is both how they actually move and
        what makes a kilometre-wide plan simulable: at a fighting pace the
        approach alone outran any sensible tick budget, and every one of those
        ticks was a decision nobody needed to make.

        Contact is judged on range alone -- a living enemy within this soldier's
        vision range -- rather than on line of sight. That is deliberately the
        conservative half of the test: a soldier slows down for an enemy it
        cannot yet see past a rise, but never marches into one it can. It also
        keeps this resolver self-contained, with no vision resolver to inject.
        """
        if soldier.suppressed:
            return soldier.move_budget

        range_squared = soldier.vision_range * soldier.vision_range
        for other in battlefield.soldiers:
            if other.team == soldier.team:
                continue
            if other.survival_status != SurvivalState.ALIVE:
                continue
            if squared_distance(soldier.position, other.position) <= range_squared:
                return soldier.move_budget

        return max(soldier.move_budget, MARCH_MOVE_BUDGET)

    def resolve_move_path(
        self,
        battlefield: Battlefield,
        soldier: Soldier,
        action: MoveAction,
    ) -> list[Position]:
        """Cells the soldier actually reaches, in order; empty if it cannot step.

        A move is walked one cell at a time along the chosen direction and stops
        at the first cell that cannot be entered, rather than being rejected
        outright. An agent choosing a distance is working from a drawn map with
        a blank where it cannot see, so demanding it predict the exact stopping
        point would spend a retry -- and another model call -- on ground it was
        never shown. Travelling as far as the ground allows is one rule, and the
        soldier's own next observation reports where it ended up.

        Entering a cell spends that cell's ``move_cost`` against the soldier's
        per-tick allowance. That is the only consumer of ``move_cost``: before
        this, road and wetland cost a soldier exactly the same.

        Occupancy uses the pre-tick positions, so a soldier stops on reaching
        another soldier rather than walking through it. The reached cell may
        itself be occupied -- whether that move is allowed is decided across the
        whole batch in ``LoopEngine._resolve_move_destinations``, which is what
        keeps two-soldier swaps working.
        """
        x_delta, y_delta = MOVE_DIRECTION_DELTAS[action.direction]
        occupied = {
            (other.position.x, other.position.y)
            for other in battlefield.soldiers
            if other is not soldier
        }

        path: list[Position] = []
        current = soldier.position
        budget = self.movement_allowance(battlefield, soldier)

        for _ in range(min(action.distance, MAX_MOVE_DISTANCE)):
            step = battlefield.position_at(current.x + x_delta, current.y + y_delta)
            if step is None:
                break
            if abs(step.z - current.z) > self.max_elevation_change:
                break
            profile = battlefield.profile_for(step)
            if not profile.passable:
                break
            if profile.move_cost > budget:
                break

            budget -= profile.move_cost
            path.append(step)
            current = step
            if (step.x, step.y) in occupied:
                break

        return path

    def resolve_move_position(
        self,
        battlefield: Battlefield,
        soldier: Soldier,
        action: MoveAction,
    ) -> Position | None:
        """Where the soldier ends up, or None when it cannot take a single step."""
        path = self.resolve_move_path(battlefield, soldier, action)
        return path[-1] if path else None

    def first_step_position(
        self,
        battlefield: Battlefield,
        soldier: Soldier,
        action: MoveAction,
    ) -> Position | None:
        """The adjacent cell a move sets off into, legal or not.

        A rejected move is rejected because of this cell -- it is what
        ``_first_step_rejection`` describes -- so it is also the cell whose
        visibility decides whether the soldier may be told the real reason.
        """
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
        """A move is legal when its first cell is enterable.

        Everything beyond the first cell shortens the move instead of failing it
        (see ``resolve_move_path``), so this only has to explain why a soldier
        could not set off at all.
        """
        if soldier.survival_status != SurvivalState.ALIVE:
            return ActionValidationResult.rejected("Only an alive soldier can move.")

        if self.resolve_move_path(battlefield, soldier, action):
            return ActionValidationResult.accepted()

        return ActionValidationResult.rejected(
            self._first_step_rejection(battlefield, soldier, action)
        )

    def _first_step_rejection(
        self,
        battlefield: Battlefield,
        soldier: Soldier,
        action: MoveAction,
    ) -> str:
        """Why the soldier could not take even one step in this direction."""
        x_delta, y_delta = MOVE_DIRECTION_DELTAS[action.direction]
        step = battlefield.position_at(
            soldier.position.x + x_delta,
            soldier.position.y + y_delta,
        )
        direction = action.direction.value

        if step is None:
            return f"Moving {direction} would leave the battlefield."

        elevation_change = abs(step.z - soldier.position.z)
        if elevation_change > self.max_elevation_change:
            return (
                f"Moving {direction} climbs {elevation_change} elevation levels; "
                f"the maximum is {self.max_elevation_change}."
            )

        profile = battlefield.profile_for(step)
        if not profile.passable:
            terrain_label = TERRAIN_LABELS[battlefield.terrain_for(step)]
            return (
                f"Moving {direction} enters impassable terrain ({terrain_label})."
            )

        return (
            f"Moving {direction} costs {profile.move_cost:g} but your movement "
            f"allowance is {soldier.move_budget:g}."
        )

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

        if not battlefield.profile_for(new_position).passable:
            terrain_label = TERRAIN_LABELS[battlefield.terrain_for(new_position)]
            return ActionValidationResult.rejected(
                f"Destination {new_position.model_dump_json()} is impassable "
                f"terrain ({terrain_label})."
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
