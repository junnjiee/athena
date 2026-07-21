import asyncio
from collections import deque
from math import ceil
from typing import Awaitable, Callable

from athena.agent import choose_action
from athena.params import MAX_ACTION_ATTEMPTS, VISIBILITY_HISTORY_LIMIT
from athena.world_state import Battlefield
from athena.resolvers.movement import MovementResolver
from athena.resolvers.shooting import ShootingResolver
from athena.world_state import Soldier
from athena.resolvers.vision import VisionResolver
from athena.models import (
    Action,
    AgentContext,
    BattlefieldSnapshot,
    ExecutionResult,
    MoveAction,
    ObservedSoldier,
    Position,
    ShootAction,
    SurvivalState,
    TerrainCell,
    VisibleSoldier,
    VisibilityObservation,
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
        visibility_history_limit: int = VISIBILITY_HISTORY_LIMIT,
    ) -> None:
        self.battlefield = battlefield
        self.vision_resolver = vision_resolver
        self.movement_resolver = movement_resolver
        self.action_chooser = action_chooser
        self.shooting_resolver = shooting_resolver or ShootingResolver()
        self.visibility_history_limit = visibility_history_limit
        self.tick_number = 0
        self.visibility_history = [
            deque[VisibilityObservation](maxlen=visibility_history_limit)
            for _ in battlefield.soldiers
        ]

    def visible_soldiers_map(self) -> list[list[VisibleSoldier]]:
        """
        This array shows other soldiers that are visible to the
        current soldier. Index is mapped to battlefield.soldiers.

        NOTE: might be slow at scale, this is a O(n^2) operation
        """
        visible_by_soldier: list[list[VisibleSoldier]] = []

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
            visible_by_soldier.append(visible_soldiers)

        return visible_by_soldier

    def nearby_terrain_map(self) -> list[list[TerrainCell]]:
        """
        Cells each soldier has line of sight to: within (capped) vision range and
        not hidden behind intervening terrain.

        Only the local vision window is scanned, sized by the capped range.
        Iterating y-then-x yields cells in (y, x) order.
        """
        terrain_by_soldier: list[list[TerrainCell]] = []

        cap = self.vision_resolver.max_vision_range
        for observer in self.battlefield.soldiers:
            radius = max(1, ceil(min(observer.vision_range, cap)))
            origin_x = observer.position.x
            origin_y = observer.position.y

            cells: list[TerrainCell] = []
            for y in range(origin_y - radius, origin_y + radius + 1):
                for x in range(origin_x - radius, origin_x + radius + 1):
                    position = self.battlefield.position_at(x, y)
                    if position is None:
                        continue
                    if not self.vision_resolver.verify_terrain_los(
                        self.battlefield,
                        observer.position,
                        position,
                        observer.vision_range,
                    ):
                        continue
                    cells.append(
                        TerrainCell(
                            position=position,
                            has_cover=position in self.battlefield.cover,
                            has_concealment=position in self.battlefield.concealment,
                        )
                    )

            terrain_by_soldier.append(cells)

        return terrain_by_soldier

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

    async def collect_valid_actions(
        self,
        max_attempts: int = MAX_ACTION_ATTEMPTS,
        observed_soldiers: list[ObservedSoldier] | None = None,
    ) -> list[Action | None]:
        """
        Ask every soldier-agent for a valid action. Index is mapped to
        battlefield.soldiers.
        """
        if observed_soldiers is None:
            observed_soldiers = self.observed_soldiers_map()

        async def collect_soldier_action(
            soldier_index: int,
            observed_soldier: ObservedSoldier,
        ) -> Action | None:
            soldier = self.battlefield.soldiers[soldier_index]
            if soldier.survival_status != SurvivalState.ALIVE:
                return None

            return await self.action_chooser(
                agent_context=AgentContext(
                    current_observation=observed_soldier,
                    visibility_history=tuple(
                        self.visibility_history[soldier_index]
                    ),
                ),
                battlefield=self.battlefield,
                soldier=soldier,
                movement_resolver=self.movement_resolver,
                max_attempts=max_attempts,
                visibility_history_limit=self.visibility_history_limit,
            )

        # asyncio.gather preserves input order, so each result stays aligned with
        # battlefield.soldiers. It also raises if any soldier task raises, which
        # keeps this collection phase fail-fast while the engine is still small.
        return await asyncio.gather(
            *[
                collect_soldier_action(soldier_index, observed_soldier)
                for soldier_index, observed_soldier in enumerate(observed_soldiers)
            ]
        )

    async def tick(self, max_attempts: int = MAX_ACTION_ATTEMPTS) -> ExecutionResult:
        observed_soldiers = self.observed_soldiers_map()
        actions = await self.collect_valid_actions(
            max_attempts=max_attempts,
            observed_soldiers=observed_soldiers,
        )
        return self.execute_actions(actions, observed_soldiers=observed_soldiers)

    def execute_actions(
        self,
        actions: list[Action | None],
        observed_soldiers: list[ObservedSoldier] | None = None,
    ) -> ExecutionResult:
        """
        Resolve every action from the same before snapshot, then commit all effects.

        Action indices map to battlefield.soldiers. Movement and rifle casualties
        are resolved independently, so a soldier shot during this tick still
        completes an accepted move selected while it was alive.
        """
        if observed_soldiers is None:
            observed_soldiers = self.observed_soldiers_map()

        before = self.battlefield.snapshot()
        accepted_moves = self._resolve_move_destinations(actions, before)
        shot_outcomes = tuple(
            outcome
            for soldier_index, action in enumerate(actions)
            if isinstance(action, ShootAction)
            and (
                outcome := self.shooting_resolver.resolve_shot(
                    before,
                    soldier_index,
                    action,
                )
            )
            is not None
        )
        casualty_targets = {
            outcome.target_index for outcome in shot_outcomes if outcome.hit
        }

        for soldier_index, new_position in accepted_moves.items():
            self.battlefield.soldiers[soldier_index].move_to(new_position)

        for target_index in casualty_targets:
            self.battlefield.soldiers[target_index].become_casualty()

        # Retain the exact local information that informed this execution. Taking
        # another observation after resolution could reroll probabilistic visibility
        # and give history that differs from what the agent actually acted on.
        self.tick_number += 1
        observations = tuple(
            VisibilityObservation(
                tick=self.tick_number,
                visible_soldiers=observed_soldier.visible_soldiers,
                available_terrain=observed_soldier.available_terrain,
            )
            for observed_soldier in observed_soldiers
        )
        for soldier_index, observation in enumerate(observations):
            self.visibility_history[soldier_index].append(observation)

        return ExecutionResult(
            actions=tuple(actions),
            shot_outcomes=shot_outcomes,
            observations=observations,
            before=before,
            after=self.battlefield.snapshot(),
        )

    def _resolve_move_destinations(
        self,
        actions: list[Action | None],
        before: BattlefieldSnapshot,
    ) -> dict[int, Position]:
        proposed_moves: dict[int, Position] = {}
        for soldier_index, action in enumerate(actions):
            soldier = self.battlefield.soldiers[soldier_index]
            if not isinstance(action, MoveAction):
                continue
            if not self.movement_resolver.verify_move_action(
                self.battlefield,
                soldier,
                action,
            ):
                continue

            destination = self.movement_resolver.resolve_move_position(
                self.battlefield,
                soldier,
                action,
            )
            if destination is not None:
                proposed_moves[soldier_index] = destination

        movers_by_destination: dict[Position, list[int]] = {}
        for soldier_index, destination in proposed_moves.items():
            movers_by_destination.setdefault(destination, []).append(soldier_index)

        rejected_movers: set[int] = set()
        for mover_indices in movers_by_destination.values():
            if len(mover_indices) <= 1:
                continue

            winner = self.movement_resolver.select_competing_mover(mover_indices)
            rejected_movers.update(
                soldier_index
                for soldier_index in mover_indices
                if soldier_index != winner
            )

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
