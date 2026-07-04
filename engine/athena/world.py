from __future__ import annotations

from dataclasses import dataclass
from typing import Literal


Direction = Literal["up", "down", "left", "right"]


@dataclass(frozen=True)
class Position:
    x: int
    y: int


@dataclass(frozen=True)
class MoveResult:
    accepted: bool
    message: str
    position: Position


class World:
    def __init__(
        self,
        width: int,
        height: int,
        agent_position: Position,
        blocked: set[Position] | None = None,
    ) -> None:
        if width <= 0 or height <= 0:
            raise ValueError("world width and height must be positive")
        if not self._inside(width, height, agent_position):
            raise ValueError("agent must start inside the world")

        self.width = width
        self.height = height
        self.agent_position = agent_position
        self.blocked = blocked or set()

        for cell in self.blocked:
            if not self._inside(width, height, cell):
                raise ValueError(f"blocked cell outside world: {cell}")
        if self.agent_position in self.blocked:
            raise ValueError("agent cannot start on a blocked cell")

    def describe_for_agent(self) -> str:
        valid_moves = ", ".join(self.valid_moves()) or "none"
        return (
            f"You are in a {self.width}x{self.height} 2D grid.\n"
            f"Your position is ({self.agent_position.x}, {self.agent_position.y}).\n"
            f"Blocked cells are: {self._blocked_cells_text()}.\n"
            f"Valid moves from here: {valid_moves}.\n"
            "Choose exactly one direction: up, down, left, or right."
        )

    def valid_moves(self) -> list[Direction]:
        directions: list[Direction] = ["up", "down", "left", "right"]
        return [direction for direction in directions if self._can_move(direction)]

    def move_agent(self, direction: Direction) -> MoveResult:
        next_position = self._next_position(direction)

        if not self._inside(self.width, self.height, next_position):
            return MoveResult(
                accepted=False,
                message=f"rejected: {direction} leaves the world",
                position=self.agent_position,
            )

        if next_position in self.blocked:
            return MoveResult(
                accepted=False,
                message=f"rejected: {direction} enters a blocked cell",
                position=self.agent_position,
            )

        self.agent_position = next_position
        return MoveResult(
            accepted=True,
            message=f"accepted: moved {direction}",
            position=self.agent_position,
        )

    def _can_move(self, direction: Direction) -> bool:
        next_position = self._next_position(direction)
        return (
            self._inside(self.width, self.height, next_position)
            and next_position not in self.blocked
        )

    def _next_position(self, direction: Direction) -> Position:
        deltas: dict[Direction, tuple[int, int]] = {
            "up": (0, -1),
            "down": (0, 1),
            "left": (-1, 0),
            "right": (1, 0),
        }
        dx, dy = deltas[direction]
        return Position(self.agent_position.x + dx, self.agent_position.y + dy)

    def _blocked_cells_text(self) -> str:
        if not self.blocked:
            return "none"
        cells = sorted(self.blocked, key=lambda position: (position.y, position.x))
        return ", ".join(f"({cell.x}, {cell.y})" for cell in cells)

    @staticmethod
    def _inside(width: int, height: int, position: Position) -> bool:
        return 0 <= position.x < width and 0 <= position.y < height
