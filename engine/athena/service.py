"""The engine's HTTP surface.

Deliberately thin. The terrain service owns all state and every operator edit;
this process fetches a graph, runs a deterministic search over it, and returns
the result. Nothing is stored, so the same request always answers the same way.
"""

import os

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from athena.blocking import BlockPlan, plan_blocks
from athena.client import fetch_graph
from athena.graph import RoadGraph
from athena.params import CORRIDOR_SIMILARITY, MAX_SHARING, MAX_STRETCH, ROUTES_PER_PAIR
from athena.orbat import Orbat
from athena.study import CorridorOut, Mark, StudyResult, run_study
from athena.units import Echelon

app = FastAPI(title="Athena planning engine", version="0.1.0")

TERRAIN_SERVICE_URL = os.environ.get("TERRAIN_SERVICE_URL", "http://localhost:8787")


class StudyRequest(BaseModel):
    """A study over one operational area.

    ``area_id`` is resolved against the terrain service. ``graph`` is accepted
    instead for tests and for callers holding a graph already, so the engine
    can be exercised without a terrain service running.
    """

    area_id: str | None = None
    graph: RoadGraph | None = None
    reserves: list[Mark]
    objectives: list[Mark]
    routes_per_pair: int = Field(default=ROUTES_PER_PAIR, ge=1, le=32)
    max_stretch: float = Field(default=MAX_STRETCH, gt=1.0)
    max_sharing: float = Field(default=MAX_SHARING, gt=0.0, le=1.0)
    corridor_similarity: float = Field(default=CORRIDOR_SIMILARITY, ge=0.0, le=1.0)
    excluded_edge_ids: list[str] = Field(default_factory=list)
    """Edges the operator has marked impassable -- a dropped bridge, a flooded
    ford. Terrain the engine has no way of knowing about on its own."""


@app.get("/health")
async def health() -> dict[str, bool]:
    return {"ok": True}


async def _resolve_graph(area_id: str | None, graph: RoadGraph | None) -> RoadGraph:
    """The ground to answer over: supplied directly, or pulled by area id.

    A failure here is a 502 rather than an empty answer. Reporting no corridors
    for ground nobody managed to read would be a confident statement about
    nothing.
    """
    if graph is not None:
        return graph
    if area_id is None:
        raise HTTPException(status_code=400, detail="either area_id or graph is required")
    try:
        return await fetch_graph(TERRAIN_SERVICE_URL, area_id)
    except Exception as error:  # noqa: BLE001 - reported, never swallowed
        raise HTTPException(
            status_code=502,
            detail=f"could not fetch operational area {area_id}: {error}",
        ) from error


@app.post("/v1/route-study", response_model=StudyResult)
async def route_study(request: StudyRequest) -> StudyResult:
    graph = await _resolve_graph(request.area_id, request.graph)

    if not request.reserves:
        raise HTTPException(status_code=400, detail="at least one enemy reserve is required")
    if not request.objectives:
        raise HTTPException(status_code=400, detail="at least one objective is required")

    return run_study(
        graph,
        reserves=request.reserves,
        objectives=request.objectives,
        k=request.routes_per_pair,
        max_stretch=request.max_stretch,
        max_sharing=request.max_sharing,
        similarity=request.corridor_similarity,
        excluded_edge_ids=frozenset(request.excluded_edge_ids),
    )


class BlockRequest(BaseModel):
    """Block-force options against corridors an earlier study derived.

    The corridors are passed in rather than recomputed: they are the operator's
    current picture, including any corridor they have blocked or ground they
    have marked impassable, and re-deriving them here could silently answer a
    different question from the one on their screen.
    """

    area_id: str | None = None
    graph: RoadGraph | None = None
    corridors: list[CorridorOut]
    orbat: Orbat
    ceiling: Echelon = Echelon.COMPANY
    """Largest formation that may be committed to any one corridor."""


@app.post("/v1/block-forces", response_model=BlockPlan)
async def block_forces(request: BlockRequest) -> BlockPlan:
    graph = await _resolve_graph(request.area_id, request.graph)
    return plan_blocks(graph, request.corridors, request.orbat, ceiling=request.ceiling)
