import argparse
import asyncio
import sys
from contextlib import redirect_stdout
from functools import partial
from io import StringIO

from dotenv import load_dotenv

from athena.agent import choose_action
from athena.ollama_agent import (
    OllamaUnavailable,
    choose_action_local,
    resolve_local_model,
)
from athena.world_state import Battlefield
from athena.loop import ActionChooser, LoopEngine
from athena.resolvers.movement import MovementResolver
from athena.resolvers.vision import VisionResolver
from athena.world_state import Soldier
from athena.types import (
    AgentContext,
    ExecutionResult,
    MoveAction,
    ObservedSoldier,
    Position,
    ShootAction,
    SurvivalState,
    Team,
)

OLLAMA_PREFIX = "ollama:"
ELEVATION_COLORS = {
    1: 226,  # Yellow.
    2: 208,  # Orange.
    3: 94,  # Brown.
}


def adapt_local_action_chooser(model: str) -> ActionChooser:
    """Keep Ollama on its current-observation-only request contract."""

    async def choose_from_current_observation(
        agent_context: AgentContext,
        battlefield: Battlefield,
        soldier: Soldier,
        movement_resolver: MovementResolver,
        max_attempts: int = 3,
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
    for y in range(battlefield.height):
        row: list[str] = []

        for x in range(battlefield.width):
            position = battlefield.position_at(x, y)
            if position is None:
                raise RuntimeError(f"battlefield surface missing position at {(x, y)}")
            soldiers = [
                soldier
                for soldier in battlefield.soldiers
                if soldier.position == position
            ]

            if len(soldiers) > 1:
                row.append("*")
            elif len(soldiers) == 1:
                row.append(soldier_symbol(soldiers[0]))
            elif position in battlefield.cover:
                row.append("#")
            elif position in battlefield.concealment:
                row.append("!")
            else:
                row.append(".")

            if color := ELEVATION_COLORS.get(position.z):
                row[-1] = f"\033[38;5;{color}m{row[-1]}\033[0m"

        print(" ".join(row))

    print(
        "B/R=living blue/red b/r=blue/red casualty "
        "x=dead #=cover !=concealment *=multiple"
    )
    print()
    if execution_result is not None:
        render_execution_result(execution_result)

    print("Visible information")
    for index, observation in enumerate(observations):
        visible_soldiers = [
            f"{soldier.team.value}@"
            f"({soldier.position.x},{soldier.position.y},{soldier.position.z})"
            for soldier in observation.visible_soldiers.soldiers
        ]
        visible_soldiers_text = ", ".join(visible_soldiers) or "none"
        terrain_cells = observation.available_terrain.cells
        cover_count = sum(cell.has_cover for cell in terrain_cells)
        concealment_count = sum(cell.has_concealment for cell in terrain_cells)

        print(
            f"  soldier {index} "
            f"{observation.team.value}@"
            f"({observation.position.x},{observation.position.y},"
            f"{observation.position.z}) "
            f"[{observation.survival_status.value}] "
            f"sees: {visible_soldiers_text}; "
            f"terrain: {len(terrain_cells)} cells "
            f"({cover_count} cover, {concealment_count} concealment)"
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


async def run_demo(model_spec: str | None = None, ticks: int = 60) -> None:
    load_dotenv()
    action_chooser = build_action_chooser(model_spec)

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
    )
    blue_2 = Soldier(
        team=Team.BLUE,
        position=ground(1, 5),
        vision_range=6,
    )
    red_1 = Soldier(
        team=Team.RED,
        position=ground(10, 2),
        vision_range=6,
    )
    red_2 = Soldier(
        team=Team.RED,
        position=ground(10, 5),
        vision_range=6,
    )

    battlefield = Battlefield(
        width=12,
        height=8,
        soldiers=[blue_1, blue_2, red_1, red_2],
        surface=surface,
        cover={
            ground(4, 2),
            ground(5, 2),
            ground(6, 4),
            ground(7, 4),
            ground(5, 6),
        },
        concealment={
            ground(3, 4),
            ground(4, 5),
            ground(7, 2),
            ground(8, 3),
            ground(8, 6),
        },
    )
    # build_action_chooser (above) already resolved which backend/model to use;
    # everything downstream (loop, rendering, output) is identical regardless.
    loop = LoopEngine(
        battlefield=battlefield,
        vision_resolver=VisionResolver(),
        movement_resolver=MovementResolver(),
        action_chooser=action_chooser,
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
    args = parser.parse_args()
    try:
        asyncio.run(run_demo(model_spec=args.model, ticks=args.ticks))
    except OllamaUnavailable as exc:
        raise SystemExit(f"error: {exc}")


if __name__ == "__main__":
    main()
