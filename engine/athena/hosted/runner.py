"""Headless execution of one UI-submitted Athena simulation."""

from functools import partial
from pathlib import Path

from athena.agent import choose_action
from athena.loaders.terrain_payload import (
    build_battlefield_from_payload,
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
    """Run one simulation without terminal rendering and return replay schema v3."""
    payload = load_payload(payload_path)
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
