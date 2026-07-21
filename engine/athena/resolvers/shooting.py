from random import Random

from athena.world_state import Soldier
from athena.params import (
    BASE_HIT_PROBABILITY,
    ELEVATION_HIT_MODIFIER_PER_LEVEL,
    MAXIMUM_HIT_PROBABILITY,
    MINIMUM_HIT_PROBABILITY,
)
from athena.models import (
    ActionValidationResult,
    BattlefieldSnapshot,
    ObservedSoldier,
    Position,
    ShotOutcome,
    ShootAction,
    SurvivalState,
)


class ShootingResolver:
    def __init__(
        self,
        base_hit_probability: float = BASE_HIT_PROBABILITY,
        elevation_modifier_per_level: float = ELEVATION_HIT_MODIFIER_PER_LEVEL,
        minimum_hit_probability: float = MINIMUM_HIT_PROBABILITY,
        maximum_hit_probability: float = MAXIMUM_HIT_PROBABILITY,
        rng: Random | None = None,
    ) -> None:
        """Configure explicit simulation assumptions for rifle hit resolution.

        These probabilities make elevation effects inspectable and tunable; they
        are not claims about real-world combat accuracy.
        """
        self.base_hit_probability = base_hit_probability
        self.elevation_modifier_per_level = elevation_modifier_per_level
        self.minimum_hit_probability = minimum_hit_probability
        self.maximum_hit_probability = maximum_hit_probability
        self.rng = rng or Random()

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
        return self.validate_shoot_action(observed_soldier, soldier, action).valid

    def validate_shoot_action(
        self,
        observed_soldier: ObservedSoldier,
        soldier: Soldier,
        action: ShootAction,
    ) -> ActionValidationResult:
        if soldier.survival_status != SurvivalState.ALIVE:
            return ActionValidationResult.rejected("Only an alive soldier can shoot.")

        matching_targets = [
            visible_soldier
            for visible_soldier in observed_soldier.visible_soldiers
            if visible_soldier.position == action.target_position
        ]
        eligible_targets = [
            visible_soldier
            for visible_soldier in matching_targets
            if visible_soldier.team != soldier.team  # this line prevents fratricide
            and visible_soldier.survival_status == SurvivalState.ALIVE
        ]
        if len(eligible_targets) == 1:
            return ActionValidationResult.accepted()
        if not matching_targets:
            return ActionValidationResult.rejected(
                "No visible soldier occupies the requested target position."
            )
        if not eligible_targets:
            return ActionValidationResult.rejected(
                "The requested target is not a visible living enemy."
            )
        return ActionValidationResult.rejected(
            "Multiple visible living enemies occupy the requested target position, "
            "so the target is ambiguous."
        )

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

    def hit_probability(
        self,
        shooter_position: Position,
        target_position: Position,
    ) -> float:
        elevation_difference = shooter_position.z - target_position.z
        probability = (
            self.base_hit_probability
            + self.elevation_modifier_per_level * elevation_difference
        )
        return max(
            self.minimum_hit_probability,
            min(self.maximum_hit_probability, probability),
        )

    def resolve_shot(
        self,
        snapshot: BattlefieldSnapshot,
        shooter_index: int,
        action: ShootAction,
    ) -> ShotOutcome | None:
        target_index = self.resolve_shoot_target(snapshot, shooter_index, action)
        if target_index is None:
            return None

        shooter = snapshot.soldiers[shooter_index]
        target = snapshot.soldiers[target_index]
        hit_probability = self.hit_probability(shooter.position, target.position)
        roll = self.rng.random()
        return ShotOutcome(
            shooter_index=shooter_index,
            target_index=target_index,
            hit_probability=hit_probability,
            roll=roll,
            hit=roll < hit_probability,
        )
