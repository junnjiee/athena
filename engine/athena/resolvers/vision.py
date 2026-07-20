from math import inf
from random import Random

from athena.world_state import Battlefield, Soldier
from athena.models import Position, SurvivalState


SOLDIER_EYE_HEIGHT = 1.0
MAX_VISION_RANGE = 100.0
"""Hard ceiling on how far any soldier can see, regardless of vision or elevation."""


class VisionResolver:
    def __init__(
        self,
        concealment_detection_penalty: float = 0.0,
        max_vision_range: float = MAX_VISION_RANGE,
        rng: Random | None = None,
    ) -> None:
        self.concealment_detection_penalty = concealment_detection_penalty
        self.max_vision_range = max_vision_range
        self.rng = rng or Random()

    def verify_los(
        self,
        battlefield: Battlefield,
        observer: Soldier,
        target: Soldier,
    ) -> bool:
        """
        Checks if two soldiers have positive line of sight (LOS) between each other.

        Terrain elevation blocks sight for both teams. Alive observers can see
        friendly soldiers in any survival state; friendlies otherwise ignore cover
        and concealment once range and terrain LOS pass.

        Opposing soldiers must be alive, within range, and have no blocking cover
        in-between. A concealed target reduces chance of detection by a fixed
        probability.
        """
        if observer is target:
            return False
        if observer.survival_status != SurvivalState.ALIVE:
            return False

        if not self.is_in_vision_range(
            observer.position,
            target.position,
            observer.vision_range,
        ):
            return False

        if self._terrain_blocks_los(
            battlefield,
            observer.position,
            target.position,
        ):
            return False

        if observer.team == target.team:
            return True

        if target.survival_status != SurvivalState.ALIVE:
            return False

        if self._hard_cover_blocks_los(battlefield, observer.position, target.position):
            return False

        if target.position in battlefield.concealment:
            detection_probability = 1.0 - self.concealment_detection_penalty
            return self.rng.random() <= max(0.0, min(1.0, detection_probability))

        return True

    def verify_terrain_los(
        self,
        battlefield: Battlefield,
        observer_position: Position,
        cell_position: Position,
        observer_vision_range: float,
    ) -> bool:
        """Whether an observer can perceive a terrain cell: in range and not hidden behind intervening terrain."""
        if not self.is_in_vision_range(
            observer_position,
            cell_position,
            observer_vision_range,
        ):
            return False

        return not self._terrain_blocks_los(
            battlefield,
            observer_position,
            cell_position,
        )

    def _terrain_blocks_los(
        self,
        battlefield: Battlefield,
        observer_position: Position,
        target_position: Position,
    ) -> bool:
        """Return whether the battlefield surface intersects the soldiers' sightline.

        A soldier's eye is one elevation level above its ground position. For each
        intervening cell, compare the terrain height with the eye-to-eye line at
        that cell's projected center. Meeting the line is enough to block sight.
        """
        dx = target_position.x - observer_position.x
        dy = target_position.y - observer_position.y
        horizontal_distance_squared = dx * dx + dy * dy
        observer_eye_z = observer_position.z + SOLDIER_EYE_HEIGHT
        target_eye_z = target_position.z + SOLDIER_EYE_HEIGHT

        for x, y in self._intervening_sightline_cells(
            observer_position,
            target_position,
        ):
            terrain_position = battlefield.position_at(x, y)
            if terrain_position is None:
                continue

            progress = (
                (x - observer_position.x) * dx
                + (y - observer_position.y) * dy
            ) / horizontal_distance_squared
            sightline_z = observer_eye_z + progress * (
                target_eye_z - observer_eye_z
            )
            if terrain_position.z >= sightline_z:
                return True

        return False

    def is_in_vision_range(
        self,
        observer_position: Position,
        target_position: Position,
        observer_vision_range: float,
    ) -> bool:
        """Whether the target lies within the observer's spherical vision.

        Distance is full 3D Euclidean: horizontal offset plus elevation
        difference. Elevation therefore never extends how far a soldier sees; it
        only adds distance to a target above or below. High ground's advantage
        comes solely from clearing line of sight (see verify_los and
        _terrain_blocks_los), not from range. Range is capped at the resolver's
        configurable max_vision_range.
        """
        dx = target_position.x - observer_position.x
        dy = target_position.y - observer_position.y
        dz = target_position.z - observer_position.z
        effective_range = min(observer_vision_range, self.max_vision_range)
        return dx * dx + dy * dy + dz * dz <= effective_range * effective_range

    def _hard_cover_blocks_los(
        self,
        battlefield: Battlefield,
        observer_position: Position,
        target_position: Position,
    ) -> bool:
        """Return whether hard cover blocks the sightline between two positions."""
        for x, y in self._intervening_sightline_cells(
            observer_position, target_position
        ):
            position = battlefield.position_at(x, y)
            if position in battlefield.cover:
                return True

        return False

    def _intervening_sightline_cells(
        self, start: Position, end: Position
    ) -> list[tuple[int, int]]:
        """
        Return grid cells crossed by the center-to-center sightline, which
        is the line of sight between two positions.

        Soldier positions are grid cell addresses, not exact points. This
        function treats the sightline as a straight ray from the center of the
        start cell to the center of the end cell. It walks the ray through grid
        boundaries and records each intervening cell entered before the target
        cell.

        The start and end cells are excluded because cover in the observer's own
        cell or the target's own cell should not count as intervening hard cover.
        """
        x = start.x
        y = start.y
        dx = end.x - start.x
        dy = end.y - start.y
        step_x = 1 if dx > 0 else -1 if dx < 0 else 0
        step_y = 1 if dy > 0 else -1 if dy < 0 else 0

        next_vertical_t = inf if step_x == 0 else 0.5 / abs(dx)
        next_horizontal_t = inf if step_y == 0 else 0.5 / abs(dy)
        vertical_step_t = inf if step_x == 0 else 1.0 / abs(dx)
        horizontal_step_t = inf if step_y == 0 else 1.0 / abs(dy)

        cells: list[tuple[int, int]] = []

        while (x, y) != (end.x, end.y):
            if next_vertical_t < next_horizontal_t:
                x += step_x
                next_vertical_t += vertical_step_t
            elif next_horizontal_t < next_vertical_t:
                y += step_y
                next_horizontal_t += horizontal_step_t
            else:
                x += step_x
                y += step_y
                next_vertical_t += vertical_step_t
                next_horizontal_t += horizontal_step_t

            if (x, y) != (end.x, end.y):
                cells.append((x, y))

        return cells
