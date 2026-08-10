"""Pulling a payload from the terrain service instead of a copied file."""

import base64
import json

import pytest

from athena.loaders import (
    PayloadError,
    build_battlefield_from_payload,
    fetch_battleground,
    fetch_plan,
)
from athena.models import Team
from tests.test_grid_wire import pack_grid

BASE_URL = "http://terrain.test"
BBOX = {"west": 0.0, "south": 0.0, "east": 1.0, "north": 1.0}


def grid_buffer(
    width: int = 4,
    height: int = 4,
    classes: list[int] | None = None,
    elevation: list[float] | None = None,
) -> bytes:
    cells = width * height
    return pack_grid(
        width=width,
        height=height,
        cell_meters=1.0,
        elevation=elevation if elevation is not None else [0.0] * cells,
        classes=classes if classes is not None else [0] * cells,
    )


class FakeResponse:
    def __init__(self, body: bytes) -> None:
        self._body = body

    def read(self) -> bytes:
        return self._body

    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, *_) -> None:
        return None


@pytest.fixture
def service(monkeypatch):
    """Serve canned bodies by URL and record what was requested."""
    routes: dict[str, bytes] = {}
    requested: list[str] = []

    def fake_urlopen(url, timeout=None):
        requested.append(url)
        if url not in routes:
            raise AssertionError(f"unexpected request: {url}")
        return FakeResponse(routes[url])

    monkeypatch.setattr("urllib.request.urlopen", fake_urlopen)
    return type("Service", (), {"routes": routes, "requested": requested})()


def plan_body(
    buffer: bytes,
    units: list[dict] | None = None,
    objectives: list[dict] | None = None,
) -> bytes:
    return json.dumps(
        {
            "plan": {
                "id": "plan-1",
                "name": "Ridge Probe",
                "units": units or [],
                "objectives": objectives or [],
                "routes": [],
                "hHour": None,
            },
            "battleground": {
                "meta": {
                    "id": "bg-1",
                    "name": "Test Ground",
                    "bbox": BBOX,
                    "width": 4,
                    "height": 4,
                    "cellMeters": 1.0,
                    "weather": None,
                },
                "features": {},
                "gridBufferBase64": base64.b64encode(buffer).decode("ascii"),
            },
        }
    ).encode("utf-8")


def test_fetch_plan_builds_a_payload_from_the_packed_grid(service) -> None:
    service.routes[f"{BASE_URL}/api/plans/plan-1"] = plan_body(
        grid_buffer(classes=[0, 3, 5, 7] * 4, elevation=[float(i) for i in range(16)])
    )

    payload = fetch_plan(BASE_URL, "plan-1")

    assert payload.terrain.width == 4
    assert payload.terrain.height == 4
    assert payload.terrain.cell_meters == 1.0
    assert payload.terrain.cells.terrain_classes[:4] == (0, 3, 5, 7)
    assert payload.terrain.cells.elevation[15] == 15.0


def test_fetch_plan_carries_the_drawn_units(service) -> None:
    service.routes[f"{BASE_URL}/api/plans/plan-1"] = plan_body(
        grid_buffer(),
        units=[
            {
                "id": "u1",
                "side": "blue",
                "name": "Alpha",
                # Fields the engine does not model must not break the load.
                "typeLabel": "Blue Force Section",
                "symbolKind": "blueSection",
                "rotationRadians": 0.0,
                "position": {"longitude": 0.1, "latitude": 0.9},
            },
            {
                "id": "u2",
                "side": "red",
                "name": "Bravo",
                "typeLabel": "Red Force Section",
                "symbolKind": "redSection",
                "rotationRadians": 1.0,
                "position": {"longitude": 0.9, "latitude": 0.1},
            },
        ],
    )

    battlefield = build_battlefield_from_payload(fetch_plan(BASE_URL, "plan-1"))

    assert [soldier.team for soldier in battlefield.soldiers] == [Team.BLUE, Team.RED]
    # Row 0 is northernmost, so the high latitude lands in the top row.
    assert (battlefield.soldiers[0].position.x, battlefield.soldiers[0].position.y) == (0, 0)
    assert (battlefield.soldiers[1].position.x, battlefield.soldiers[1].position.y) == (3, 3)


def test_fetch_battleground_reads_meta_and_grid_separately(service) -> None:
    root = f"{BASE_URL}/api/battleground/bg-1"
    service.routes[f"{root}/meta"] = json.dumps(
        {"meta": {"id": "bg-1", "bbox": BBOX}, "features": {}}
    ).encode("utf-8")
    service.routes[f"{root}/grid"] = grid_buffer(classes=[8] * 16)

    payload = fetch_battleground(BASE_URL, "bg-1")

    assert service.requested == [f"{root}/meta", f"{root}/grid"]
    assert payload.terrain.cells.terrain_classes == (8,) * 16
    assert payload.units == ()


def test_fetch_battleground_builds_ground_without_soldiers(service) -> None:
    root = f"{BASE_URL}/api/battleground/bg-1"
    service.routes[f"{root}/meta"] = json.dumps(
        {"meta": {"bbox": BBOX}, "features": {}}
    ).encode("utf-8")
    service.routes[f"{root}/grid"] = grid_buffer(
        elevation=[3.4] * 8 + [7.6] * 8,
    )

    battlefield = build_battlefield_from_payload(fetch_battleground(BASE_URL, "bg-1"))

    assert battlefield.soldiers == []
    # Metres are rounded to integer levels with the lowest cell at zero.
    assert battlefield.position_at(0, 0).z == 0
    assert battlefield.position_at(0, 2).z == 5


def test_trailing_slash_on_the_base_url_is_tolerated(service) -> None:
    service.routes[f"{BASE_URL}/api/plans/plan-1"] = plan_body(grid_buffer())

    fetch_plan(f"{BASE_URL}/", "plan-1")

    assert service.requested == [f"{BASE_URL}/api/plans/plan-1"]


def test_unknown_terrain_code_is_rejected(service) -> None:
    """A renumbered server is caught when it pushes a code out of range."""
    service.routes[f"{BASE_URL}/api/plans/plan-1"] = plan_body(
        grid_buffer(classes=[0] * 15 + [42])
    )

    with pytest.raises(PayloadError, match="42"):
        fetch_plan(BASE_URL, "plan-1")
