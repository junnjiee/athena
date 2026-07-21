from athena.models import Position, SurvivalState, Team
from athena.params import DEFAULT_SOLDIER_VISION_RANGE


class Soldier:
    team: Team
    position: Position
    survival_status: SurvivalState
    vision_range: float
    communication_group_ids: frozenset[str]

    def __init__(
        self,
        team: Team,
        position: Position,
        survival_status: SurvivalState = SurvivalState.ALIVE,
        vision_range: float = DEFAULT_SOLDIER_VISION_RANGE,
        communication_group_ids: set[str] | frozenset[str] | None = None,
    ) -> None:
        self.team = team
        self.position = position
        self.survival_status = survival_status
        self.vision_range = vision_range
        self.communication_group_ids = frozenset(communication_group_ids or ())

    def move_to(self, position: Position) -> None:
        self.position = position

    def become_casualty(self) -> None:
        """Apply a rifle casualty without reviving dead or existing casualties."""
        if self.survival_status == SurvivalState.ALIVE:
            self.survival_status = SurvivalState.CASUALTY
