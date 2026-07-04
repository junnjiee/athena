from __future__ import annotations

from athena.world import Position, World


class Renderer:
    clear_screen = "\033[2J"
    cursor_home = "\033[H"

    def render(self, world: World) -> str:
        rows: list[str] = []
        for y in range(world.height):
            row = []
            for x in range(world.width):
                position = Position(x, y)
                if position == world.agent_position:
                    row.append("A")
                elif position in world.blocked:
                    row.append("#")
                else:
                    row.append(".")
            rows.append("".join(row))
        return "\n".join(rows)

    def render_frame(
        self,
        world: World,
        tick: int,
        direction: str | None = None,
        message: str | None = None,
    ) -> str:
        lines = [
            f"Tick {tick}",
            self.render(world),
        ]
        if direction is not None:
            lines.append(f"LLM chose: {direction}")
        if message:
            lines.append(message)
        return self.clear_screen + self.cursor_home + "\n".join(lines) + "\n"
