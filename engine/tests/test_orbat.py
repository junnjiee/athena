"""The organisation tree a block force is drawn from."""

import pytest

from athena.orbat import Availability, Orbat, Unit
from athena.units import Echelon, Role


def unit(
    unit_id: str,
    echelon: Echelon,
    parent_id: str | None = None,
    lon: float = 0.0,
    lat: float = 0.0,
    availability: Availability = Availability.UNCOMMITTED,
) -> Unit:
    return Unit(
        unit_id=unit_id,
        name=unit_id,
        echelon=echelon,
        parent_id=parent_id,
        lon=lon,
        lat=lat,
        strength=7,
        availability=availability,
    )


def rifle_company() -> Orbat:
    """A company down to one group — the deepest chain the engine has."""
    return Orbat(
        units=(
            unit("coy", Echelon.COMPANY),
            unit("pl1", Echelon.PLATOON, "coy"),
            unit("sec1", Echelon.SECTION, "pl1"),
            unit("sec2", Echelon.SECTION, "pl1"),
            unit("g1", Echelon.GROUP, "sec1"),
        )
    )


# Tree validation


def test_duplicate_unit_ids_are_rejected() -> None:
    with pytest.raises(ValueError, match="duplicate unit id"):
        Orbat(units=(unit("a", Echelon.SECTION), unit("a", Echelon.GROUP)))


def test_unknown_parent_is_rejected() -> None:
    with pytest.raises(ValueError, match="unknown parent unit"):
        Orbat(units=(unit("g1", Echelon.GROUP, "ghost"),))


def test_parent_must_be_a_higher_echelon() -> None:
    with pytest.raises(ValueError, match="higher echelon"):
        Orbat(units=(unit("sec1", Echelon.SECTION), unit("pl1", Echelon.PLATOON, "sec1")))


def test_a_unit_cannot_be_its_own_parent() -> None:
    # Equal echelons fail the strictly-higher rule, which is what makes a
    # separate cycle check unnecessary.
    with pytest.raises(ValueError, match="higher echelon"):
        Orbat(units=(unit("sec1", Echelon.SECTION, "sec1"),))


# Role


@pytest.mark.parametrize(
    ("echelon", "expected"),
    [
        (Echelon.COMPANY, Role.OFFICER),
        (Echelon.PLATOON, Role.OFFICER),
        (Echelon.SECTION, Role.SERGEANT),
        (Echelon.GROUP, Role.MAN),
    ],
)
def test_role_follows_the_echelon_commanded(echelon: Echelon, expected: Role) -> None:
    """A group is led by a man holding an appointment, not by a sergeant."""
    assert unit("u", echelon).role is expected


# Availability


def test_only_uncommitted_units_are_offered() -> None:
    orbat = Orbat(
        units=(
            unit("free", Echelon.SECTION),
            unit("busy", Echelon.SECTION, availability=Availability.COMMITTED),
            unit("held", Echelon.SECTION, availability=Availability.RESERVE),
        )
    )

    assert [u.unit_id for u in orbat.available()] == ["free"]


def test_redcon_is_optional_display_only_readiness() -> None:
    ready = Unit(
        unit_id="ready",
        name="Ready",
        echelon=Echelon.SECTION,
        lon=0,
        lat=0,
        strength=7,
        availability=Availability.UNCOMMITTED,
        redcon=1,
    )
    assert ready.redcon == 1
    assert Orbat(units=(ready,)).available() == [ready]
    with pytest.raises(ValueError):
        Unit(**{**ready.model_dump(), "redcon": 6})


def test_available_offers_the_formed_body_before_its_parts() -> None:
    assert [u.unit_id for u in rifle_company().available()] == [
        "coy",
        "pl1",
        "sec1",
        "sec2",
        "g1",
    ]


# Commitment


def test_committing_a_platoon_commits_its_sections() -> None:
    assert rifle_company().commits("pl1") == {"pl1", "sec1", "sec2", "g1", "coy"}


def test_committing_a_section_also_spends_the_platoon_above_it() -> None:
    """A platoon with one section gone is no longer a platoon to commit."""
    committed = rifle_company().commits("sec1")

    assert "pl1" in committed
    assert "coy" in committed
    assert "g1" in committed
    # its sibling is untouched and still available
    assert "sec2" not in committed


def test_committing_a_leaf_spends_only_itself_and_its_chain() -> None:
    assert rifle_company().commits("g1") == {"g1", "sec1", "pl1", "coy"}


def test_committing_the_root_spends_everything() -> None:
    assert rifle_company().commits("coy") == {"coy", "pl1", "sec1", "sec2", "g1"}


# Lookups


def test_subordinates_reach_every_depth() -> None:
    assert [u.unit_id for u in rifle_company().subordinates("pl1")] == ["g1", "sec1", "sec2"]


def test_superiors_run_from_the_nearest_parent_upward() -> None:
    assert [u.unit_id for u in rifle_company().superiors("g1")] == ["sec1", "pl1", "coy"]


def test_the_root_has_no_superiors() -> None:
    assert rifle_company().superiors("coy") == []
