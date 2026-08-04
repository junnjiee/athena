import argparse
import asyncio
import sys
from collections import Counter
from collections.abc import Iterable
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
    objective_briefing,
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
    TERRAIN_LABELS,
    TerrainClass,
)

OLLAMA_PREFIX = "ollama:"

TERRAIN_GLYPHS: dict[TerrainClass, str] = {
    TerrainClass.OPEN_GROUND: ".",
    TerrainClass.GRASSLAND: ",",
    TerrainClass.SCRUB: ";",
    TerrainClass.DENSE_FOREST: "^",
    TerrainClass.WETLAND: "_",
    TerrainClass.WATER: "~",
    TerrainClass.URBAN: "o",
    TerrainClass.STRUCTURE: "#",
    TerrainClass.ROAD: "=",
    TerrainClass.BARREN_ROCK: "%",
}

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


MAX_RENDER_WIDTH = 60
MAX_RENDER_HEIGHT = 40


def _median(values: Iterable[int]) -> int:
    ordered = sorted(values)
    return ordered[len(ordered) // 2]


def viewport_bounds(
    battlefield: Battlefield,
    max_width: int = MAX_RENDER_WIDTH,
    max_height: int = MAX_RENDER_HEIGHT,
) -> tuple[int, int, int, int]:
    """Half-open (x0, y0, x1, y1) window of the grid to draw.

    Each cell prints as a glyph plus a space, so a 354-cell row would need 708
    terminal columns. Maps larger than the cap are windowed onto the soldiers
    instead of drawn whole; maps that already fit are returned untouched.
    """
    if battlefield.width <= max_width and battlefield.height <= max_height:
        return 0, 0, battlefield.width, battlefield.height

    width = min(max_width, battlefield.width)
    height = min(max_height, battlefield.height)

    if battlefield.soldiers:
        # Median, not midrange: two forces facing each other across a large map
        # put the midrange in the empty ground between them, framing nobody.
        # The median sits inside whichever group is larger.
        center_x = _median(soldier.position.x for soldier in battlefield.soldiers)
        center_y = _median(soldier.position.y for soldier in battlefield.soldiers)
    else:
        center_x = battlefield.width // 2
        center_y = battlefield.height // 2

    x0 = max(0, min(center_x - width // 2, battlefield.width - width))
    y0 = max(0, min(center_y - height // 2, battlefield.height - height))
    return x0, y0, x0 + width, y0 + height


def full_map_frame(battlefield: Battlefield, columns: int = 118) -> str:
    """Render the whole grid at once, aggregated to fit the terminal width.

    Unlike viewport_bounds this never crops; it trades resolution for coverage,
    which is what you want when inspecting terrain rather than following a
    fight.
    """
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

    lines.append(terrain_legend(battlefield))
    return "\n".join(lines)


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
    lowest, highest = elevation_bounds(battlefield)
    x0, y0, x1, y1 = viewport_bounds(battlefield)
    if (x1 - x0, y1 - y0) != (battlefield.width, battlefield.height):
        print(
            f"viewport x={x0}..{x1 - 1} y={y0}..{y1 - 1} "
            f"of {battlefield.width}x{battlefield.height}"
        )

    for y in range(y0, y1):
        row: list[str] = []

        for x in range(x0, x1):
            position = battlefield.position_at(x, y)
            if position is None:
                raise RuntimeError(f"battlefield surface missing position at {(x, y)}")

            symbol = cell_symbol(battlefield, position)
            if color := elevation_color(position.z, lowest, highest):
                symbol = f"\033[38;5;{color}m{symbol}\033[0m"
            row.append(symbol)

        print(" ".join(row))

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


def both_teams_have_living_soldiers(battlefield: Battlefield) -> bool:
    living_teams = {
        soldier.team
        for soldier in battlefield.soldiers
        if soldier.survival_status == SurvivalState.ALIVE
    }
    return Team.BLUE in living_teams and Team.RED in living_teams


def build_demo_battlefield() -> Battlefield:
    """The hand-authored 12x8 scenario the demo has always run."""
    surface = {
        Position(
            x=x,
            y=y,
            z=max(0, 3 - abs(6 - x)),
        )
        for x in range(12)
        for y in range(8)
    }
    surface_by_xy = {(position.x, position.y): position for position in surface}

    def ground(x: int, y: int) -> Position:
        return surface_by_xy[(x, y)]

    blue_1 = Soldier(
        team=Team.BLUE,
        position=ground(1, 2),
        vision_range=6,
        communication_group_ids={"blue-team"},
    )
    blue_2 = Soldier(
        team=Team.BLUE,
        position=ground(1, 5),
        vision_range=6,
        communication_group_ids={"blue-team"},
    )
    red_1 = Soldier(
        team=Team.RED,
        position=ground(10, 2),
        vision_range=6,
        communication_group_ids={"red-team"},
    )
    red_2 = Soldier(
        team=Team.RED,
        position=ground(10, 5),
        vision_range=6,
        communication_group_ids={"red-team"},
    )

    return Battlefield(
        width=12,
        height=8,
        soldiers=[blue_1, blue_2, red_1, red_2],
        surface=surface,
        terrain={
            **{
                ground(x, y): TerrainClass.STRUCTURE
                for x, y in ((4, 2), (5, 2), (6, 4), (7, 4), (5, 6))
            },
            **{
                ground(x, y): TerrainClass.SCRUB
                for x, y in ((3, 4), (4, 5), (7, 2), (8, 3), (8, 6))
            },
        },
        communication_groups=[
            CommunicationGroup(
                group_id="blue-team",
                name="Blue team",
                team=Team.BLUE,
            ),
            CommunicationGroup(
                group_id="red-team",
                name="Red team",
                team=Team.RED,
            ),
        ],
    )


def build_payload_battlefield(
    payload_path: str | Path,
    vision_range: float | None = None,
    include_units: bool = True,
) -> tuple[Battlefield, str]:
    """Load a frontend terrain export into a battlefield plus its briefing."""
    payload = load_payload(payload_path)
    kwargs: dict[str, object] = {"include_units": include_units}
    if vision_range is not None:
        kwargs["vision_range"] = vision_range
    return build_battlefield_from_payload(payload, **kwargs), objective_briefing(
        payload
    )


def show_full_map(
    payload_path: str | Path,
    include_units: bool = True,
    columns: int | None = None,
) -> None:
    """Print the whole map once and return, without running a simulation."""
    battlefield, briefing = build_payload_battlefield(
        payload_path, include_units=include_units
    )
    if columns is None:
        columns = get_terminal_size(fallback=(118, 24)).columns
    print(full_map_frame(battlefield, columns))
    if briefing:
        print(f"\nObjectives:{briefing}")


async def run_demo(
    model_spec: str | None = None,
    ticks: int = 60,
    replay_log_path: str | Path | None = None,
    payload_path: str | Path | None = None,
    vision_range: float | None = None,
    include_units: bool = True,
) -> None:
    load_dotenv()
    action_chooser = build_action_chooser(model_spec)

    if payload_path is None:
        battlefield = build_demo_battlefield()
    else:
        battlefield, briefing = build_payload_battlefield(
            payload_path, vision_range, include_units
        )
        print(
            f"[athena] terrain: {battlefield.width}x{battlefield.height} from "
            f"{payload_path}{briefing}",
            file=sys.stderr,
        )

    # build_action_chooser (above) already resolved which backend/model to use;
    # everything downstream (loop, rendering, output) is identical regardless.
    loop = LoopEngine(
        battlefield=battlefield,
        vision_resolver=VisionResolver(),
        movement_resolver=MovementResolver(),
        action_chooser=action_chooser,
    )
    replay_recorder = (
        ReplayRecorder(battlefield.snapshot())
        if replay_log_path is not None
        else None
    )

    use_live_screen = sys.stdout.isatty()
    if use_live_screen:
        sys.stdout.write("\033[?1049h\033[?25l")
        sys.stdout.flush()

    try:
        initial_label = (
            "Initial - running tick 1 (waiting for agents)"
            if ticks > 0
            else "Initial"
        )
        render_demo_frame(
            initial_label,
            battlefield,
            loop.observed_soldiers_map(),
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

            render_demo_frame(
                label,
                battlefield,
                loop.observed_soldiers_map(),
                execution_result=result,
            )
            if battle_finished:
                break
    finally:
        try:
            if replay_recorder is not None and replay_log_path is not None:
                replay_recorder.save(replay_log_path)
        finally:
            if use_live_screen:
                sys.stdout.write("\033[?25h\033[?1049l")
                sys.stdout.flush()


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
        default=None,
        help="load terrain and units from a frontend export instead of the "
        "built-in 12x8 scenario",
    )
    parser.add_argument(
        "--vision-range",
        type=float,
        default=None,
        help="override every soldier's vision range, in cells",
    )
    parser.add_argument(
        "--full-map",
        action="store_true",
        help="print the whole map, aggregated to fit the terminal, and exit "
        "without simulating",
    )
    parser.add_argument(
        "--no-units",
        action="store_true",
        help="load terrain only, leaving the map empty of soldiers",
    )
    args = parser.parse_args()

    if args.full_map or args.no_units:
        if args.payload is None:
            raise SystemExit("error: --full-map and --no-units require --payload")

    try:
        if args.full_map:
            show_full_map(args.payload, include_units=not args.no_units)
            return
        asyncio.run(
            run_demo(
                model_spec=args.model,
                ticks=args.ticks,
                replay_log_path=args.replay_log,
                payload_path=args.payload,
                vision_range=args.vision_range,
                include_units=not args.no_units,
            )
        )
    except (OllamaUnavailable, PayloadError) as exc:
        raise SystemExit(f"error: {exc}")


if __name__ == "__main__":
    main()
