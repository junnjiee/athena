import asyncio
from collections import deque
from math import ceil
from typing import Awaitable, Callable

from athena.agent import choose_action
from athena.params import (
    COMMUNICATION_HISTORY_LIMIT,
    MAX_ACTION_ATTEMPTS,
    VISIBILITY_HISTORY_LIMIT,
)
from athena.world_state import Battlefield
from athena.resolvers.movement import MovementResolver
from athena.resolvers.shooting import ShootingResolver
from athena.world_state import Soldier
from athena.resolvers.vision import VisionResolver
from athena.models import (
    Action,
    AgentContext,
    BattlefieldSnapshot,
    BroadcastDraft,
    ChosenTurn,
    ExecutionResult,
    MoveAction,
    ObservedSoldier,
    Position,
    ShootAction,
    SurvivalState,
    TerrainCell,
    TeamMessage,
    VisibleSoldier,
    VisibilityObservation,
)

# OpenRouter returns a physical action plus optional broadcast. Existing custom and
# Ollama choosers may continue returning only a physical action.
ActionChooser = Callable[..., Awaitable[ChosenTurn | Action | None]]


class LoopEngine:
    def __init__(
        self,
        battlefield: Battlefield,
        vision_resolver: VisionResolver,
        movement_resolver: MovementResolver,
        action_chooser: ActionChooser = choose_action,
        shooting_resolver: ShootingResolver | None = None,
        visibility_history_limit: int = VISIBILITY_HISTORY_LIMIT,
        communication_history_limit: int = COMMUNICATION_HISTORY_LIMIT,
    ) -> None:
        self.battlefield = battlefield
        self.vision_resolver = vision_resolver
        self.movement_resolver = movement_resolver
        self.action_chooser = action_chooser
        self.shooting_resolver = shooting_resolver or ShootingResolver()
        self.visibility_history_limit = visibility_history_limit
        self.communication_history_limit = communication_history_limit
        self.tick_number = 0
        self.visibility_history = [
            deque[VisibilityObservation](maxlen=visibility_history_limit)
            for _ in battlefield.soldiers
        ]
        self.communication_history = [
            deque[TeamMessage](maxlen=communication_history_limit)
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
        Cells each soldier has line of sight to: within (capped) vision range,
        not behind a rise, and not beyond the point where intervening terrain
        has accumulated to opaque -- the same tests that decide whether an
        enemy standing on the cell would be seen.

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
                            terrain_class=self.battlefield.terrain_for(position),
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

    async def collect_valid_turns(
        self,
        max_attempts: int = MAX_ACTION_ATTEMPTS,
        observed_soldiers: list[ObservedSoldier] | None = None,
    ) -> list[ChosenTurn | None]:
        """
        Ask every soldier-agent for a valid physical action and optional broadcast.
        """
        if observed_soldiers is None:
            observed_soldiers = self.observed_soldiers_map()

        async def collect_soldier_action(
            soldier_index: int,
            observed_soldier: ObservedSoldier,
        ) -> ChosenTurn | Action | None:
            soldier = self.battlefield.soldiers[soldier_index]
            if soldier.survival_status != SurvivalState.ALIVE:
                return None

            return await self.action_chooser(
                agent_context=AgentContext(
                    current_observation=observed_soldier,
                    visibility_history=tuple(
                        self.visibility_history[soldier_index]
                    ),
                    communication_groups=self.battlefield.communication_groups_for(
                        soldier
                    ),
                    communication_history=tuple(
                        self.communication_history[soldier_index]
                    ),
                ),
                battlefield=self.battlefield,
                soldier=soldier,
                movement_resolver=self.movement_resolver,
                max_attempts=max_attempts,
                visibility_history_limit=self.visibility_history_limit,
                communication_history_limit=self.communication_history_limit,
            )

        # asyncio.gather preserves input order, so each result stays aligned with
        # battlefield.soldiers. It also raises if any soldier task raises, which
        # keeps this collection phase fail-fast while the engine is still small.
        results = await asyncio.gather(
            *[
                collect_soldier_action(soldier_index, observed_soldier)
                for soldier_index, observed_soldier in enumerate(observed_soldiers)
            ]
        )

        return [
            result
            if isinstance(result, ChosenTurn) or result is None
            else ChosenTurn(action=result)
            for result in results
        ]

    async def collect_valid_actions(
        self,
        max_attempts: int = MAX_ACTION_ATTEMPTS,
        observed_soldiers: list[ObservedSoldier] | None = None,
    ) -> list[Action | None]:
        """Compatibility boundary returning only validated physical actions."""
        turns = await self.collect_valid_turns(
            max_attempts=max_attempts,
            observed_soldiers=observed_soldiers,
        )
        return [turn.action if turn is not None else None for turn in turns]

    async def tick(self, max_attempts: int = MAX_ACTION_ATTEMPTS) -> ExecutionResult:
        observed_soldiers = self.observed_soldiers_map()
        turns = await self.collect_valid_turns(
            max_attempts=max_attempts,
            observed_soldiers=observed_soldiers,
        )
        return self.execute_actions(
            [turn.action if turn is not None else None for turn in turns],
            observed_soldiers=observed_soldiers,
            broadcasts=[turn.broadcast if turn is not None else None for turn in turns],
        )

    def execute_actions(
        self,
        actions: list[Action | None],
        observed_soldiers: list[ObservedSoldier] | None = None,
        broadcasts: list[BroadcastDraft | None] | None = None,
    ) -> ExecutionResult:
        """
        Resolve every action from the same before snapshot, then commit all effects.

        Action indices map to battlefield.soldiers. Movement and rifle casualties
        are resolved independently, so a soldier shot during this tick still
        completes an accepted move selected while it was alive.
        """
        if observed_soldiers is None:
            observed_soldiers = self.observed_soldiers_map()
        if broadcasts is None:
            broadcasts = [None for _ in actions]

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
        team_messages = self._resolve_team_messages(
            broadcasts,
            before,
            sent_tick=self.tick_number,
        )
        observations = tuple(
            VisibilityObservation(
                tick=self.tick_number,
                position=observed_soldier.position,
                submitted_action=actions[soldier_index],
                visible_soldiers=observed_soldier.visible_soldiers,
                available_terrain=observed_soldier.available_terrain,
            )
            for soldier_index, observed_soldier in enumerate(observed_soldiers)
        )
        for soldier_index, observation in enumerate(observations):
            self.visibility_history[soldier_index].append(observation)
        for message in team_messages:
            for soldier_index, soldier in enumerate(self.battlefield.soldiers):
                if message.group_id in soldier.communication_group_ids:
                    self.communication_history[soldier_index].append(message)

        return ExecutionResult(
            actions=tuple(actions),
            shot_outcomes=shot_outcomes,
            observations=observations,
            team_messages=team_messages,
            before=before,
            after=self.battlefield.snapshot(),
        )

    def _resolve_team_messages(
        self,
        broadcasts: list[BroadcastDraft | None],
        before: BattlefieldSnapshot,
        sent_tick: int,
    ) -> tuple[TeamMessage, ...]:
        messages: list[TeamMessage] = []
        for sender_index, broadcast in enumerate(broadcasts):
            if broadcast is None:
                continue

            sender = before.soldiers[sender_index]
            group = self.battlefield.communication_group(broadcast.group_id)
            if sender.survival_status != SurvivalState.ALIVE:
                continue
            if broadcast.group_id not in sender.communication_group_ids:
                continue
            if group is None or group.team != sender.team:
                continue

            messages.append(
                TeamMessage(
                    sent_tick=sent_tick,
                    group_id=broadcast.group_id,
                    sender_index=sender_index,
                    content=broadcast.content,
                )
            )

        return tuple(messages)

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
