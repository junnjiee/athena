import argparse
import asyncio
import sys
from functools import partial

from dotenv import load_dotenv

from athena.agent import (
    OllamaUnavailable,
    choose_action,
    choose_action_local,
    resolve_local_model,
)
from athena.battlefield import Battlefield
from athena.loop import ActionChooser, LoopEngine
from athena.resolvers.movement import MovementResolver
from athena.resolvers.vision import VisionResolver
from athena.soldier import Soldier
from athena.types import ObservedSoldier, Position, Team

OLLAMA_PREFIX = "ollama:"


# Map a --model spec to an action chooser: None=hosted default, ollama:*=local, else an OpenRouter id; logs the choice.
def build_action_chooser(model_spec: str | None) -> ActionChooser:
    if model_spec is None:
        print("[athena] agent: OpenRouter (default hosted model)", file=sys.stderr)
        return choose_action

    if model_spec.startswith(OLLAMA_PREFIX):
        name = model_spec[len(OLLAMA_PREFIX):]
        resolved = resolve_local_model(None if name == "auto" else name)
        print(f"[athena] agent: Ollama local model '{resolved}'", file=sys.stderr)
        return partial(choose_action_local, model=resolved)

    print(f"[athena] agent: OpenRouter model '{model_spec}'", file=sys.stderr)
    return partial(choose_action, model=model_spec)


def format_positions(positions: list[Position]) -> str:
    if not positions:
        return "none"

    return ", ".join(f"({position.x},{position.y})" for position in positions)


def render_demo_frame(
    label: str,
    battlefield: Battlefield,
    observations: list[ObservedSoldier],
) -> None:
    print("\033[2J\033[H", end="")
    print(label)
    for y in range(battlefield.height):
        row: list[str] = []

        for x in range(battlefield.width):
            position = Position(x=x, y=y)
            soldiers = [
                soldier
                for soldier in battlefield.soldiers
                if soldier.position == position
            ]

            if len(soldiers) > 1:
                row.append("*")
            elif len(soldiers) == 1:
                row.append("B" if soldiers[0].team == Team.BLUE else "R")
            elif position in battlefield.cover:
                row.append("#")
            elif position in battlefield.concealment:
                row.append("!")
            else:
                row.append(".")

        print(" ".join(row))

    print("B=blue R=red #=cover !=concealment *=multiple")
    print()
    print("Visible information")
    for index, observation in enumerate(observations):
        visible_soldiers = [
            f"{soldier.team.value}@({soldier.position.x},{soldier.position.y})"
            for soldier in observation.visible_soldiers.soldiers
        ]
        visible_soldiers_text = ", ".join(visible_soldiers) or "none"

        print(
            f"  soldier {index} "
            f"{observation.team.value}@"
            f"({observation.position.x},{observation.position.y})"
        )
        print(f"    soldiers: {visible_soldiers_text}")
        print(f"    cover: {format_positions(observation.available_terrain.cover)}")
        print(
            "    concealment: "
            f"{format_positions(observation.available_terrain.concealment)}"
        )

    print()


async def run_demo(model_spec: str | None = None) -> None:
    load_dotenv()
    action_chooser = build_action_chooser(model_spec)

    blue_1 = Soldier(
        team=Team.BLUE,
        position=Position(x=1, y=2),
        vision_range=6,
    )
    blue_2 = Soldier(
        team=Team.BLUE,
        position=Position(x=1, y=5),
        vision_range=6,
    )
    red_1 = Soldier(
        team=Team.RED,
        position=Position(x=10, y=2),
        vision_range=6,
    )
    red_2 = Soldier(
        team=Team.RED,
        position=Position(x=10, y=5),
        vision_range=6,
    )

    battlefield = Battlefield(
        width=12,
        height=8,
        soldiers=[blue_1, blue_2, red_1, red_2],
        cover={
            Position(x=4, y=2),
            Position(x=5, y=2),
            Position(x=6, y=4),
            Position(x=7, y=4),
            Position(x=5, y=6),
        },
        concealment={
            Position(x=3, y=4),
            Position(x=4, y=5),
            Position(x=7, y=2),
            Position(x=8, y=3),
            Position(x=8, y=6),
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

    render_demo_frame("Initial", battlefield, loop.observed_soldiers_map())
    for tick_index in range(60):
        await loop.tick()
        render_demo_frame(
            f"After tick {tick_index + 1}",
            battlefield,
            loop.observed_soldiers_map(),
        )


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the Athena demo simulation.")
    parser.add_argument(
        "--model",
        default=None,
    )
    args = parser.parse_args()
    try:
        asyncio.run(run_demo(model_spec=args.model))
    except OllamaUnavailable as exc:
        raise SystemExit(f"error: {exc}")


if __name__ == "__main__":
    main()
