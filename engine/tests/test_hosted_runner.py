import asyncio
import json

from athena.hosted import runner
from athena.models import ChosenTurn, HoldAction


def _payload() -> dict:
    return {
        "terrain": {
            "bbox": {"west": 0, "south": 0, "east": 1, "north": 1},
            "width": 2,
            "height": 2,
            "cellMeters": 1,
            "classNames": {"0": "Open Ground"},
            "cells": {"elevation": [0, 0, 0, 0], "cls": [0, 0, 0, 0]},
        },
        "units": [
            {
                "id": "blue-1",
                "side": "blue",
                "name": "Blue",
                "position": {"longitude": 0.1, "latitude": 0.9},
            },
            {
                "id": "red-1",
                "side": "red",
                "name": "Red",
                "position": {"longitude": 0.9, "latitude": 0.1},
            },
        ],
        "objectives": [],
    }


def test_headless_runner_uses_payload_units_and_records_each_tick(
    tmp_path,
    monkeypatch,
) -> None:
    payload_path = tmp_path / "payload.json"
    payload_path.write_text(json.dumps(_payload()), encoding="utf-8")

    async def hold(**_):
        return ChosenTurn(action=HoldAction())

    monkeypatch.setattr(runner, "choose_action", hold)
    replay = asyncio.run(
        runner.run_payload_simulation(payload_path, ticks=2, model=None)
    )

    assert replay.schema_version == 3
    assert len(replay.steps) == 3
    assert [soldier.team.value for soldier in replay.steps[0].soldiers] == [
        "blue",
        "red",
    ]
