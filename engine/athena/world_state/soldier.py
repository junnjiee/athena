from athena.models import Position, SurvivalState, Team


class Soldier:
    team: Team
    position: Position
    survival_status: SurvivalState
    vision_range: float

    def __init__(
        self,
        team: Team,
        position: Position,
        survival_status: SurvivalState = SurvivalState.ALIVE,
        vision_range: float = 10.0,
    ) -> None:
        self.team = team
        self.position = position
        self.survival_status = survival_status
        self.vision_range = vision_range

    def move_to(self, position: Position) -> None:
        self.position = position

    def become_casualty(self) -> None:
        """Apply a rifle casualty without reviving dead or existing casualties."""
        if self.survival_status == SurvivalState.ALIVE:
            self.survival_status = SurvivalState.CASUALTY
