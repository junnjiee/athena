from __future__ import annotations

from athena.agent import Agent
from athena.renderer import Renderer
from athena.world import Position, World


def main() -> None:
    world = World(
        width=8,
        height=6,
        agent_position=Position(1, 1),
        blocked={
            Position(3, 1),
            Position(3, 2),
            Position(4, 2),
            Position(2, 4),
        },
    )
    agent = Agent()
    renderer = Renderer()
    last_direction: str | None = None
    last_message: str | None = None

    for tick in range(10):
        print(
            renderer.render_frame(world, tick, last_direction, last_message),
            end="",
            flush=True,
        )

        observation = world.describe_for_agent()
        direction = agent.choose_move(observation)
        result = world.move_agent(direction)

        last_direction = direction
        last_message = result.message

    print(
        renderer.render_frame(world, 10, last_direction, last_message),
        end="",
        flush=True,
    )


if __name__ == "__main__":
    main()
