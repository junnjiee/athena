"""Headless execution of one UI-submitted Athena simulation."""

import asyncio
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any
from random import Random
from functools import partial
from pathlib import Path

from athena.agent import BatchRequest, choose_action
from athena.hosted.orders import build_soldier_orders
from athena.loaders.terrain_payload import (
    TerrainPayload,
    build_battlefield_from_payload,
    fetch_plan,
    load_payload,
)
from athena.loop import LoopEngine
from athena.navigation import UNREACHABLE, Navigator
from athena.policy import (
    advance_along_axis,
    commander_needs_a_decision,
    follow_section_commander,
    promote_section_commanders,
    situation_signature,
)
from athena.models import (
    AgentContext,
    ChosenTurn,
    HoldAction,
    MoveAction,
    ReplayLog,
    SurvivalState,
    Team,
)
from athena.params import (
    AGENT_HEARTBEAT_TICKS,
    STALL_TICKS,
    COMMUNICATION_HISTORY_LIMIT,
    MAX_ACTION_ATTEMPTS,
    VISIBILITY_HISTORY_LIMIT,
)
from athena.replay import ReplayRecorder
from athena.resolvers.movement import MovementResolver
from athena.resolvers.shooting import ShootingResolver
from athena.resolvers.vision import VisionResolver
from athena.world_state import Battlefield, Soldier


@dataclass(frozen=True)
class RunOutcome:
    """What happened, without reading the replay back.

    A replay repeats the whole battlefield surface -- about 17 MB on an 800x800
    ground -- so scoring a batch by fetching every replay moved gigabytes to
    produce one win rate. Everything needed for that number is known here, at
    the point the run ends, and rides out on the completion event instead.
    """

    outcome: str
    ticks: int
    # The seed this run used. Every random draw in a run comes from it, so
    # quoting it back reproduces the run exactly.
    seed: int
    # Soldiers whose decisions cost a model call, and soldiers who followed the
    # section policy instead. Reported so the price of a batch is visible.
    agents: int
    followers: int
    blue_alive: int
    red_alive: int
    blue_losses: int
    red_losses: int
    shots_fired: int
    hits: int
    # What the run actually spent: model calls made, and commander decisions
    # served from a standing order instead. The second number is the saving.
    model_calls: int = 0
    standing_orders: int = 0
    # Ticks containing at least one model call. Ticks are serial, so this — not
    # the call count — is what sets a run's wall time.
    call_ticks: int = 0
    # Provider round trips. Equal to model_calls today: a tick's decisions go out
    # concurrently rather than batched, because batching measured far slower.
    provider_requests: int = 0

    def as_event_data(self) -> dict[str, int | str]:
        """camelCase, matching every other field on the wire."""
        return {
            "outcome": self.outcome,
            "ticks": self.ticks,
            "blueAlive": self.blue_alive,
            "redAlive": self.red_alive,
            "blueLosses": self.blue_losses,
            "redLosses": self.red_losses,
            "shotsFired": self.shots_fired,
            "hits": self.hits,
            "agents": self.agents,
            "followers": self.followers,
            "seed": self.seed,
            "modelCalls": self.model_calls,
            "standingOrders": self.standing_orders,
            "callTicks": self.call_ticks,
            "providerRequests": self.provider_requests,
        }


def _alive(battlefield: Battlefield, team: Team) -> int:
    return sum(
        1
        for soldier in battlefield.soldiers
        if soldier.team == team and soldier.survival_status == SurvivalState.ALIVE
    )


def _strength(battlefield: Battlefield, team: Team) -> int:
    return sum(1 for soldier in battlefield.soldiers if soldier.team == team)


def _score(
    battlefield: Battlefield,
    started: dict[Team, int],
    ticks: int,
    log: ReplayLog,
    seed: int,
    budget: dict[str, int],
) -> RunOutcome:
    blue_alive = _alive(battlefield, Team.BLUE)
    red_alive = _alive(battlefield, Team.RED)
    if blue_alive > 0 and red_alive == 0:
        outcome = "blue"
    elif red_alive > 0 and blue_alive == 0:
        outcome = "red"
    else:
        # Both sides still standing when the clock ran out, or neither. The tick
        # budget is a bound on the run, not a verdict, so this is reported as
        # what it is rather than scored as a draw.
        outcome = "inconclusive"
    shots = [shot for step in log.steps for shot in step.shots]
    agents = sum(1 for soldier in battlefield.soldiers if soldier.is_commander)
    return RunOutcome(
        outcome=outcome,
        ticks=ticks,
        seed=seed,
        agents=agents,
        followers=len(battlefield.soldiers) - agents,
        model_calls=budget.get("calls", 0),
        provider_requests=budget.get("requests", 0),
        standing_orders=budget.get("standing_orders", 0),
        call_ticks=budget.get("call_ticks", 0),
        blue_alive=blue_alive,
        red_alive=red_alive,
        blue_losses=started[Team.BLUE] - blue_alive,
        red_losses=started[Team.RED] - red_alive,
        shots_fired=len(shots),
        hits=sum(1 for shot in shots if shot.hit),
    )


def _battle_continues(loop: LoopEngine) -> bool:
    living_teams = {
        soldier.team
        for soldier in loop.battlefield.soldiers
        if soldier.survival_status == SurvivalState.ALIVE
    }
    return Team.BLUE in living_teams and Team.RED in living_teams


def _tiered_planner(base_chooser, orders: tuple[str | None, ...], counter: dict):
    """Decide a whole tick at once, spending at most one provider request on it.

    The same three tiers as before -- followers on the section policy,
    commanders with nothing new on a standing order, commanders with something
    to decide on the model -- except the last group is now resolved together.

    The commanders that need a decision are asked **concurrently**, not in one
    batched request. That was measured, not assumed: putting a whole tick in one
    request made a 120-tick run go from 290 s to over 600 s. Concurrent requests
    overlap on the provider side, so a tick costs roughly its slowest single
    decision; one batched request instead serialises every decision inside a
    single generation, and generation time is set by output tokens. Batching
    saves input tokens and loses far more wall clock than it saves — the wrong
    trade for a workload whose complaint is latency.

    What the planner is for is seeing the whole tick before committing to any of
    it: the tiering above, and one place that knows what a tick actually spent.
    """
    last_called: dict[int, int] = {}
    last_signature: dict[int, tuple] = {}
    last_turn: dict[int, ChosenTurn] = {}
    order_expires: dict[int, int] = {}
    # Distance to target when a commander last made progress, and when that was.
    # A standing order that stops closing the distance hands the decision back.
    best_distance: dict[int, int] = {}
    progressed_at: dict[int, int] = {}
    navigator = Navigator()
    counter.setdefault("calls", 0)
    counter.setdefault("requests", 0)
    counter.setdefault("standing_orders", 0)
    counter.setdefault("call_ticks", 0)
    counter["tick"] = 0

    async def plan(requests, battlefield, movement_resolver):
        planned: dict[int, ChosenTurn | None] = {}
        asking: list[BatchRequest] = []

        for index, agent_context, soldier in requests:
            if not soldier.is_commander:
                planned[index] = await follow_section_commander(
                    agent_context=agent_context,
                    battlefield=battlefield,
                    soldier=soldier,
                    movement_resolver=movement_resolver,
                    navigator=navigator,
                )
                continue

            target = soldier.next_waypoint
            stalled = False
            if target is not None:
                distance = navigator.distance_to(
                    battlefield, soldier.position, target
                )
                previous = best_distance.get(index)
                if distance != UNREACHABLE and (
                    previous is None or distance < previous
                ):
                    best_distance[index] = distance
                    progressed_at[index] = counter["tick"]
                else:
                    stalled = (
                        counter["tick"] - progressed_at.get(index, counter["tick"])
                        >= STALL_TICKS
                    )

            signature = situation_signature(
                battlefield, soldier, agent_context, stalled=stalled
            )
            expires = order_expires.get(index, counter["tick"])
            since = counter["tick"] - last_called.get(index, -AGENT_HEARTBEAT_TICKS)
            elapsed = AGENT_HEARTBEAT_TICKS if counter["tick"] >= expires else since

            if commander_needs_a_decision(
                signature,
                last_signature.get(index),
                elapsed,
                AGENT_HEARTBEAT_TICKS,
            ):
                last_called[index] = counter["tick"]
                last_signature[index] = signature
                asking.append(
                    BatchRequest(
                        index=index,
                        soldier=soldier,
                        agent_context=agent_context,
                        team_objectives=(
                            orders[index] if index < len(orders) else None
                        ),
                    )
                )
            else:
                counter["standing_orders"] += 1
                counter["standing_this_tick"] = counter.get("standing_this_tick", 0) + 1
                planned[index] = _standing_order(
                    battlefield,
                    soldier,
                    movement_resolver,
                    last_turn.get(index),
                    in_contact=signature[0] > 0,
                    navigator=navigator,
                )

        if asking:
            counter["requests"] += len(asking)
            counter["calls"] += len(asking)
            counter["call_ticks"] += 1
            counter["calls_this_tick"] = len(asking)
            # Who is thinking, and about what. Surfaced live so an operator can
            # see the engine working rather than a bar moving.
            counter["deciding"] = [
                {
                    "soldier": request.index,
                    "section": request.soldier.section_id or "",
                    "side": request.soldier.team.value,
                }
                for request in asking
            ]

            async def decide_one(request: BatchRequest):
                try:
                    return await base_chooser(
                        agent_context=request.agent_context,
                        battlefield=battlefield,
                        soldier=request.soldier,
                        movement_resolver=movement_resolver,
                        team_objectives=request.team_objectives,
                    )
                except Exception as error:
                    # A provider hiccup costs that commander its turn, not the
                    # run. It falls back to a standing order below.
                    print(
                        f"[runner] tick {counter['tick']} commander "
                        f"{request.index} could not decide: "
                        f"{type(error).__name__}: {error}"
                    )
                    counter["failed_requests"] = counter.get("failed_requests", 0) + 1
                    return None

            results = await asyncio.gather(
                *(decide_one(request) for request in asking)
            )
            decided = {
                request.index: turn
                for request, turn in zip(asking, results)
                if turn is not None
            }

            for request in asking:
                turn = decided.get(request.index)
                if turn is not None:
                    last_turn[request.index] = turn
                    order_expires[request.index] = counter["tick"] + min(
                        turn.hold_for, AGENT_HEARTBEAT_TICKS
                    )
                    planned[request.index] = turn
                else:
                    # Illegal or absent. A standing order costs nothing and is
                    # better than another round trip to re-ask.
                    planned[request.index] = _standing_order(
                        battlefield,
                        request.soldier,
                        movement_resolver,
                        last_turn.get(request.index),
                        in_contact=True,
                        navigator=navigator,
                    )
            del decided

        return planned

    return plan


def _standing_order(
    battlefield: Battlefield,
    soldier: Soldier,
    movement_resolver: MovementResolver,
    previous: ChosenTurn | None,
    *,
    in_contact: bool,
    navigator: Navigator | None = None,
) -> ChosenTurn:
    """Carry on with what this commander was already doing.

    In contact, its last decision is repeated while it stays legal -- a soldier
    told to hold a position keeps holding it, one advancing keeps advancing. A
    shot at a target that has since moved or died is no longer legal, so it
    falls through rather than firing at empty ground.

    Out of contact it always advances along its axis, and specifically does
    **not** repeat a hold. Holding is a decision about an enemy; with nothing in
    sight and no situation change to trigger a rethink, repeating it strands the
    section where it stopped for the rest of the run. That is not hypothetical:
    it stalled a 120-tick approach 48 m short of its objective for a hundred
    ticks.
    """
    if in_contact and previous is not None:
        if isinstance(previous.action, MoveAction):
            if movement_resolver.validate_move_action(
                battlefield, soldier, previous.action
            ).valid:
                return previous
        elif isinstance(previous.action, HoldAction):
            return previous

    return advance_along_axis(battlefield, soldier, movement_resolver, navigator)


async def run_payload_simulation(
    payload_path: Path,
    *,
    ticks: int,
    model: str | None,
    seed: int = 0,
    on_progress: Callable[[dict[str, Any]], None] | None = None,
) -> tuple[ReplayLog, RunOutcome]:
    """Run one simulation from a payload file on disk."""
    return await run_simulation(
        load_payload(payload_path),
        ticks=ticks,
        model=model,
        seed=seed,
        on_progress=on_progress,
    )


async def run_plan_simulation(
    terrain_service_url: str,
    plan_id: str,
    *,
    ticks: int,
    model: str | None,
    seed: int = 0,
    on_progress: Callable[[dict[str, Any]], None] | None = None,
) -> tuple[ReplayLog, RunOutcome]:
    """Run one simulation from a plan held by the terrain service.

    The scenario is pulled rather than uploaded, so the engine reads the same
    bytes the web app renders and there is one representation of a battleground
    rather than two that can disagree.
    """
    payload = await asyncio.to_thread(fetch_plan, terrain_service_url, plan_id)
    return await run_simulation(
        payload, ticks=ticks, model=model, seed=seed, on_progress=on_progress
    )


async def run_simulation(
    payload: TerrainPayload,
    *,
    ticks: int,
    model: str | None,
    seed: int = 0,
    on_progress: Callable[[dict[str, Any]], None] | None = None,
) -> tuple[ReplayLog, RunOutcome]:
    """Run one simulation without terminal rendering.

    Returns the replay alongside the run's outcome, so a caller that only wants
    to know who won never has to read the replay back.

    Every random draw a run makes -- movement conflicts, detection, hit rolls --
    comes from ``seed``. Without it a batch could not be reproduced, so a
    surprising result could not be re-examined and a win rate could not be
    separated from the noise of an unseeded generator. Each simulation in a
    batch gets its own seed, so the runs still differ from one another.
    """
    battlefield = build_battlefield_from_payload(payload)
    base_chooser = choose_action if model is None else partial(choose_action, model=model)
    # Objectives and routes the operator drew, one order set per soldier. Without
    # this every soldier runs on the compass default and the drawn plan has no
    # effect on behaviour at all.
    orders = build_soldier_orders(payload)
    # Always tiered, even with nothing drawn: the followers are a cost decision,
    # not an orders one, and a payload that names no sections leaves every
    # soldier commanding anyway.
    budget: dict[str, int] = {}
    loop = LoopEngine(
        battlefield=battlefield,
        vision_resolver=VisionResolver(rng=Random(seed)),
        movement_resolver=MovementResolver(rng=Random(seed + 1)),
        shooting_resolver=ShootingResolver(rng=Random(seed + 2)),
        turn_planner=_tiered_planner(base_chooser, orders, budget),
    )
    recorder = ReplayRecorder(battlefield.snapshot())
    started = {team: _strength(battlefield, team) for team in (Team.BLUE, Team.RED)}

    completed = 0
    for _ in range(ticks):
        if not _battle_continues(loop):
            break
        # A section whose commander was killed last tick gets a new one before it
        # is asked to decide anything, rather than following a dead man.
        promote_section_commanders(battlefield)
        budget["tick"] = completed
        budget["calls_this_tick"] = 0
        budget["standing_this_tick"] = 0
        budget["deciding"] = []
        tick_started = time.monotonic()
        recorder.record(await loop.tick())
        completed += 1

        # A run takes minutes and used to say nothing at all until it finished,
        # so an operator watching a progress bar could not tell a slow run from
        # a hung one. Reporting every tick costs one small write and turns the
        # wait into something legible.
        if on_progress is not None:
            on_progress(
                {
                    "tick": completed,
                    "ticks": ticks,
                    "blueAlive": _alive(battlefield, Team.BLUE),
                    "redAlive": _alive(battlefield, Team.RED),
                    "modelCalls": budget.get("calls", 0),
                    "shotsFired": sum(
                        len(step.shots) for step in recorder.log.steps
                    ),
                    # Contact is what an operator means by it: someone is
                    # shooting. Derived from this tick's shots rather than from
                    # whether a model was called, which is a cost signal.
                    "inContact": bool(recorder.log.steps[-1].shots),
                    "decisions": budget.get("calls_this_tick", 0),
                    # Everything below exists so the operator can watch the
                    # engine rather than guess at it.
                    "deciding": budget.get("deciding", []),
                    "standingOrders": budget.get("standing_this_tick", 0),
                    "followers": len(battlefield.soldiers)
                    - sum(1 for s in battlefield.soldiers if s.is_commander),
                    "agents": sum(
                        1 for s in battlefield.soldiers if s.is_commander
                    ),
                    "tickMs": round((time.monotonic() - tick_started) * 1000),
                    "totalCalls": budget.get("calls", 0),
                }
            )

    return recorder.log, _score(
        battlefield, started, completed, recorder.log, seed, budget
    )


__all__ = [
    "RunOutcome",
    "run_payload_simulation",
    "run_plan_simulation",
    "run_simulation",
]
