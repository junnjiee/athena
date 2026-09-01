"""Orders built from a drawn plan.

The behaviour under test is the one that made every hosted batch report
"inconclusive": objectives and routes were parsed into the payload and then
dropped, so every soldier ran on the compass default and the drawn plan had no
effect on what anyone did.
"""

import asyncio


from athena.hosted import runner
from athena.hosted.orders import MAX_ROUTE_WAYPOINTS, build_soldier_orders
from athena.loaders.terrain_payload import (
    TerrainPayload,
    build_battlefield_from_payload,
)
from athena.models import ChosenTurn, HoldAction
from athena.params import DEFAULT_TEAM_OBJECTIVE_LINES


def _payload(units=None, objectives=()) -> TerrainPayload:
    """A 10x10 grid over a one-degree box, so a cell is 0.1 degrees a side."""
    return TerrainPayload.model_validate(
        {
            "terrain": {
                "bbox": {"west": 0, "south": 0, "east": 1, "north": 1},
                "width": 10,
                "height": 10,
                "cellMeters": 1,
                "classNames": {"0": "Open Ground"},
                "cells": {"elevation": [0] * 100, "cls": [0] * 100},
            },
            "units": units
            if units is not None
            else [
                {
                    "id": "blue-1",
                    "side": "blue",
                    "name": "Blue 1",
                    "position": {"longitude": 0.15, "latitude": 0.85},
                },
                {
                    "id": "red-1",
                    "side": "red",
                    "name": "Red 1",
                    "position": {"longitude": 0.85, "latitude": 0.15},
                },
            ],
            "objectives": list(objectives),
        }
    )


def test_a_plan_with_nothing_drawn_leaves_the_prompt_untouched() -> None:
    # No objectives and no routes means there is nothing to say that the engine
    # default does not already say, so the prompt must be byte-identical to what
    # it was before per-soldier orders existed.
    assert build_soldier_orders(_payload()) == (None, None)


def test_an_objective_is_its_owner_s_to_take_and_the_other_side_s_to_deny() -> None:
    orders = build_soldier_orders(
        _payload(
            objectives=[
                {
                    "id": "obj-1",
                    "name": "OBJ BRAVO",
                    "description": "the crossroads",
                    "position": {"longitude": 0.55, "latitude": 0.35},
                    "radiusMeters": 3.0,
                    "side": "blue",
                }
            ]
        )
    )
    blue, red = orders

    assert "Your objective is OBJ BRAVO (the crossroads)" in blue
    assert "centred on (5,6)" in blue
    assert "radius of 3 cells" in blue
    assert "hold it" in blue

    assert "The enemy objective is OBJ BRAVO" in red
    assert "Stop them holding it" in red


def test_an_objective_without_a_side_is_contested_by_both() -> None:
    blue, red = build_soldier_orders(
        _payload(
            objectives=[
                {
                    "id": "obj-1",
                    "name": "OBJ ALPHA",
                    "position": {"longitude": 0.55, "latitude": 0.35},
                    "radiusMeters": 2.0,
                }
            ]
        )
    )
    assert "Your objective is OBJ ALPHA" in blue
    assert "Your objective is OBJ ALPHA" in red


def test_denying_an_objective_replaces_the_compass_default() -> None:
    # Only Blue was given an objective, but Red is not left on "advance west":
    # it is told to stop Blue holding it, which is a directive with real ground
    # attached. Appending the compass line as well would contradict it.
    _, red = build_soldier_orders(
        _payload(
            objectives=[
                {
                    "id": "obj-1",
                    "name": "OBJ BRAVO",
                    "position": {"longitude": 0.55, "latitude": 0.35},
                    "radiusMeters": 2.0,
                    "side": "blue",
                }
            ]
        )
    )
    assert "Stop them holding it" in red
    assert DEFAULT_TEAM_OBJECTIVE_LINES["red"] not in red


def test_a_plan_with_routes_but_no_objectives_keeps_the_compass_default() -> None:
    # Orders are being built because a route exists, so the objectives slot has
    # to say something. With nothing drawn to aim at, that is the engine default.
    blue, red = build_soldier_orders(
        _payload(
            units=[
                {
                    "id": "blue-1",
                    "side": "blue",
                    "name": "Blue 1",
                    "position": {"longitude": 0.15, "latitude": 0.85},
                    "route": [
                        {"longitude": 0.15, "latitude": 0.85},
                        {"longitude": 0.85, "latitude": 0.15},
                    ],
                },
                {
                    "id": "red-1",
                    "side": "red",
                    "name": "Red 1",
                    "position": {"longitude": 0.85, "latitude": 0.15},
                },
            ]
        )
    )
    assert DEFAULT_TEAM_OBJECTIVE_LINES["blue"] in blue
    assert DEFAULT_TEAM_OBJECTIVE_LINES["red"] in red


def test_a_drawn_route_reaches_the_agent_as_cell_waypoints() -> None:
    blue, _ = build_soldier_orders(
        _payload(
            units=[
                {
                    "id": "blue-1",
                    "side": "blue",
                    "name": "Blue 1",
                    "position": {"longitude": 0.15, "latitude": 0.85},
                    "route": [
                        {"longitude": 0.15, "latitude": 0.85},
                        {"longitude": 0.55, "latitude": 0.55},
                        {"longitude": 0.85, "latitude": 0.15},
                    ],
                    "movementType": "prowl",
                },
                {
                    "id": "red-1",
                    "side": "red",
                    "name": "Red 1",
                    "position": {"longitude": 0.85, "latitude": 0.15},
                },
            ]
        )
    )
    assert "axis of advance runs (1,1) -> (5,4) -> (8,8)" in blue
    assert "prefer concealing terrain" in blue


def test_a_long_route_is_thinned_but_keeps_its_ends() -> None:
    # A drawn polyline has as many points as the operator's mouse produced. The
    # agent needs the shape of the axis, and every waypoint is prompt tokens on
    # every call of every tick.
    route = [
        {"longitude": 0.05 + index * 0.09, "latitude": 0.95 - index * 0.09}
        for index in range(10)
    ]
    (blue,) = build_soldier_orders(
        _payload(
            units=[
                {
                    "id": "blue-1",
                    "side": "blue",
                    "name": "Blue 1",
                    "position": {"longitude": 0.05, "latitude": 0.95},
                    "route": route,
                }
            ]
        )
    )
    drawn = blue.split("axis of advance runs ")[1].split(".")[0]
    waypoints = drawn.split(" -> ")
    assert len(waypoints) <= MAX_ROUTE_WAYPOINTS
    assert waypoints[0] == "(0,0)"
    assert waypoints[-1] == "(8,8)"


def test_a_route_shorter_than_one_cell_says_nothing() -> None:
    # Several drawn points inside a single cell collapse to one waypoint, which
    # is not an axis of advance and must not be rendered as one.
    (blue,) = build_soldier_orders(
        _payload(
            units=[
                {
                    "id": "blue-1",
                    "side": "blue",
                    "name": "Blue 1",
                    "position": {"longitude": 0.11, "latitude": 0.89},
                    "route": [
                        {"longitude": 0.11, "latitude": 0.89},
                        {"longitude": 0.12, "latitude": 0.88},
                    ],
                }
            ]
        )
    )
    assert "axis of advance" not in blue


def test_orders_line_up_with_the_soldiers_the_battlefield_builds() -> None:
    # The whole mechanism depends on index i of the orders being index i of
    # battlefield.soldiers. That alignment is an assumption about how
    # build_battlefield_from_payload iterates, so it is asserted rather than
    # trusted.
    payload = _payload(
        objectives=[
            {
                "id": "obj-1",
                "name": "OBJ BRAVO",
                "position": {"longitude": 0.55, "latitude": 0.35},
                "radiusMeters": 2.0,
                "side": "blue",
            }
        ]
    )
    battlefield = build_battlefield_from_payload(payload)
    orders = build_soldier_orders(payload)

    assert len(orders) == len(battlefield.soldiers)
    for soldier, order, unit in zip(battlefield.soldiers, orders, payload.units):
        assert soldier.team.value == unit.side
        assert f"Your soldier identity is {unit.name}." in order


def test_the_runner_gives_each_soldier_its_own_orders(monkeypatch) -> None:
    payload = {
        "terrain": {
            "bbox": {"west": 0, "south": 0, "east": 1, "north": 1},
            "width": 10,
            "height": 10,
            "cellMeters": 1,
            "classNames": {"0": "Open Ground"},
            "cells": {"elevation": [0] * 100, "cls": [0] * 100},
        },
        "units": [
            {
                "id": "blue-1",
                "side": "blue",
                "name": "Blue 1",
                "position": {"longitude": 0.15, "latitude": 0.85},
            },
            {
                "id": "red-1",
                "side": "red",
                "name": "Red 1",
                "position": {"longitude": 0.85, "latitude": 0.15},
            },
        ],
        "objectives": [
            {
                "id": "obj-1",
                "name": "OBJ BRAVO",
                "position": {"longitude": 0.55, "latitude": 0.35},
                "radiusMeters": 2.0,
                "side": "blue",
            }
        ],
    }
    seen: list[str | None] = []

    async def decide(**kwargs):
        seen.append(kwargs.get("team_objectives"))
        return ChosenTurn(action=HoldAction())

    monkeypatch.setattr(runner, "choose_action", decide)
    asyncio.run(
        runner.run_simulation(
            TerrainPayload.model_validate(payload),
            ticks=1,
            model=None,
        )
    )

    assert len(seen) == 2
    assert "Your objective is OBJ BRAVO" in seen[0]
    assert "The enemy objective is OBJ BRAVO" in seen[1]
