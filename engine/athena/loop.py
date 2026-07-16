import asyncio
from typing import Awaitable, Callable

from athena.agent import choose_action
from athena.battlefield import Battlefield
from athena.resolvers.movement import MovementResolver
from athena.resolvers.shooting import ShootingResolver
from athena.soldier import Soldier
from athena.resolvers.vision import VisionResolver
from athena.types import (
    Action,
    AvailableTerrain,
    BattlefieldSnapshot,
    ExecutionResult,
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
        shooting_resolver: ShootingResolver | None = None,
    ) -> None:
        self.battlefield = battlefield
        self.vision_resolver = vision_resolver
        self.movement_resolver = movement_resolver
        self.action_chooser = action_chooser
        self.shooting_resolver = shooting_resolver or ShootingResolver()

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

    async def tick(self, max_attempts: int = 3) -> ExecutionResult:
        actions = await self.collect_valid_actions(max_attempts=max_attempts)
        return self.execute_actions(actions)

    def execute_actions(self, actions: list[Action | None]) -> ExecutionResult:
        """
        Resolve every action from the same before snapshot, then commit all effects.

        Action indices map to battlefield.soldiers. Movement and rifle casualties
        are resolved independently, so a soldier shot during this tick still
        completes an accepted move selected while it was alive.
        """
        before = self.battlefield.snapshot()
        accepted_moves = self._resolve_move_destinations(actions, before)
        casualty_targets = {
            target_index
            for soldier_index, action in enumerate(actions)
            if isinstance(action, ShootAction)
            and (
                target_index := self.shooting_resolver.resolve_shoot_target(
                    before,
                    soldier_index,
                    action,
                )
            )
            is not None
        }

        for soldier_index, new_position in accepted_moves.items():
            self.battlefield.soldiers[soldier_index].move_to(new_position)

        for target_index in casualty_targets:
            self.battlefield.soldiers[target_index].become_casualty()

        return ExecutionResult(
            actions=tuple(actions),
            before=before,
            after=self.battlefield.snapshot(),
        )

    def _resolve_move_destinations(
        self,
        actions: list[Action | None],
        before: BattlefieldSnapshot,
    ) -> dict[int, Position]:
        proposed_moves = {
            soldier_index: self.movement_resolver.resolve_move_position(
                self.battlefield.soldiers[soldier_index],
                action,
            )
            for soldier_index, action in enumerate(actions)
            if isinstance(action, MoveAction)
        }

        movers_by_destination: dict[Position, list[int]] = {}
        for soldier_index, destination in proposed_moves.items():
            movers_by_destination.setdefault(destination, []).append(soldier_index)

        rejected_movers = {
            soldier_index
            for mover_indices in movers_by_destination.values()
            if len(mover_indices) > 1
            for soldier_index in mover_indices
        }

        occupants_by_position: dict[Position, list[int]] = {}
        for soldier in before.soldiers:
            occupants_by_position.setdefault(soldier.position, []).append(
                soldier.soldier_index
            )

        # Rejections cascade backward through movement chains. If B cannot vacate
        # its cell, A cannot move into it; swaps and fully moving cycles remain valid.
        while True:
            newly_rejected = {
                soldier_index
                for soldier_index, destination in proposed_moves.items()
                if soldier_index not in rejected_movers
                and any(
                    occupant_index not in proposed_moves
                    or occupant_index in rejected_movers
                    for occupant_index in occupants_by_position.get(destination, [])
                )
            }
            if not newly_rejected:
                break
            rejected_movers.update(newly_rejected)

        return {
            soldier_index: destination
            for soldier_index, destination in proposed_moves.items()
            if soldier_index not in rejected_movers
        }

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
