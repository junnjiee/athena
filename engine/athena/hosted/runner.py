"""Headless execution of one UI-submitted Athena simulation."""

import asyncio
from functools import partial
from pathlib import Path

from athena.agent import choose_action
from athena.loaders.terrain_payload import (
    TerrainPayload,
    build_battlefield_from_payload,
    fetch_plan,
    load_payload,
)
from athena.loop import LoopEngine
from athena.models import ReplayLog, SurvivalState, Team
from athena.replay import ReplayRecorder
from athena.resolvers.movement import MovementResolver
from athena.resolvers.vision import VisionResolver


def _battle_continues(loop: LoopEngine) -> bool:
    living_teams = {
        soldier.team
        for soldier in loop.battlefield.soldiers
        if soldier.survival_status == SurvivalState.ALIVE
    }
    return Team.BLUE in living_teams and Team.RED in living_teams


async def run_payload_simulation(
    payload_path: Path,
    *,
    ticks: int,
    model: str | None,
) -> ReplayLog:
    """Run one simulation from a payload file on disk."""
    return await run_simulation(load_payload(payload_path), ticks=ticks, model=model)


async def run_plan_simulation(
    terrain_service_url: str,
    plan_id: str,
    *,
    ticks: int,
    model: str | None,
) -> ReplayLog:
    """Run one simulation from a plan held by the terrain service.

    The scenario is pulled rather than uploaded, so the engine reads the same
    bytes the web app renders and there is one representation of a battleground
    rather than two that can disagree.
    """
    payload = await asyncio.to_thread(fetch_plan, terrain_service_url, plan_id)
    return await run_simulation(payload, ticks=ticks, model=model)


async def run_simulation(
    payload: TerrainPayload,
    *,
    ticks: int,
    model: str | None,
) -> ReplayLog:
    """Run one simulation without terminal rendering and return replay schema v3."""
    battlefield = build_battlefield_from_payload(payload)
    action_chooser = choose_action if model is None else partial(choose_action, model=model)
    loop = LoopEngine(
        battlefield=battlefield,
        vision_resolver=VisionResolver(),
        movement_resolver=MovementResolver(),
        action_chooser=action_chooser,
    )
    recorder = ReplayRecorder(battlefield.snapshot())

    for _ in range(ticks):
        if not _battle_continues(loop):
            break
        recorder.record(await loop.tick())

    return recorder.log
