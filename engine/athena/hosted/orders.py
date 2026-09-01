"""Turn a drawn plan into the orders a soldier-agent is actually given.

A payload carries what the commander drew: objectives with a radius, and a
movement arrow per marker with a gait. None of it reached an agent before, so
every hosted soldier ran on ``DEFAULT_TEAM_OBJECTIVES`` -- "Blue: advance east,
Red: advance west" -- regardless of the plan. Two forces drawn fifteen metres
apart would walk past each other in opposite directions.

The mechanism this uses already existed: ``choose_action`` takes a
``team_objectives`` string, and ``demo2`` builds a different one per soldier,
including per-soldier patrol routes. This module is that pattern applied to an
uploaded plan instead of a hand-authored scenario.

These are *orders*, not physics. A route tells an agent where to go; how far it
gets in a tick is decided by its movement allowance and the ground it crosses,
in ``MovementResolver``. The gait is the one place the two meet: it sets that
allowance when the battlefield is built, and it is restated here as guidance so
the agent knows what it is meant to be doing with it.
"""

from athena.loaders.terrain_payload import (
    PayloadObjective,
    PayloadUnit,
    TerrainPayload,
    project_cell,
)
from athena.params import DEFAULT_TEAM_OBJECTIVE_LINES

MAX_ROUTE_WAYPOINTS = 6
"""Waypoints kept from a drawn route.

An arrow is a polyline with as many points as the operator's mouse produced.
The agent needs the shape of the axis, not its sampling resolution, and every
waypoint is prompt tokens on every call of every tick.
"""

GAIT_GUIDANCE = {
    "prowl": (
        "Move covertly: prefer concealing terrain and avoid open ground, "
        "even where that is slower or less direct."
    ),
    "patrol": (
        "Move at a steady pace, balancing cover against progress along your axis."
    ),
    "charge": (
        "Close with the enemy as directly as you can; speed matters more than cover."
    ),
}


def _describe_objective(
    objective: PayloadObjective,
    payload: TerrainPayload,
    *,
    owned: bool,
) -> str:
    """One order line for an objective, in the grid coordinates agents use."""
    grid = payload.terrain
    x, y = project_cell(objective.position, grid.bbox, grid.width, grid.height)
    radius_cells = round(objective.radius_meters / grid.cell_meters)
    detail = f" ({objective.description})" if objective.description else ""
    if owned:
        return (
            f"\n- Your objective is {objective.name}{detail}, centred on "
            f"({x},{y}) with a radius of {radius_cells} cells. Move to it and "
            "hold it."
        )
    return (
        f"\n- The enemy objective is {objective.name}{detail}, centred on "
        f"({x},{y}) with a radius of {radius_cells} cells. Stop them holding it."
    )


def _thin(points: tuple, limit: int) -> list:
    """Keep at most ``limit`` points, always including the first and last."""
    if len(points) <= limit:
        return list(points)
    step = (len(points) - 1) / (limit - 1)
    return [points[round(index * step)] for index in range(limit)]


def _describe_route(unit: PayloadUnit, payload: TerrainPayload) -> str:
    """Order lines for the movement arrow drawn from this soldier's marker."""
    if not unit.route:
        return ""

    grid = payload.terrain
    cells = [
        project_cell(point, grid.bbox, grid.width, grid.height)
        for point in _thin(unit.route, MAX_ROUTE_WAYPOINTS)
    ]
    # Consecutive duplicates say nothing and cost tokens: a drawn arrow shorter
    # than the grid's cell size projects several points onto one cell.
    waypoints = [cells[0]]
    for cell in cells[1:]:
        if cell != waypoints[-1]:
            waypoints.append(cell)

    if len(waypoints) == 1:
        return ""

    drawn = " -> ".join(f"({x},{y})" for x, y in waypoints)
    lines = (
        f"\n- Your assigned axis of advance runs {drawn}. Work along it in "
        "order, covering as much ground each tick as your movement allowance "
        "permits, and deviate only where terrain or the enemy makes that "
        "necessary. Hold at the final waypoint once you reach it."
    )
    guidance = GAIT_GUIDANCE.get((unit.movement_type or "").lower())
    if guidance:
        lines += f"\n- {guidance}"
    return lines


def build_soldier_orders(payload: TerrainPayload) -> tuple[str | None, ...]:
    """Orders for each unit in the payload, in ``payload.units`` order.

    ``build_battlefield_from_payload`` appends one soldier per payload unit in
    that same order, so index *i* here is ``battlefield.soldiers[i]``.

    ``None`` means "say nothing new", which leaves ``build_system_prompt`` on its
    own default -- so a plan with no objectives and no routes produces exactly
    the prompt it did before this existed.
    """
    if not payload.objectives and not any(unit.route for unit in payload.units):
        return tuple(None for _ in payload.units)

    orders: list[str | None] = []
    for unit in payload.units:
        side = unit.side.lower()
        objective_lines = "".join(
            _describe_objective(
                objective,
                payload,
                owned=objective.side is None or objective.side.lower() == side,
            )
            for objective in payload.objectives
        )
        if not objective_lines:
            objective_lines = DEFAULT_TEAM_OBJECTIVE_LINES.get(side, "")

        orders.append(
            objective_lines
            + f"\n- Your soldier identity is {unit.name}."
            + _describe_route(unit, payload)
        )

    return tuple(orders)
