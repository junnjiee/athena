import argparse
import asyncio
import sys
from collections import Counter
from contextlib import redirect_stdout
from math import ceil
from functools import partial
from io import StringIO
from pathlib import Path
from shutil import get_terminal_size

from dotenv import load_dotenv

from athena.agent import choose_action
from athena.params import (
    COMMUNICATION_HISTORY_LIMIT,
    MAX_ACTION_ATTEMPTS,
    TERRAIN_PROFILES,
    VISIBILITY_HISTORY_LIMIT,
)
from athena.ollama_agent import (
    OllamaUnavailable,
    choose_action_local,
    resolve_local_model,
)
from athena.world_state import Battlefield
from athena.loaders import (
    PayloadError,
    build_battlefield_from_payload,
    load_payload,
)
from athena.loop import ActionChooser, LoopEngine
from athena.resolvers.movement import MovementResolver
from athena.replay import ReplayRecorder
from athena.resolvers.vision import VisionResolver
from athena.world_state import Soldier
from athena.models import (
    AgentContext,
    CommunicationGroup,
    ExecutionResult,
    HoldAction,
    MoveAction,
    ObservedSoldier,
    Position,
    ShootAction,
    SurvivalState,
    Team,
    TERRAIN_GLYPHS,
    TERRAIN_LABELS,
    TerrainClass,
)

OLLAMA_PREFIX = "ollama:"

ELEVATION_RAMP = (148, 226, 214, 208, 130, 94)
"""256-colour codes for rising ground, pale green through dark brown.

The lowest band is deliberately left uncoloured so flat terrain renders as
plain text rather than a wash of colour.
"""


def elevation_color(elevation: int, lowest: int, highest: int) -> int | None:
    """Pick a ramp colour for an elevation within the map's own range.

    Banding is relative to the surface actually present, so a map spanning
    three levels and one spanning twenty-six both use the full ramp. Returns
    None for flat maps and for the lowest band.
    """
    if highest <= lowest:
        return None

    span = highest - lowest
    band = ceil((elevation - lowest) / span * len(ELEVATION_RAMP))
    if band <= 0:
        return None

    return ELEVATION_RAMP[min(band, len(ELEVATION_RAMP)) - 1]


def elevation_bounds(battlefield: Battlefield) -> tuple[int, int]:
    elevations = [position.z for position in battlefield.surface]
    return min(elevations), max(elevations)


def cell_symbol(battlefield: Battlefield, position: Position) -> str:
    """Glyph for a cell: occupants win, otherwise the terrain class."""
    soldiers = [
        soldier for soldier in battlefield.soldiers if soldier.position == position
    ]
    if len(soldiers) > 1:
        return "*"
    if len(soldiers) == 1:
        return soldier_symbol(soldiers[0])

    return TERRAIN_GLYPHS[battlefield.terrain_for(position)]


DEFAULT_RENDER_COLUMNS = 118
DEFAULT_PAYLOAD_PATH = Path("payload.txt")

BLUE_CELLS = ((80, 192), (80, 194), (80, 196), (81, 193), (81, 195), (82, 194))
RED_CELLS = ((94, 193), (94, 196))
VISION_RANGE = 10.0
"""Where the two sides start, in grid cells on the loaded export.

Mixed ground was chosen over the export's dominant forest so terrain actually
informs a decision: dense forest to the west, urban blocks to the east, a road
running between them. Blue is west and Red east because the objectives send
Blue east and Red west -- deployed north and south they would advance away from
each other. The closest pair is about twelve metres apart, just outside the
vision range above, so contact comes after a few ticks rather than at tick 0.
"""

GROUP_ABBREVIATIONS = {"blue-team": "BT", "red-team": "RT"}
DIRECTION_ABBREVIATIONS = {
    "north": "N",
    "northeast": "NE",
    "east": "E",
    "southeast": "SE",
    "south": "S",
    "southwest": "SW",
    "west": "W",
    "northwest": "NW",
}
RULE_WIDTH = 120
"""Cap on the tick separator, so it never soft-wraps a narrow terminal."""


def map_frame(battlefield: Battlefield, columns: int = DEFAULT_RENDER_COLUMNS) -> str:
    """Render the entire map, never cropping.

    Cells print at full resolution while the map fits the terminal, and are
    aggregated into blocks once it does not. Coverage is preserved either way;
    only resolution is traded.
    """
    if battlefield.width * 2 <= columns:
        return _detailed_map(battlefield)
    return _aggregated_map(battlefield, columns)


def _detailed_map(battlefield: Battlefield) -> str:
    """One glyph per cell, space separated."""
    lowest, highest = elevation_bounds(battlefield)
    lines = []
    for y in range(battlefield.height):
        row: list[str] = []
        for x in range(battlefield.width):
            position = battlefield.position_at(x, y)
            if position is None:
                raise RuntimeError(f"battlefield surface missing position at {(x, y)}")

            symbol = cell_symbol(battlefield, position)
            if color := elevation_color(position.z, lowest, highest):
                symbol = f"\033[38;5;{color}m{symbol}\033[0m"
            row.append(symbol)
        lines.append(" ".join(row))
    return "\n".join(lines)


def _aggregated_map(battlefield: Battlefield, columns: int) -> str:
    """One glyph per block of cells, sized to fit the terminal width."""
    width, height = battlefield.width, battlefield.height
    block_x = max(1, -(-width // max(1, columns)))
    # Terminal cells are about twice as tall as wide, so the vertical block is
    # twice the horizontal one to keep the map's real proportions.
    block_y = block_x * 2

    # Majority would paint a mostly-forest map entirely as forest and hide
    # every road and building. Rarer classes carry the information, so each
    # block reports the least common class it contains.
    frequency = Counter(battlefield.terrain_classes)
    salience = {
        terrain_class: rank
        for rank, terrain_class in enumerate(
            sorted(frequency, key=lambda cls: frequency[cls])
        )
    }
    occupants = {
        (soldier.position.x // block_x, soldier.position.y // block_y): soldier
        for soldier in battlefield.soldiers
    }
    lowest, highest = elevation_bounds(battlefield)
    elevation_by_xy = {
        (position.x, position.y): position.z for position in battlefield.surface
    }

    lines = [
        f"{width}x{height} at {block_x}x{block_y} m/char  "
        f"elevation {lowest}..{highest}  {len(battlefield.soldiers)} units"
    ]
    for top in range(0, height, block_y):
        row = []
        for left in range(0, width, block_x):
            soldier = occupants.get((left // block_x, top // block_y))
            if soldier is not None:
                row.append(f"\033[1;97m{soldier_symbol(soldier)}\033[0m")
                continue

            rarest = None
            total = count = 0
            for y in range(top, min(top + block_y, height)):
                for x in range(left, min(left + block_x, width)):
                    terrain_class = battlefield.terrain_at(x, y)
                    if rarest is None or salience[terrain_class] < salience[rarest]:
                        rarest = terrain_class
                    total += elevation_by_xy[(x, y)]
                    count += 1

            glyph = TERRAIN_GLYPHS[rarest]
            color = elevation_color(round(total / count), lowest, highest)
            row.append(f"\033[38;5;{color}m{glyph}\033[0m" if color else glyph)
        lines.append("".join(row))

    return "\n".join(lines)


def _ruler_lines(x0: int, x1: int) -> list[str]:
    """Column ruler. A hundreds row appears once the box runs past x=99.

    Solid digit rows rather than sparse labels every ten columns: labels would
    take more than one character and break the one-character-per-cell alignment
    that the whole view depends on. Read the rows downward to get x to the
    nearest ten, then count across. Digits are the real coordinates, so a box
    starting at x=74 opens with a 7, not a 0.
    """
    rows = []
    if x1 >= 100:
        rows.append(
            f"{'':<5}" + "".join(str(x // 100 % 10) for x in range(x0, x1 + 1))
        )
    rows.append(f"{'':<5}" + "".join(str(x // 10 % 10) for x in range(x0, x1 + 1)))
    return rows


def full_bounds(battlefield: Battlefield) -> tuple[int, int, int, int]:
    """The whole map, as an inclusive box."""
    return 0, 0, battlefield.width - 1, battlefield.height - 1


def soldier_bounds(
    battlefield: Battlefield, margin: int = 6
) -> tuple[int, int, int, int]:
    """The smallest box holding every soldier, plus a margin of ground.

    Every soldier, not just the living ones: a casualty or a body is still
    something you want to see, and tracking only the living would let bodies
    fall out of view as the fight moves on.

    Deliberately uncapped. The box is defined by the soldiers, so a soldier
    cannot fall outside it -- that guarantee is the whole point, and capping
    would have to break it or start aggregating cells. If the sides scatter to
    opposite corners this returns the full map, which is merely the behaviour
    without the flag.
    """
    if not battlefield.soldiers:
        return full_bounds(battlefield)

    xs = [soldier.position.x for soldier in battlefield.soldiers]
    ys = [soldier.position.y for soldier in battlefield.soldiers]
    return (
        max(0, min(xs) - margin),
        max(0, min(ys) - margin),
        min(battlefield.width - 1, max(xs) + margin),
        min(battlefield.height - 1, max(ys) + margin),
    )


def map_lines(
    battlefield: Battlefield,
    bounds: tuple[int, int, int, int],
    color: bool = True,
) -> list[str]:
    """A box of the battlefield at one character per cell, never aggregated.

    Colour is emitted run-length -- an escape only where the elevation band
    changes -- rather than around every cell. On a full 354x400 export that is
    the difference between a ~2 MB frame and a ~183 KB one, and since bands are
    contiguous the output is identical on screen.
    """
    x0, y0, x1, y1 = bounds
    lowest, highest = elevation_bounds(battlefield)
    elevation = {
        (position.x, position.y): position.z for position in battlefield.surface
    }
    occupants: dict[tuple[int, int], str] = {}
    for soldier in battlefield.soldiers:
        key = (soldier.position.x, soldier.position.y)
        occupants[key] = "*" if key in occupants else soldier_symbol(soldier)

    lines = _ruler_lines(x0, x1)
    for y in range(y0, y1 + 1):
        row = [f"{y:<5}"]
        shade_now: int | None = None
        for x in range(x0, x1 + 1):
            occupant = occupants.get((x, y))
            if occupant is not None:
                # Bold white, so eight soldiers stay findable among 141,600 cells.
                row.append(f"\033[1;97m{occupant}\033[0m" if color else occupant)
                shade_now = None
                continue

            glyph = TERRAIN_GLYPHS[battlefield.terrain_at(x, y)]
            shade = (
                elevation_color(elevation[(x, y)], lowest, highest) if color else None
            )
            if shade != shade_now:
                row.append(f"\033[38;5;{shade}m" if shade else "\033[0m")
                shade_now = shade
            row.append(glyph)
        if shade_now is not None:
            row.append("\033[0m")
        lines.append("".join(row))
    return lines


def window_legend(
    battlefield: Battlefield, bounds: tuple[int, int, int, int]
) -> str:
    """Legend covering only the classes inside the drawn box.

    terrain_legend names every class on the map, which on a minimap would list
    ground the viewer cannot see.
    """
    x0, y0, x1, y1 = bounds
    present = sorted(
        {
            battlefield.terrain_at(x, y)
            for y in range(y0, y1 + 1)
            for x in range(x0, x1 + 1)
        }
    )
    return " ".join(
        f"{TERRAIN_GLYPHS[terrain_class]}={TERRAIN_LABELS[terrain_class]}"
        for terrain_class in present
    )


def _agent_id(index: int, team: Team) -> str:
    return f"{team.value[0].upper()}{index}"


def _visible_ids(observation: ObservedSoldier, battlefield: Battlefield) -> str:
    """Name the soldiers an observation can see, by agent id."""
    ids = []
    for seen in observation.visible_soldiers:
        for index, soldier in enumerate(battlefield.soldiers):
            if (
                soldier.team == seen.team
                and soldier.position == seen.position
                and soldier.survival_status == seen.survival_status
            ):
                ids.append(_agent_id(index, soldier.team))
                break
    return ",".join(ids) or "-"


def _action_text(
    index: int,
    action,
    execution_result: ExecutionResult | None,
) -> str:
    if execution_result is None:
        return "waiting"
    if action is None:
        return "none"
    if isinstance(action, HoldAction):
        return "hold"
    if isinstance(action, MoveAction):
        moved = (
            execution_result.before.soldiers[index].position
            != execution_result.after.soldiers[index].position
        )
        code = DIRECTION_ABBREVIATIONS.get(action.direction.value, action.direction.value)
        return f"move {code} {'ok' if moved else 'rejected'}"

    outcome = next(
        (o for o in execution_result.shot_outcomes if o.shooter_index == index),
        None,
    )
    target = next(
        (
            _agent_id(other, snapshot.team)
            for other, snapshot in enumerate(execution_result.before.soldiers)
            if snapshot.position == action.target_position
        ),
        "?",
    )
    if outcome is None:
        return f"shoot {target} invalid"
    return f"shoot {target} {'hit' if outcome.hit else 'miss'}"


def _panel_lines(
    battlefield: Battlefield,
    observations: list[ObservedSoldier],
    execution_result: ExecutionResult | None,
) -> list[str]:
    """Per-soldier state: what it did, what it sees, what it said.

    Positions and sightings come from the live battlefield and the current
    observations, so the panel describes the same instant as the map above it.
    """
    messages = {
        message.sender_index: message
        for message in (execution_result.team_messages if execution_result else ())
    }
    actions = execution_result.actions if execution_result else ()

    lines = ["ID   pos        action/result   V: current view   C: comms"]
    for index, observation in enumerate(observations):
        soldier = battlefield.soldiers[index]
        action = actions[index] if index < len(actions) else None
        line = (
            f"{_agent_id(index, soldier.team):<4} "
            f"{soldier.position.x},{soldier.position.y:<6} "
            f"{_action_text(index, action, execution_result):<15} "
            f"V:{_visible_ids(observation, battlefield):<15} "
            f"[{soldier.survival_status.value[0].upper()}]"
        )
        if message := messages.get(index):
            group = GROUP_ABBREVIATIONS.get(message.group_id, message.group_id)
            line += f" C:{group} {' '.join(message.content.split())}"
        lines.append(line)

    if execution_result is not None:
        submitted = sum(isinstance(a, MoveAction) for a in execution_result.actions)
        accepted = sum(
            before.position != after.position
            for before, after in zip(
                execution_result.before.soldiers, execution_result.after.soldiers
            )
        )
        holds = sum(isinstance(a, HoldAction) for a in execution_result.actions)
        shots = sum(isinstance(a, ShootAction) for a in execution_result.actions)
        hits = sum(outcome.hit for outcome in execution_result.shot_outcomes)
        lines.append(
            f"Last: moves {accepted}/{submitted}, holds {holds}, "
            f"hits {hits}/{shots}, messages {len(execution_result.team_messages)}"
        )
    return lines


def _tick_rule(label: str, columns: int) -> str:
    text = f"== {label} "
    return text + "=" * max(0, min(columns, RULE_WIDTH) - len(text))


def terrain_legend(battlefield: Battlefield) -> str:
    """Legend covering only the classes this battlefield actually contains."""
    present = sorted(set(battlefield.terrain_classes))
    return " ".join(
        f"{TERRAIN_GLYPHS[terrain_class]}={TERRAIN_LABELS[terrain_class]}"
        for terrain_class in present
    )


def adapt_local_action_chooser(model: str) -> ActionChooser:
    """Keep Ollama on its current-observation-only request contract."""

    async def choose_from_current_observation(
        agent_context: AgentContext,
        battlefield: Battlefield,
        soldier: Soldier,
        movement_resolver: MovementResolver,
        max_attempts: int = MAX_ACTION_ATTEMPTS,
        visibility_history_limit: int = VISIBILITY_HISTORY_LIMIT,
        communication_history_limit: int = COMMUNICATION_HISTORY_LIMIT,
    ):
        return await choose_action_local(
            observed_soldier=agent_context.current_observation,
            battlefield=battlefield,
            soldier=soldier,
            movement_resolver=movement_resolver,
            max_attempts=max_attempts,
            model=model,
        )

    return choose_from_current_observation


# Map a --model spec to an action chooser: None=hosted default, ollama:*=local, else an OpenRouter id; logs the choice.
def build_action_chooser(model_spec: str | None) -> ActionChooser:
    if model_spec is None:
        print("[athena] agent: OpenRouter (default hosted model)", file=sys.stderr)
        return choose_action

    if model_spec.startswith(OLLAMA_PREFIX):
        name = model_spec[len(OLLAMA_PREFIX):]
        resolved = resolve_local_model(None if name == "auto" else name)
        print(f"[athena] agent: Ollama local model '{resolved}'", file=sys.stderr)
        return adapt_local_action_chooser(resolved)

    print(f"[athena] agent: OpenRouter model '{model_spec}'", file=sys.stderr)
    return partial(choose_action, model=model_spec)


def soldier_symbol(soldier: Soldier) -> str:
    if soldier.survival_status == SurvivalState.DEAD:
        return "x"

    symbol = "B" if soldier.team == Team.BLUE else "R"
    if soldier.survival_status == SurvivalState.CASUALTY:
        return symbol.lower()

    return symbol


def render_execution_result(result: ExecutionResult) -> None:
    shot_outcomes_by_shooter = {
        outcome.shooter_index: outcome for outcome in result.shot_outcomes
    }
    print("Actions")
    for soldier_index, action in enumerate(result.actions):
        soldier_before = result.before.soldiers[soldier_index]
        soldier_after = result.after.soldiers[soldier_index]
        prefix = f"  soldier {soldier_index} {soldier_before.team.value}:"

        if action is None:
            print(f"{prefix} none")
        elif isinstance(action, HoldAction):
            print(f"{prefix} hold")
        elif isinstance(action, MoveAction):
            outcome = (
                "accepted"
                if soldier_before.position != soldier_after.position
                else "rejected"
            )
            print(f"{prefix} move {action.direction.value} ({outcome})")
        elif isinstance(action, ShootAction):
            target = action.target_position
            outcome = shot_outcomes_by_shooter.get(soldier_index)
            if outcome is None:
                resolution = "invalid"
            else:
                resolution = (
                    f"{'hit' if outcome.hit else 'miss'}, "
                    f"p={outcome.hit_probability:.0%}, roll={outcome.roll:.3f}"
                )
            print(
                f"{prefix} shoot ({target.x},{target.y},{target.z}) "
                f"({resolution})"
            )

    print()
    print("Team communications")
    if result.team_messages:
        for message in result.team_messages:
            print(
                f"  soldier {message.sender_index} -> {message.group_id}: "
                f"{message.content}"
            )
    else:
        print("  none")
    print()
    print("State changes")
    changes: list[str] = []
    for soldier_before, soldier_after in zip(
        result.before.soldiers,
        result.after.soldiers,
    ):
        change_parts: list[str] = []
        if soldier_before.position != soldier_after.position:
            change_parts.append(
                f"position "
                f"({soldier_before.position.x},{soldier_before.position.y},"
                f"{soldier_before.position.z}) -> "
                f"({soldier_after.position.x},{soldier_after.position.y},"
                f"{soldier_after.position.z})"
            )
        if soldier_before.survival_status != soldier_after.survival_status:
            change_parts.append(
                f"status {soldier_before.survival_status.value}"
                f" -> {soldier_after.survival_status.value}"
            )
        if change_parts:
            changes.append(
                f"  soldier {soldier_before.soldier_index} "
                f"{soldier_before.team.value}: " + "; ".join(change_parts)
            )

    if changes:
        print("\n".join(changes))
    else:
        print("  none")
    print()


def _print_demo_frame(
    label: str,
    battlefield: Battlefield,
    observations: list[ObservedSoldier],
    execution_result: ExecutionResult | None = None,
) -> None:
    print(label)
    print(map_frame(battlefield, get_terminal_size(fallback=(DEFAULT_RENDER_COLUMNS, 24)).columns))
    print(
        "B/R=living blue/red b/r=blue/red casualty x=dead *=multiple"
    )
    print(terrain_legend(battlefield))
    print()
    if execution_result is not None:
        render_execution_result(execution_result)

    print("Visible information")
    for index, observation in enumerate(observations):
        visible_soldiers = [
            f"{soldier.team.value}@"
            f"({soldier.position.x},{soldier.position.y},{soldier.position.z})"
            for soldier in observation.visible_soldiers
        ]
        visible_soldiers_text = ", ".join(visible_soldiers) or "none"
        terrain_cells = observation.available_terrain
        # Open ground is the default and says nothing; only name what stands out.
        notable_terrain = Counter(
            cell.terrain
            for cell in terrain_cells
            if cell.terrain_class != TerrainClass.OPEN_GROUND
        )
        terrain_summary = (
            ", ".join(
                f"{count} {name}" for name, count in notable_terrain.most_common()
            )
            or "all open ground"
        )

        print(
            f"  soldier {index} "
            f"{observation.team.value}@"
            f"({observation.position.x},{observation.position.y},"
            f"{observation.position.z}) "
            f"[{observation.survival_status.value}] "
            f"sees: {visible_soldiers_text}; "
            f"terrain: {len(terrain_cells)} cells "
            f"({terrain_summary})"
        )

    print()


def render_demo_frame(
    label: str,
    battlefield: Battlefield,
    observations: list[ObservedSoldier],
    execution_result: ExecutionResult | None = None,
) -> None:
    """Render a complete frame in one flushed write to avoid partial redraws."""
    frame = StringIO()
    with redirect_stdout(frame):
        _print_demo_frame(label, battlefield, observations, execution_result)

    sys.stdout.write(f"\033[H\033[2J{frame.getvalue()}")
    sys.stdout.flush()


def scroll_frame(
    label: str,
    battlefield: Battlefield,
    observations: list[ObservedSoldier],
    execution_result: ExecutionResult | None = None,
    columns: int = DEFAULT_RENDER_COLUMNS,
    color: bool = True,
    minimap: bool = False,
) -> str:
    """One tick: a rule, the map, then the per-soldier panel beneath it."""
    bounds = soldier_bounds(battlefield) if minimap else full_bounds(battlefield)
    x0, y0, x1, y1 = bounds

    lines = [_tick_rule(label, columns)]
    if minimap:
        # The box moves with the soldiers, so it has to say where it is.
        lines.append(
            f"   x {x0}..{x1}, y {y0}..{y1} "
            f"({x1 - x0 + 1}x{y1 - y0 + 1} of {battlefield.width}x"
            f"{battlefield.height})"
        )
    lines.extend(map_lines(battlefield, bounds, color))
    lines.append("")
    lines.append(
        f"B/R=living b/r=casualty x=dead *=multiple   "
        f"{window_legend(battlefield, bounds)}"[:columns]
    )
    tallies = []
    for team in (Team.BLUE, Team.RED):
        soldiers = [s for s in battlefield.soldiers if s.team == team]
        alive = sum(s.survival_status == SurvivalState.ALIVE for s in soldiers)
        casualties = sum(s.survival_status == SurvivalState.CASUALTY for s in soldiers)
        dead = sum(s.survival_status == SurvivalState.DEAD for s in soldiers)
        tallies.append(f"{team.value.title()} A{alive} C{casualties} D{dead}")
    lines.append(
        " | ".join(tallies) + f" | separation {closest_separation(battlefield):.1f} m"
    )
    lines.extend(_panel_lines(battlefield, observations, execution_result))
    return "\n".join(lines) + "\n"


def render_scroll_frame(
    label: str,
    battlefield: Battlefield,
    observations: list[ObservedSoldier],
    execution_result: ExecutionResult | None = None,
    color: bool = True,
    minimap: bool = False,
) -> None:
    """Append a frame below the last, in one flushed write.

    Deliberately no clear-screen and no alternate buffer: the point is that
    every past tick stays in scrollback.
    """
    sys.stdout.write(
        "\n"
        + scroll_frame(
            label,
            battlefield,
            observations,
            execution_result,
            get_terminal_size(fallback=(100, 24)).columns,
            color,
            minimap,
        )
    )
    sys.stdout.flush()


def both_teams_have_living_soldiers(battlefield: Battlefield) -> bool:
    living_teams = {
        soldier.team
        for soldier in battlefield.soldiers
        if soldier.survival_status == SurvivalState.ALIVE
    }
    return Team.BLUE in living_teams and Team.RED in living_teams


def build_battlefield(payload_path: str | Path = DEFAULT_PAYLOAD_PATH) -> Battlefield:
    """Load the export's terrain, then put our own troops on it.

    The export decides where the ground is; the scenario decides who stands on
    it. Its own laydown is not usable: it spreads seven echelons up to 240 cells
    apart, so at any vision range the engine uses the two sides never see each
    other and the run reaches its tick limit without a shot.
    """
    payload = load_payload(payload_path)
    terrain = build_battlefield_from_payload(payload, include_units=False)
    heights = {(position.x, position.y): position.z for position in terrain.surface}

    soldiers = []
    for team, cells in ((Team.BLUE, BLUE_CELLS), (Team.RED, RED_CELLS)):
        for x, y in cells:
            if not (0 <= x < terrain.width and 0 <= y < terrain.height):
                raise PayloadError(
                    f"({x},{y}) is outside the {terrain.width}x{terrain.height} map"
                )
            terrain_class = terrain.terrain_at(x, y)
            if not TERRAIN_PROFILES[terrain_class].passable:
                raise PayloadError(
                    f"({x},{y}) is {TERRAIN_LABELS[terrain_class]}, "
                    "which no soldier can stand on"
                )
            soldiers.append(
                Soldier(
                    team=team,
                    position=Position(x=x, y=y, z=heights[(x, y)]),
                    vision_range=VISION_RANGE,
                    communication_group_ids={f"{team.value}-team"},
                )
            )

    return Battlefield(
        width=terrain.width,
        height=terrain.height,
        soldiers=soldiers,
        surface=terrain.surface,
        terrain=terrain.terrain_classes,
        communication_groups=[
            CommunicationGroup(
                group_id=f"{team.value}-team",
                name=f"{team.value.capitalize()} team",
                team=team,
            )
            for team in (Team.BLUE, Team.RED)
        ],
    )


def closest_separation(battlefield: Battlefield) -> float:
    """Distance between the nearest Blue-Red pair, in metres."""
    blue = [s for s in battlefield.soldiers if s.team == Team.BLUE]
    red = [s for s in battlefield.soldiers if s.team == Team.RED]
    if not blue or not red:
        return 0.0
    return min(
        (
            (b.position.x - r.position.x) ** 2
            + (b.position.y - r.position.y) ** 2
            + (b.position.z - r.position.z) ** 2
        )
        ** 0.5
        for b in blue
        for r in red
    )


def pin_red(chooser: ActionChooser) -> ActionChooser:
    """Hold Red in place: it still decides, but cannot move off its position.

    Converting the action after the fact rather than skipping Red's turn keeps
    it able to shoot and to radio, so Blue advances against a defence that
    reacts. Skipping the call would make Red inert scenery.
    """

    async def choose(**kwargs):
        turn = await chooser(**kwargs)
        soldier = kwargs["soldier"]
        if (
            turn is not None
            and soldier.team == Team.RED
            and isinstance(turn.action, MoveAction)
        ):
            return turn.model_copy(update={"action": HoldAction()})
        return turn

    return choose


async def run_demo(
    model_spec: str | None = None,
    ticks: int = 60,
    replay_log_path: str | Path | None = None,
    payload_path: str | Path = DEFAULT_PAYLOAD_PATH,
    color: bool = True,
    minimap: bool = False,
) -> None:
    load_dotenv()
    battlefield = build_battlefield(payload_path)

    print(
        f"[athena] terrain: {battlefield.width}x{battlefield.height} from "
        f"{payload_path}; closest blue-red pair "
        f"{closest_separation(battlefield):.1f} m, vision range {VISION_RANGE:.0f} m",
        file=sys.stderr,
    )
    # Warn against the box actually being drawn. In minimap mode that is the
    # starting box, which grows as the soldiers spread -- so this is a floor,
    # not a promise.
    bounds = soldier_bounds(battlefield) if minimap else full_bounds(battlefield)
    required = bounds[2] - bounds[0] + 1 + 5
    actual = get_terminal_size(fallback=(100, 24)).columns
    if actual < required:
        growth = " and it grows as the soldiers spread" if minimap else ""
        print(
            f"[athena] the map needs {required} columns; terminal is {actual}"
            f"{growth} - rows will soft-wrap and the ruler will not line up.",
            file=sys.stderr,
        )

    # build_action_chooser resolves which backend/model to use; everything
    # downstream (loop, rendering, output) is identical regardless.
    loop = LoopEngine(
        battlefield=battlefield,
        vision_resolver=VisionResolver(),
        movement_resolver=MovementResolver(),
        action_chooser=pin_red(build_action_chooser(model_spec)),
    )
    replay_recorder = (
        ReplayRecorder(battlefield.snapshot())
        if replay_log_path is not None
        else None
    )

    try:
        initial_label = (
            "Initial - running tick 1 (waiting for agents)"
            if ticks > 0
            else "Initial"
        )
        render_scroll_frame(
            initial_label,
            battlefield,
            loop.observed_soldiers_map(),
            color=color,
            minimap=minimap,
        )
        for tick_index in range(ticks):
            result = await loop.tick()
            if replay_recorder is not None:
                replay_recorder.record(result)
            completed_tick = tick_index + 1
            battle_finished = not both_teams_have_living_soldiers(battlefield)
            reached_tick_limit = completed_tick == ticks

            if battle_finished:
                label = f"After tick {completed_tick} - battle finished"
            elif reached_tick_limit:
                label = f"After tick {completed_tick} - tick limit reached"
            else:
                label = (
                    f"After tick {completed_tick} - running tick "
                    f"{completed_tick + 1} (waiting for agents)"
                )

            render_scroll_frame(
                label,
                battlefield,
                loop.observed_soldiers_map(),
                execution_result=result,
                color=color,
                minimap=minimap,
            )
            if battle_finished:
                break
    finally:
        if replay_recorder is not None and replay_log_path is not None:
            replay_recorder.save(replay_log_path)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the Athena demo simulation.")
    parser.add_argument(
        "--model",
        default=None,
    )
    parser.add_argument(
        "--ticks",
        type=int,
        default=60,
        help="maximum simulation ticks to run (default: 60)",
    )
    parser.add_argument(
        "--replay-log",
        type=Path,
        default=None,
        help="write result-only replay JSON to this path",
    )
    parser.add_argument(
        "--payload",
        type=Path,
        default=DEFAULT_PAYLOAD_PATH,
        help=f"frontend terrain export to load (default: {DEFAULT_PAYLOAD_PATH})",
    )
    parser.add_argument(
        "--no-color",
        dest="color",
        action="store_false",
        help="plain glyphs; much smaller frames, and the sane choice when "
        "redirecting output to a file",
    )
    parser.add_argument(
        "--minimap",
        action="store_true",
        help="draw only the ground the soldiers occupy, plus a margin, instead "
        "of the whole map. Still one character per cell; the box grows to keep "
        "every soldier inside it",
    )
    parser.add_argument(
        "--deployment",
        action="store_true",
        help="print the start positions and exit, without calling any model",
    )
    args = parser.parse_args()

    try:
        if args.deployment:
            battlefield = build_battlefield(args.payload)
            bounds = (
                soldier_bounds(battlefield)
                if args.minimap
                else full_bounds(battlefield)
            )
            print("\n".join(map_lines(battlefield, bounds, color=args.color)))
            print()
            for index, soldier in enumerate(battlefield.soldiers):
                position = soldier.position
                terrain_class = battlefield.terrain_at(position.x, position.y)
                print(
                    f"    {_agent_id(index, soldier.team):<4} "
                    f"({position.x},{position.y},{position.z})  "
                    f"{TERRAIN_LABELS[terrain_class]}"
                )
            print(
                f"\n    closest blue-red pair "
                f"{closest_separation(battlefield):.1f} m, "
                f"vision range {VISION_RANGE:.0f} m"
            )
            return

        asyncio.run(
            run_demo(
                model_spec=args.model,
                ticks=args.ticks,
                replay_log_path=args.replay_log,
                payload_path=args.payload,
                color=args.color,
                minimap=args.minimap,
            )
        )
    except (OllamaUnavailable, PayloadError) as exc:
        raise SystemExit(f"error: {exc}")


if __name__ == "__main__":
    main()
