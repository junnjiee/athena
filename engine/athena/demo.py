import asyncio

from dotenv import load_dotenv

from athena.battlefield import Battlefield
from athena.loop import LoopEngine
from athena.resolvers.movement import MovementResolver
from athena.resolvers.vision import VisionResolver
from athena.soldier import Soldier
from athena.types import ObservedSoldier, Position, Team


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


async def run_demo() -> None:
    load_dotenv()

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
    loop = LoopEngine(
        battlefield=battlefield,
        vision_resolver=VisionResolver(),
        movement_resolver=MovementResolver(),
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
    asyncio.run(run_demo())


if __name__ == "__main__":
    main()
