import asyncio
import json

from athena.hosted import runner
from athena.models import ChosenTurn, HoldAction


def _all_hold(rationale: str = ""):
    """Stand in for the provider: every commander holds."""

    async def decide(**_):
        return ChosenTurn(action=HoldAction(), rationale=rationale)

    return decide


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

    monkeypatch.setattr(runner, "choose_action", _all_hold())
    replay, outcome = asyncio.run(
        runner.run_payload_simulation(payload_path, ticks=2, model=None)
    )

    assert replay.schema_version == 4
    assert len(replay.steps) == 3
    assert [soldier.team.value for soldier in replay.steps[0].soldiers] == [
        "blue",
        "red",
    ]
    # Nobody shot anybody, so both sides survive the clock running out.
    assert outcome.outcome == "inconclusive"
    assert outcome.ticks == 2
    assert (outcome.blue_alive, outcome.red_alive) == (1, 1)
    assert (outcome.blue_losses, outcome.red_losses) == (0, 0)


def test_the_same_seed_reproduces_a_run(tmp_path, monkeypatch) -> None:
    """A batch that cannot be reproduced cannot be re-examined.

    Every random draw a run makes comes from its seed, so a surprising result
    can be replayed exactly and a win rate can be separated from generator noise.
    """
    payload_path = tmp_path / "payload.json"
    payload_path.write_text(json.dumps(_payload()), encoding="utf-8")

    monkeypatch.setattr(runner, "choose_action", _all_hold("holding"))

    first = asyncio.run(
        runner.run_payload_simulation(payload_path, ticks=3, model=None, seed=99)
    )[1]
    again = asyncio.run(
        runner.run_payload_simulation(payload_path, ticks=3, model=None, seed=99)
    )[1]

    assert first == again
    assert first.seed == 99


def test_an_agent_s_reasoning_reaches_the_replay(tmp_path, monkeypatch) -> None:
    payload_path = tmp_path / "payload.json"
    payload_path.write_text(json.dumps(_payload()), encoding="utf-8")

    monkeypatch.setattr(
        runner,
        "choose_action",
        _all_hold("Holding the treeline until the flank closes."),
    )
    replay, _ = asyncio.run(
        runner.run_payload_simulation(payload_path, ticks=2, model=None, seed=1)
    )

    decisions = replay.steps[1].decisions

    assert len(decisions) == 2
    assert decisions[0].action == "hold"
    assert decisions[0].rationale == "Holding the treeline until the flank closes."
    # Step zero is the laydown, not a tick, so nobody has decided anything yet.
    assert replay.steps[0].decisions == ()


def test_a_commander_out_of_contact_never_repeats_a_hold(tmp_path, monkeypatch) -> None:
    """A hold is a decision about an enemy.

    Repeating one with nothing in sight, and no situation change to trigger a
    rethink, strands the section where it stopped for the rest of the run.
    """
    from athena.hosted.runner import _standing_order
    from athena.models import HoldAction as Hold, MoveAction, MoveDirection
    from athena.resolvers.movement import MovementResolver
    from athena.world_state import Battlefield, Soldier
    from athena.models import Position, Team

    commander = Soldier(
        Team.BLUE,
        Position(x=0, y=0, z=0),
        section_id="a",
        is_commander=True,
        waypoints=(Position(x=20, y=0, z=0),),
    )
    battlefield = Battlefield(
        width=30,
        height=1,
        soldiers=[commander],
        surface={Position(x=x, y=0, z=0) for x in range(30)},
    )
    held = ChosenTurn(action=Hold(), rationale="holding")

    out_of_contact = _standing_order(
        battlefield, commander, MovementResolver(), held, in_contact=False
    )
    in_contact = _standing_order(
        battlefield, commander, MovementResolver(), held, in_contact=True
    )

    assert isinstance(out_of_contact.action, MoveAction)
    assert out_of_contact.action.direction == MoveDirection.EAST
    assert in_contact.action == Hold()


def test_an_agent_sets_how_long_its_own_order_stands() -> None:
    """Ticks are serial, so a tick that needs no call costs no wall time.

    Letting a commander say "this stands for ten ticks" is what turns an
    approach from ten identical decisions into one.
    """
    from athena.models import HoldAction as Hold
    from athena.params import MAX_ORDER_TICKS

    default = ChosenTurn(action=Hold(), rationale="x")
    extended = ChosenTurn(action=Hold(), rationale="x", hold_for=MAX_ORDER_TICKS)

    assert default.hold_for == 1
    assert extended.hold_for == MAX_ORDER_TICKS
    # Required in the schema the model sees, or it would simply omit it and
    # every order would silently last one tick.
    assert "hold_for" in ChosenTurn.model_json_schema()["required"]


def test_a_ticks_decisions_go_out_concurrently(tmp_path, monkeypatch) -> None:
    """Ticks are serial, so a tick costs its slowest single decision.

    Concurrent requests overlap on the provider side; one batched request would
    instead serialise every decision inside a single generation. That was
    measured — batching took a 120-tick run from 290 s to over 600 s.
    """
    payload_path = tmp_path / "payload.json"
    payload_path.write_text(json.dumps(_payload()), encoding="utf-8")

    in_flight = 0
    peak = 0

    async def decide(**_):
        nonlocal in_flight, peak
        in_flight += 1
        peak = max(peak, in_flight)
        await asyncio.sleep(0)
        in_flight -= 1
        return ChosenTurn(action=HoldAction(), rationale="holding")

    monkeypatch.setattr(runner, "choose_action", decide)
    _, outcome = asyncio.run(
        runner.run_payload_simulation(payload_path, ticks=1, model=None, seed=3)
    )

    # Both soldiers command themselves and both decide on tick one, in flight
    # together rather than one after the other.
    assert peak == 2
    assert outcome.model_calls == 2


def test_one_commander_failing_costs_its_turn_and_not_the_run(
    tmp_path, monkeypatch
) -> None:
    payload_path = tmp_path / "payload.json"
    payload_path.write_text(json.dumps(_payload()), encoding="utf-8")

    async def always_fails(**_):
        raise TimeoutError("provider timed out")

    monkeypatch.setattr(runner, "choose_action", always_fails)
    replay, outcome = asyncio.run(
        runner.run_payload_simulation(payload_path, ticks=3, model=None, seed=5)
    )

    # The run still completes, on standing orders.
    assert outcome.ticks == 3
    assert len(replay.steps) == 4


def test_a_run_reports_where_it_has_got_to_every_tick(tmp_path, monkeypatch) -> None:
    """A run takes minutes and used to say nothing until it finished.

    An operator watching a progress bar could not tell a slow run from a hung
    one, which is most of why a single run felt like it took forever.
    """
    payload_path = tmp_path / "payload.json"
    payload_path.write_text(json.dumps(_payload()), encoding="utf-8")
    monkeypatch.setattr(runner, "choose_action", _all_hold("holding"))

    seen: list[dict] = []
    asyncio.run(
        runner.run_payload_simulation(
            payload_path,
            ticks=3,
            model=None,
            seed=1,
            on_progress=seen.append,
        )
    )

    assert [p["tick"] for p in seen] == [1, 2, 3]
    assert all(p["ticks"] == 3 for p in seen)
    # Enough to render a live picture rather than only a bar.
    assert seen[-1]["blueAlive"] == 1
    assert seen[-1]["redAlive"] == 1
    assert "modelCalls" in seen[-1]
    assert "shotsFired" in seen[-1]


def test_a_run_without_a_progress_reporter_still_runs(tmp_path, monkeypatch) -> None:
    payload_path = tmp_path / "payload.json"
    payload_path.write_text(json.dumps(_payload()), encoding="utf-8")
    monkeypatch.setattr(runner, "choose_action", _all_hold())

    _, outcome = asyncio.run(
        runner.run_payload_simulation(payload_path, ticks=2, model=None, seed=1)
    )

    assert outcome.ticks == 2
