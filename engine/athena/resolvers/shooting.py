from athena.soldier import Soldier
from athena.types import (
    BattlefieldSnapshot,
    ObservedSoldier,
    ShootAction,
    SurvivalState,
)


class ShootingResolver:
    def verify_shoot_action(
        self,
        observed_soldier: ObservedSoldier,
        soldier: Soldier,
        action: ShootAction,
    ) -> bool:
        """Return whether the soldier may shoot at the requested grid cell.

        Target validation uses the soldier's observation instead of global battlefield
        state. This prevents an agent from acting on a hidden enemy's position even if
        it happens to guess those coordinates.
        """
        if soldier.survival_status != SurvivalState.ALIVE:
            return False

        # O(n) - looping thru all visible soldiers
        eligible_targets = [
            visible_soldier
            for visible_soldier in observed_soldier.visible_soldiers.soldiers
            if visible_soldier.position == action.target_position
            and visible_soldier.team != soldier.team  # this line prevents fratricide
            and visible_soldier.survival_status == SurvivalState.ALIVE
        ]
        return len(eligible_targets) == 1

    def resolve_shoot_target(
        self,
        snapshot: BattlefieldSnapshot,
        shooter_index: int,
        action: ShootAction,
    ) -> int | None:
        """Bind a coordinate shot to one enemy from the pre-execution snapshot."""
        shooter = snapshot.soldiers[shooter_index]
        if shooter.survival_status != SurvivalState.ALIVE:
            return None

        eligible_targets = [
            target.soldier_index
            for target in snapshot.soldiers
            if target.position == action.target_position
            and target.team != shooter.team
            and target.survival_status == SurvivalState.ALIVE
        ]
        if len(eligible_targets) != 1:
            return None

        return eligible_targets[0]
