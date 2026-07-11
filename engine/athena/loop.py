import asyncio
from typing import Awaitable, Callable

from athena.agent import choose_action
from athena.battlefield import Battlefield
from athena.resolvers.movement import MovementResolver
from athena.soldier import Soldier
from athena.resolvers.vision import VisionResolver
from athena.types import (
    Action,
    AvailableTerrain,
    MoveAction,
    ObservedSoldier,
    Position,
    ShootAction,
    VisibleSoldier,
    VisibleSoldiers,
)

# An action chooser turns one soldier's local observation into a validated action
# (or None). choose_action drives OpenRouter; choose_action_local drives Ollama.
ActionChooser = Callable[..., Awaitable[Action | None]]


class LoopEngine:
    def __init__(
        self,
        battlefield: Battlefield,
        vision_resolver: VisionResolver,
        movement_resolver: MovementResolver,
        action_chooser: ActionChooser = choose_action,
    ) -> None:
        self.battlefield = battlefield
        self.vision_resolver = vision_resolver
        self.movement_resolver = movement_resolver
        self.action_chooser = action_chooser

    def visible_soldiers_map(self) -> list[VisibleSoldiers]:
        """
        This array shows other soldiers that are visible to the
        current soldier. Index is mapped to battlefield.soldiers.

        NOTE: might be slow at scale, this is a O(n^2) operation
        """
        visible_by_soldier: list[VisibleSoldiers] = []

        for observer in self.battlefield.soldiers:
            visible_soldiers = [
                VisibleSoldier(
                    team=target.team,
                    position=target.position,
                    survival_status=target.survival_status,
                )
                for target in self.battlefield.soldiers
                if self.vision_resolver.verify_los(
                    self.battlefield,
                    observer,
                    target,
                )
            ]
            visible_by_soldier.append(VisibleSoldiers(soldiers=visible_soldiers))

        return visible_by_soldier

    def nearby_terrain_map(self) -> list[AvailableTerrain]:
        """
        This array shows range-based nearby cover and concealment
        for the current soldier. Index is mapped to battlefield.soldiers.

        NOTE: might be slow at scale, this is a O(n*(2)m) operation
        """
        return [
            AvailableTerrain(
                cover=self._nearby_positions(observer, self.battlefield.cover),
                concealment=self._nearby_positions(
                    observer,
                    self.battlefield.concealment,
                ),
            )
            for observer in self.battlefield.soldiers
        ]

    def observed_soldiers_map(self) -> list[ObservedSoldier]:
        """
        This array shows the information available to each soldier.
        Index is mapped to battlefield.soldiers.
        """
        visible_by_soldier = self.visible_soldiers_map()
        terrain_by_soldier = self.nearby_terrain_map()

        return [
            ObservedSoldier(
                team=soldier.team,
                position=soldier.position,
                survival_status=soldier.survival_status,
                visible_soldiers=visible_by_soldier[index],
                available_terrain=terrain_by_soldier[index],
            )
            for index, soldier in enumerate(self.battlefield.soldiers)
        ]

    async def collect_valid_actions(self, max_attempts: int = 3) -> list[Action | None]:
        """
        Ask every soldier-agent for a valid action. Index is mapped to
        battlefield.soldiers.
        """
        observed_soldiers = self.observed_soldiers_map()

        # asyncio.gather preserves input order, so each result stays aligned with
        # battlefield.soldiers. It also raises if any soldier task raises, which
        # keeps this collection phase fail-fast while the engine is still small.
        return await asyncio.gather(
            *[
                self.action_chooser(
                    observed_soldier=observed_soldier,
                    battlefield=self.battlefield,
                    soldier=self.battlefield.soldiers[soldier_index],
                    movement_resolver=self.movement_resolver,
                    max_attempts=max_attempts,
                )
                for soldier_index, observed_soldier in enumerate(observed_soldiers)
            ]
        )

    async def tick(self, max_attempts: int = 3) -> None:
        actions = await self.collect_valid_actions(max_attempts=max_attempts)
        self.execute_actions(actions)

    def execute_actions(self, actions: list[Action | None]) -> None:
        """
        Execute collected actions sequentially. Index is mapped to
        battlefield.soldiers.
        """
        for soldier_index, action in enumerate(actions):
            if action is None:
                continue

            soldier = self.battlefield.soldiers[soldier_index]

            if isinstance(action, MoveAction):
                new_position = self.movement_resolver.resolve_move_position(
                    soldier,
                    action,
                )
                soldier.move_to(new_position)
                continue

            if isinstance(action, ShootAction):
                raise NotImplementedError("ShootAction execution is not implemented yet.")

    def _nearby_positions(
        self,
        observer: Soldier,
        positions: set[Position],
    ) -> list[Position]:
        return [
            position
            for position in positions
            if self.vision_resolver.is_in_vision_range(
                observer.position,
                position,
                observer.vision_range,
            )
        ]
