"""The engine's HTTP surface.

Deliberately thin. The terrain service owns all state and every operator edit;
this process fetches a graph, runs a deterministic search over it, and returns
the result. Nothing is stored, so the same request always answers the same way.
"""

import os

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from athena.client import fetch_graph
from athena.graph import RoadGraph
from athena.params import CORRIDOR_SIMILARITY, MAX_SHARING, MAX_STRETCH, ROUTES_PER_PAIR
from athena.study import Mark, StudyResult, run_study

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


@app.post("/v1/route-study", response_model=StudyResult)
async def route_study(request: StudyRequest) -> StudyResult:
    if request.graph is not None:
        graph = request.graph
    elif request.area_id is not None:
        try:
            graph = await fetch_graph(TERRAIN_SERVICE_URL, request.area_id)
        except Exception as error:  # noqa: BLE001 - reported, never swallowed
            # A study on a graph we could not fetch would be a confident answer
            # about ground nobody read.
            raise HTTPException(
                status_code=502,
                detail=f"could not fetch operational area {request.area_id}: {error}",
            ) from error
    else:
        raise HTTPException(status_code=400, detail="either area_id or graph is required")

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
