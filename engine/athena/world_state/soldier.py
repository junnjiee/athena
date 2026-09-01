from athena.models import Position, SurvivalState, Team
from athena.params import (
    DEFAULT_MOVE_BUDGET,
    DEFAULT_SOLDIER_VISION_RANGE,
    MAGAZINE_ROUNDS,
)


class Soldier:
    team: Team
    position: Position
    survival_status: SurvivalState
    vision_range: float
    move_budget: float
    section_id: str | None
    is_commander: bool
    rounds: int
    reloading: bool
    suppressed: bool
    waypoints: tuple[Position, ...]
    objective: Position | None
    communication_group_ids: frozenset[str]

    def __init__(
        self,
        team: Team,
        position: Position,
        survival_status: SurvivalState = SurvivalState.ALIVE,
        vision_range: float = DEFAULT_SOLDIER_VISION_RANGE,
        communication_group_ids: set[str] | frozenset[str] | None = None,
        move_budget: float = DEFAULT_MOVE_BUDGET,
        section_id: str | None = None,
        is_commander: bool = True,
        waypoints: tuple[Position, ...] = (),
        objective: Position | None = None,
    ) -> None:
        self.team = team
        self.position = position
        self.survival_status = survival_status
        self.vision_range = vision_range
        # Terrain cost this soldier may spend moving in one tick. Set from the
        # gait its route was drawn with; scenarios that draw no route get the
        # default.
        self.move_budget = move_budget
        # Which drawn marker this soldier was expanded from, and whether it is
        # the one making decisions for it. Defaults to commanding, so a
        # hand-authored scenario keeps every soldier an agent.
        self.section_id = section_id
        self.is_commander = is_commander
        # Rounds left in the magazine, whether the soldier is spending this tick
        # reloading, and whether it is currently being shot at. All three exist
        # to stop a firefight resolving in two ticks of near-certain hits.
        self.rounds = MAGAZINE_ROUNDS
        self.reloading = False
        self.suppressed = False
        # The drawn axis of advance and the objective, in cells. Carried as data
        # rather than only as prose in a prompt, so a soldier out of contact can
        # follow its orders without a model call deciding to.
        self.waypoints = waypoints
        self.objective = objective
        self.communication_group_ids = frozenset(communication_group_ids or ())

    def move_to(self, position: Position) -> None:
        self.position = position

    def fire(self) -> None:
        """Spend a round, and start reloading if that was the last one."""
        self.rounds = max(0, self.rounds - 1)
        if self.rounds == 0:
            self.reloading = True

    def finish_reload(self) -> None:
        """Complete a reload the soldier spent this tick on."""
        self.reloading = False
        self.rounds = MAGAZINE_ROUNDS

    def promote(self) -> None:
        """Take over a section whose commander is down."""
        self.is_commander = True

    def reach_waypoint(self) -> None:
        """Drop the waypoint just reached and aim at the next one."""
        self.waypoints = self.waypoints[1:]

    @property
    def next_waypoint(self) -> Position | None:
        """Where this soldier is currently heading, if anywhere."""
        if self.waypoints:
            return self.waypoints[0]
        return self.objective

    def become_casualty(self) -> None:
        """Apply a rifle casualty without reviving dead or existing casualties."""
        if self.survival_status == SurvivalState.ALIVE:
            self.survival_status = SurvivalState.CASUALTY
