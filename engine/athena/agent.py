from __future__ import annotations

from typing import Literal

from dotenv import load_dotenv
from langchain_openrouter import ChatOpenRouter
from pydantic import BaseModel, Field

from athena.world import Direction


class MoveDecision(BaseModel):
    direction: Literal["up", "down", "left", "right"] = Field(
        description="The next movement direction for the agent."
    )


class Agent:
    def __init__(
        self,
        model_name: str = "deepseek/deepseek-v4-flash",
        temperature: float = 0.2,
    ) -> None:
        load_dotenv()
        model = ChatOpenRouter(model=model_name, temperature=temperature)
        self.model = model.with_structured_output(MoveDecision)

    def choose_move(self, observation: str) -> Direction:
        decision = self.model.invoke(
            [
                (
                    "system",
                    "You control one agent in a 2D grid. Return one valid move only.",
                ),
                ("user", observation),
            ]
        )
        return decision.direction
