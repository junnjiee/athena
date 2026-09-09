"""What the operator believes the enemy is trying to do.

Two halves, because a staff officer works in both. The structured skeleton is
the marked objectives the engine can check. The prose is what a good S2
actually writes, and no schema captures it; it reaches the model unedited.
"""

from pydantic import BaseModel, Field, field_validator


class EnemyIntent(BaseModel):
    """The intent a study is read against."""

    objective_ids: list[str] = Field(default_factory=list, max_length=100)
    """Which marked objectives the enemy is believed to want. Empty means every
    objective in the study is in play."""

    narrative: str = Field(default="", max_length=4000)
    """Free text, as an S2 would write it: what the enemy wants, what they are
    likely to accept losing, what would make them commit the reserve. Passed to
    the model unedited — it is the half the schema cannot hold."""

    @field_validator("objective_ids")
    @classmethod
    def objective_ids_are_distinct_and_named(cls, values: list[str]) -> list[str]:
        if any(not value.strip() for value in values):
            raise ValueError("intent objective ids must not be blank")
        if len(values) != len(set(values)):
            raise ValueError("intent objective ids must be unique")
        return values

    def is_empty(self) -> bool:
        """No stated intent at all.

        Worth naming: with nothing said, the model has only terrain to reason
        from, and the courses of action it produces are geography rather than
        intelligence. The caller decides whether that is acceptable.
        """
        return not self.objective_ids and not self.narrative.strip()
