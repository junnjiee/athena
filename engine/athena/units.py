"""Unit echelons and the roles their commanders hold.

Athena models organisation down from a company: company, platoon, section,
group. Nothing above a company exists in the engine, so a company is always the
root of a faction's tree.

Role is not stored on a soldier. It follows from the echelon a soldier commands,
which keeps one fact in one place: promote a soldier by giving it command of a
larger unit, not by editing two fields that can disagree.
"""

from enum import StrEnum


class Echelon(StrEnum):
    """One level of organisation, largest first."""

    COMPANY = "company"
    PLATOON = "platoon"
    SECTION = "section"
    GROUP = "group"


ECHELON_DEPTH: dict[Echelon, int] = {
    Echelon.COMPANY: 0,
    Echelon.PLATOON: 1,
    Echelon.SECTION: 2,
    Echelon.GROUP: 3,
}
"""How far below a company each echelon sits.

A unit's parent must sit at a strictly smaller depth. Because depth strictly
decreases on every step upward and is bounded below by zero, that single rule
also makes parent cycles impossible, so the tree needs no separate cycle check.
"""


class Role(StrEnum):
    """What a soldier is, as opposed to what it commands.

    A man may still hold an appointment: a group is led by a soldier who is a
    man rather than a sergeant, so command and role are independent axes.
    """

    OFFICER = "officer"
    SERGEANT = "sergeant"
    MAN = "man"


COMMAND_ROLES: dict[Echelon, Role] = {
    Echelon.COMPANY: Role.OFFICER,
    Echelon.PLATOON: Role.OFFICER,
    Echelon.SECTION: Role.SERGEANT,
    Echelon.GROUP: Role.MAN,
}
"""Who commands each echelon."""
