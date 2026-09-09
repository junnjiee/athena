"""Platform catalogue and weapon–target matching stay doctrinal and explicit."""

from athena.orbat import WeaponSystem
from athena.targeting import (
    Effect,
    Hardness,
    MatchQuality,
    PLATFORM_CATALOGUE,
    TargetClass,
    lookup_platform,
    match_weapon,
)


def test_platform_catalogue_has_unique_stable_names_and_ids() -> None:
    assert len(PLATFORM_CATALOGUE) == 13
    assert len({platform.id for platform in PLATFORM_CATALOGUE}) == 13
    assert len({platform.name for platform in PLATFORM_CATALOGUE}) == 13


def test_hardness_is_catalogue_data_not_a_unit_guess() -> None:
    btr = lookup_platform(" btr-90 ")
    truck = lookup_platform("TRUCK")

    assert btr is not None and btr.hardness is Hardness.HARD_SKIN_LIGHT
    assert btr.target_class is TargetClass.HARD_SKIN_LIGHT
    assert truck is not None and truck.hardness is Hardness.SOFT_SKIN
    assert lookup_platform("invented tank") is None


def test_non_vehicle_platforms_do_not_receive_invented_hardness() -> None:
    mortar = lookup_platform("2B11 120mm mortar")

    assert mortar is not None
    assert mortar.hardness is None
    assert mortar.target_class is None


def test_atgm_is_preferred_for_armour_but_wasteful_against_soft_skin() -> None:
    armour = match_weapon(WeaponSystem.ATGM, TargetClass.HARD_SKIN_LIGHT)
    soft = match_weapon(WeaponSystem.ATGM, TargetClass.SOFT_SKIN)

    assert armour.quality is MatchQuality.PREFERRED
    assert armour.effective is True
    assert soft.quality is MatchQuality.WASTEFUL
    assert soft.effective is False


def test_conditional_match_is_not_counted_without_the_condition() -> None:
    match = match_weapon(WeaponSystem.LAW, TargetClass.HARD_SKIN_HEAVY)

    assert match.quality is MatchQuality.CONDITIONAL
    assert match.conditions == ["flank or rear aspect"]
    assert match.effective is False


def test_fragmentation_and_small_arms_do_not_become_effective_against_armour() -> None:
    for weapon in (
        WeaponSystem.GPMG,
        WeaponSystem.SAW,
        WeaponSystem.AGL_40MM,
        WeaponSystem.MORTAR_81MM,
    ):
        assert match_weapon(weapon, TargetClass.HARD_SKIN_LIGHT).quality is MatchQuality.INEFFECTIVE


def test_mortar_against_fortification_is_suppression_only() -> None:
    destroy = match_weapon(
        WeaponSystem.MORTAR_81MM, TargetClass.FORTIFICATION, Effect.DESTROY
    )
    suppress = match_weapon(
        WeaponSystem.MORTAR_81MM, TargetClass.FORTIFICATION, Effect.SUPPRESS
    )

    assert destroy.quality is MatchQuality.INEFFECTIVE
    assert suppress.quality is MatchQuality.ACCEPTABLE
    assert suppress.effective is True


def test_observation_system_never_counts_as_a_weapon_effect() -> None:
    for target in TargetClass:
        assert match_weapon(WeaponSystem.MINI_UAV, target).quality is MatchQuality.INEFFECTIVE


def test_unstated_pairing_remains_unknown() -> None:
    match = match_weapon(WeaponSystem.ATGM, TargetClass.HELICOPTER)

    assert match.quality is MatchQuality.UNKNOWN
    assert "no claim" in match.rationale
