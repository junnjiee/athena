"""What the operator believes the enemy is trying to do.

Two halves, because a staff officer works in both. The structured skeleton is
what the engine can check — objectives that exist, reserves that were marked,
a posture from a fixed set. The prose is what a good S2 actually writes, and no
schema captures it; it reaches the model unedited.
"""

from enum import StrEnum

from pydantic import BaseModel, Field


class Posture(StrEnum):
    """How the enemy is expected to behave, coarsely.

    Deliberately few: this steers judgement rather than parameterising a
    calculation, and a longer list would imply a precision the engine has not
    got.
    """

    ATTACKING = "attacking"
    DEFENDING = "defending"
    DELAYING = "delaying"
    WITHDRAWING = "withdrawing"
    UNKNOWN = "unknown"


class EnemyIntent(BaseModel):
    """The intent a study is read against."""

    posture: Posture = Posture.UNKNOWN
    """What the enemy is doing now."""

    objective_ids: list[str] = Field(default_factory=list)
    """Which marked objectives the enemy is believed to want. Empty means every
    objective in the study is in play."""

    narrative: str = ""
    """Free text, as an S2 would write it: what the enemy wants, what they are
    likely to accept losing, what would make them commit the reserve. Passed to
    the model unedited — it is the half the schema cannot hold."""

    def is_empty(self) -> bool:
        """No stated intent at all.

        Worth naming: with nothing said, the model has only terrain to reason
        from, and the courses of action it produces are geography rather than
        intelligence. The caller decides whether that is acceptable.
        """
        return self.posture is Posture.UNKNOWN and not self.narrative.strip()
