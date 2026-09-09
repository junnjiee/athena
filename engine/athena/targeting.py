"""Authoritative platform data and deterministic weapon–target matching.

Names and pairings come from ``docs/DOCTRINE.md``.  Unknown combinations stay
unknown: the matcher is a gate over recorded doctrine, not a place to infer a
weapon's effect from its name.
"""

from enum import StrEnum

from pydantic import BaseModel, Field

from athena.orbat import WeaponSystem


class Effect(StrEnum):
    DESTROY = "destroy"
    NEUTRALISE = "neutralise"
    SUPPRESS = "suppress"
    HARASS = "harass"


class Hardness(StrEnum):
    SOFT_SKIN = "soft_skin"
    HARD_SKIN_LIGHT = "hard_skin_light"
    HARD_SKIN_HEAVY = "hard_skin_heavy"


class TargetClass(StrEnum):
    PERSONNEL_OPEN = "personnel_open"
    PERSONNEL_TRENCH = "personnel_trench"
    SOFT_SKIN = "soft_skin"
    HARD_SKIN_LIGHT = "hard_skin_light"
    HARD_SKIN_HEAVY = "hard_skin_heavy"
    FORTIFICATION = "fortification"
    HELICOPTER = "helicopter"


class PlatformType(StrEnum):
    APC = "apc"
    TRANSPORT = "transport"
    INDIRECT_FIRE = "indirect_fire"
    ATGM = "atgm"
    RECOILLESS = "recoilless"
    RPG = "rpg"
    AGL = "agl"
    HMG = "hmg"
    MANPADS = "manpads"
    SNIPER = "sniper"


class PlatformDefinition(BaseModel):
    id: str
    name: str
    platform_type: PlatformType
    hardness: Hardness | None = None

    @property
    def target_class(self) -> TargetClass | None:
        if self.hardness is None:
            return None
        return TargetClass(self.hardness.value)


PLATFORM_CATALOGUE: tuple[PlatformDefinition, ...] = (
    PlatformDefinition(
        id="btr-90", name="BTR-90", platform_type=PlatformType.APC,
        hardness=Hardness.HARD_SKIN_LIGHT,
    ),
    PlatformDefinition(
        id="truck", name="Truck", platform_type=PlatformType.TRANSPORT,
        hardness=Hardness.SOFT_SKIN,
    ),
    PlatformDefinition(
        id="2b11-120mm-mortar", name="2B11 120mm mortar",
        platform_type=PlatformType.INDIRECT_FIRE,
    ),
    PlatformDefinition(
        id="81mm-mortar", name="81mm mortar", platform_type=PlatformType.INDIRECT_FIRE,
    ),
    PlatformDefinition(
        id="60mm-mortar", name="60mm mortar", platform_type=PlatformType.INDIRECT_FIRE,
    ),
    PlatformDefinition(id="dragon", name="DRAGON", platform_type=PlatformType.ATGM),
    PlatformDefinition(id="spg-9", name="SPG-9", platform_type=PlatformType.RECOILLESS),
    PlatformDefinition(id="rpg-16", name="RPG-16", platform_type=PlatformType.RPG),
    PlatformDefinition(id="rpg-22", name="RPG-22", platform_type=PlatformType.RPG),
    PlatformDefinition(id="ags-17", name="AGS-17", platform_type=PlatformType.AGL),
    PlatformDefinition(id="nsv", name="NSV", platform_type=PlatformType.HMG),
    PlatformDefinition(
        id="sa-16-gimlet", name="SA-16 GIMLET", platform_type=PlatformType.MANPADS,
    ),
    PlatformDefinition(
        id="dragunov", name="Dragunov", platform_type=PlatformType.SNIPER,
    ),
)

_PLATFORM_BY_NAME = {platform.name.casefold(): platform for platform in PLATFORM_CATALOGUE}


def lookup_platform(name: str) -> PlatformDefinition | None:
    """Resolve a catalogue name without pretending an unknown name is known."""
    return _PLATFORM_BY_NAME.get(name.strip().casefold())


class MatchQuality(StrEnum):
    PREFERRED = "preferred"
    ACCEPTABLE = "acceptable"
    CONDITIONAL = "conditional"
    INEFFECTIVE = "ineffective"
    WASTEFUL = "wasteful"
    UNKNOWN = "unknown"


class WeaponMatch(BaseModel):
    weapon: WeaponSystem
    target: TargetClass
    effect: Effect
    quality: MatchQuality
    conditions: list[str] = Field(default_factory=list)
    rationale: str

    @property
    def effective(self) -> bool:
        """Whether the recorded facts are enough to count this weapon now."""
        return self.quality in {MatchQuality.PREFERRED, MatchQuality.ACCEPTABLE}


def _match(
    weapon: WeaponSystem,
    target: TargetClass,
    effect: Effect,
    quality: MatchQuality,
    rationale: str,
    *conditions: str,
) -> WeaponMatch:
    return WeaponMatch(
        weapon=weapon,
        target=target,
        effect=effect,
        quality=quality,
        conditions=list(conditions),
        rationale=rationale,
    )


def match_weapon(
    weapon: WeaponSystem,
    target: TargetClass,
    effect: Effect = Effect.DESTROY,
) -> WeaponMatch:
    """Classify one doctrinal pairing for the requested effect.

    A conditional result is deliberately not ``effective``: without the named
    engagement condition, counting it would turn a possibility into a fact.
    """
    if weapon is WeaponSystem.MINI_UAV:
        return _match(
            weapon, target, effect, MatchQuality.INEFFECTIVE,
            "observation system only; it does not create the requested effect",
        )

    if target is TargetClass.PERSONNEL_OPEN:
        if weapon in {
            WeaponSystem.MORTAR_81MM,
            WeaponSystem.MORTAR_60MM,
            WeaponSystem.GPMG,
            WeaponSystem.AGL_40MM,
        }:
            return _match(
                weapon, target, effect, MatchQuality.PREFERRED,
                "fragmentation or sustained fire is preferred against exposed personnel",
            )
        if weapon is WeaponSystem.SAW:
            return _match(
                weapon, target, effect, MatchQuality.ACCEPTABLE,
                "small arms are acceptable against exposed personnel",
            )
        if weapon is WeaponSystem.ATGM:
            return _match(
                weapon, target, effect, MatchQuality.WASTEFUL,
                "a scarce anti-tank weapon should not be spent on personnel",
            )

    if target is TargetClass.PERSONNEL_TRENCH:
        if weapon in {WeaponSystem.MORTAR_81MM, WeaponSystem.MORTAR_60MM}:
            return _match(
                weapon, target, effect, MatchQuality.PREFERRED,
                "high-angle mortar fire is preferred against personnel in trench",
            )
        if weapon is WeaponSystem.LIGHT_RR:
            return _match(
                weapon, target, effect, MatchQuality.CONDITIONAL,
                "direct fire can be effective through an aperture",
                "direct fire into aperture",
            )
        if weapon is WeaponSystem.AGL_40MM:
            return _match(
                weapon, target, effect, MatchQuality.ACCEPTABLE,
                "automatic grenades are acceptable against a trench",
            )
        if weapon in {WeaponSystem.GPMG, WeaponSystem.SAW}:
            return _match(
                weapon, target, effect, MatchQuality.INEFFECTIVE,
                "small arms have little effect against protected personnel",
            )

    if target is TargetClass.SOFT_SKIN:
        if weapon in {
            WeaponSystem.HMG_12_7MM,
            WeaponSystem.AGL_40MM,
            WeaponSystem.MORTAR_81MM,
            WeaponSystem.MORTAR_60MM,
        }:
            return _match(
                weapon, target, effect, MatchQuality.PREFERRED,
                "heavy fire or fragmentation is preferred against soft-skin vehicles",
            )
        if weapon in {WeaponSystem.LAW, WeaponSystem.LIGHT_RR}:
            return _match(
                weapon, target, effect, MatchQuality.ACCEPTABLE,
                "anti-armour fire can defeat soft skin but is not the preferred economy",
            )
        if weapon in {WeaponSystem.GPMG, WeaponSystem.SAW}:
            return _match(
                weapon, target, effect, MatchQuality.CONDITIONAL,
                "small arms are acceptable only at close range",
                "close range",
            )
        if weapon is WeaponSystem.ATGM:
            return _match(
                weapon, target, effect, MatchQuality.WASTEFUL,
                "a scarce ATGM should not be spent on a soft target",
            )

    if target is TargetClass.HARD_SKIN_LIGHT:
        if weapon in {WeaponSystem.ATGM, WeaponSystem.LAW, WeaponSystem.LIGHT_RR}:
            return _match(
                weapon, target, effect, MatchQuality.PREFERRED,
                "penetrating anti-armour fire defeats light armour",
            )
        if weapon is WeaponSystem.HMG_12_7MM:
            return _match(
                weapon, target, effect, MatchQuality.CONDITIONAL,
                "heavy machine-gun fire works only close or against flank/rear armour",
                "close range or flank/rear aspect",
            )
        if weapon in {
            WeaponSystem.GPMG,
            WeaponSystem.SAW,
            WeaponSystem.AGL_40MM,
            WeaponSystem.MORTAR_81MM,
            WeaponSystem.MORTAR_60MM,
        }:
            return _match(
                weapon, target, effect, MatchQuality.INEFFECTIVE,
                "fragmentation and small arms do not penetrate light armour",
            )

    if target is TargetClass.HARD_SKIN_HEAVY:
        if weapon is WeaponSystem.ATGM:
            return _match(
                weapon, target, effect, MatchQuality.PREFERRED,
                "ATGM is the preferred own-force system against heavy armour",
            )
        if weapon in {WeaponSystem.LAW, WeaponSystem.LIGHT_RR}:
            return _match(
                weapon, target, effect, MatchQuality.CONDITIONAL,
                "light anti-armour fire requires a flank or rear aspect",
                "flank or rear aspect",
            )
        return _match(
            weapon, target, effect, MatchQuality.INEFFECTIVE,
            "this system does not penetrate heavy armour",
        )

    if target is TargetClass.FORTIFICATION:
        if weapon is WeaponSystem.LIGHT_RR:
            return _match(
                weapon, target, effect, MatchQuality.PREFERRED,
                "recoilless direct fire is preferred against fortification",
            )
        if weapon in {WeaponSystem.MORTAR_81MM, WeaponSystem.MORTAR_60MM}:
            if effect is Effect.SUPPRESS:
                return _match(
                    weapon, target, effect, MatchQuality.ACCEPTABLE,
                    "mortar fire can suppress but not destroy a fortification",
                )
            return _match(
                weapon, target, effect, MatchQuality.INEFFECTIVE,
                "mortar fire provides suppression only against fortification",
            )
        if weapon in {WeaponSystem.GPMG, WeaponSystem.SAW}:
            return _match(
                weapon, target, effect, MatchQuality.INEFFECTIVE,
                "small arms do not defeat fortification",
            )

    if target is TargetClass.HELICOPTER and weapon is WeaponSystem.HMG_12_7MM:
        return _match(
            weapon, target, effect, MatchQuality.ACCEPTABLE,
            "heavy machine-gun fire is acceptable against helicopters",
        )

    return _match(
        weapon, target, effect, MatchQuality.UNKNOWN,
        "the doctrinal pairing table makes no claim for this combination",
    )
