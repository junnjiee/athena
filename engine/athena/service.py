"""The engine's HTTP surface.

Deliberately thin. The terrain service owns all state and every operator edit;
this process fetches a graph, computes, and returns the result. Nothing is
stored, so a deterministic request always answers the same way -- which is
every endpoint but the courses-of-action pass, the one place a model reasons.
"""

import os

from fastapi import Depends, FastAPI, HTTPException
from pydantic import BaseModel, Field, field_validator

from athena.blocking import (
    BlockPlan,
    BlockPointInput,
    DelayAssessmentInput,
    plan_blocks,
)
from athena.client import fetch_graph
from athena.eca import (
    CourseGenerator,
    CourseOfAction,
    NotConfiguredError,
    RankedCourses,
    RefusedError,
    generate_courses,
    model_generator,
)
from athena.graph import RoadGraph
from athena.intent import EnemyIntent
from athena.intelligence import (
    ClaimGenerator,
    DocumentIntelligence,
    SourceDocument,
    extract_document_intelligence,
    model_claim_generator,
)
from athena.orbat import Orbat, WeaponSystem
from athena.params import (
    CORRIDOR_DETOUR_RATIO,
    CORRIDOR_MAX_HEADING_DEGREES,
    CORRIDOR_SEPARATION_METERS,
    MAX_SHARING,
    MAX_STRETCH,
    ROUTES_PER_PAIR,
)
from athena.preference import (
    Features,
    Verdict,
    Weights,
    extract_features,
    update_weights,
)
from athena.study import CorridorOut, Mark, StudyResult, run_study
from athena.targeting import (
    Effect,
    PLATFORM_CATALOGUE,
    PlatformDefinition,
    TargetClass,
    WeaponMatch,
    match_weapon,
)

app = FastAPI(title="Athena planning engine", version="0.1.0")

TERRAIN_SERVICE_URL = os.environ.get("TERRAIN_SERVICE_URL", "http://localhost:8787")


class StudyRequest(BaseModel):
    """A study over one operational area.

    ``area_id`` is resolved against the terrain service. ``graph`` is accepted
    instead for tests and for callers holding a graph already, so the engine
    can be exercised without a terrain service running.
    """

    area_id: str | None = None
    graph_revision: int | None = Field(default=None, ge=1)
    graph: RoadGraph | None = None
    reserves: list[Mark]
    objectives: list[Mark]
    routes_per_pair: int = Field(default=ROUTES_PER_PAIR, ge=1, le=32)
    max_stretch: float = Field(default=MAX_STRETCH, gt=1.0)
    max_sharing: float = Field(default=MAX_SHARING, gt=0.0, le=1.0)
    corridor_separation_meters: float = Field(default=CORRIDOR_SEPARATION_METERS, gt=0.0)
    corridor_max_heading_degrees: float = Field(
        default=CORRIDOR_MAX_HEADING_DEGREES, ge=0.0, le=180.0
    )
    corridor_detour_ratio: float = Field(default=CORRIDOR_DETOUR_RATIO, ge=1.0)
    excluded_edge_ids: list[str] = Field(default_factory=list)
    """Edges the operator has marked impassable -- a dropped bridge, a flooded
    ford. Terrain the engine has no way of knowing about on its own."""


@app.get("/health")
async def health() -> dict[str, bool]:
    return {"ok": True}


@app.get("/v1/platform-catalogue", response_model=list[PlatformDefinition])
async def platform_catalogue() -> tuple[PlatformDefinition, ...]:
    """The fixed aggressor reference data used by matching and composition."""
    return PLATFORM_CATALOGUE


class WeaponMatchRequest(BaseModel):
    weapon: WeaponSystem
    target: TargetClass
    effect: Effect = Effect.DESTROY


@app.post("/v1/weapon-target-match", response_model=WeaponMatch)
async def weapon_target_match(request: WeaponMatchRequest) -> WeaponMatch:
    """One inspectable doctrinal pairing, with no model call or inference."""
    return match_weapon(request.weapon, request.target, request.effect)


async def _resolve_graph(
    area_id: str | None,
    graph_revision: int | None,
    graph: RoadGraph | None,
) -> RoadGraph:
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
        return await fetch_graph(TERRAIN_SERVICE_URL, area_id, graph_revision)
    except Exception as error:  # noqa: BLE001 - reported, never swallowed
        raise HTTPException(
            status_code=502,
            detail=f"could not fetch operational area {area_id}: {error}",
        ) from error


@app.post("/v1/route-study", response_model=StudyResult)
async def route_study(request: StudyRequest) -> StudyResult:
    graph = await _resolve_graph(request.area_id, request.graph_revision, request.graph)

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
        separation_meters=request.corridor_separation_meters,
        max_heading_degrees=request.corridor_max_heading_degrees,
        detour_ratio=request.corridor_detour_ratio,
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
    graph_revision: int | None = Field(default=None, ge=1)
    graph: RoadGraph | None = None
    corridors: list[CorridorOut]
    orbat: Orbat
    reserves: list[Mark] = Field(default_factory=list)
    block_points: list[BlockPointInput] = Field(default_factory=list, max_length=128)
    delay_assessments: list[DelayAssessmentInput] = Field(default_factory=list, max_length=128)

    @field_validator("block_points")
    @classmethod
    def block_point_inlets_are_unique(
        cls, points: list[BlockPointInput]
    ) -> list[BlockPointInput]:
        inlet_ids = [point.inlet_id for point in points]
        if len(inlet_ids) != len(set(inlet_ids)):
            raise ValueError("block point inlet ids must be unique")
        return points

    @field_validator("delay_assessments")
    @classmethod
    def delay_assessment_inlets_are_unique(
        cls, assessments: list[DelayAssessmentInput]
    ) -> list[DelayAssessmentInput]:
        inlet_ids = [assessment.inlet_id for assessment in assessments]
        if len(inlet_ids) != len(set(inlet_ids)):
            raise ValueError("delay assessment inlet ids must be unique")
        return assessments


@app.post("/v1/block-forces", response_model=BlockPlan)
async def block_forces(request: BlockRequest) -> BlockPlan:
    graph = await _resolve_graph(request.area_id, request.graph_revision, request.graph)
    return plan_blocks(
        graph,
        request.corridors,
        request.orbat,
        request.reserves,
        request.block_points,
        request.delay_assessments,
    )


class CoursesRequest(BaseModel):
    """Enemy courses of action over corridors an earlier study derived.

    No graph is needed: this pass reasons about which approaches an enemy would
    use, not about the ground under them, and the corridors already carry
    everything that judgement rests on.
    """

    corridors: list[CorridorOut]
    reserves: list[Mark]
    objectives: list[Mark]
    intent: EnemyIntent = EnemyIntent()
    weights: Weights | None = None
    """Learned ranking weights. Omitted means purely doctrinal ordering."""


def get_course_generator() -> CourseGenerator:
    """The model call, injectable so tests never reach the API."""
    return model_generator()


class DocumentIntelligenceRequest(BaseModel):
    documents: list[SourceDocument] = Field(min_length=1, max_length=20)


MAX_DOCUMENT_INTELLIGENCE_TEXT = 500_000


def get_claim_generator() -> ClaimGenerator:
    return model_claim_generator()


@app.post("/v1/document-intelligence", response_model=DocumentIntelligence)
def document_intelligence(
    request: DocumentIntelligenceRequest,
    generator: ClaimGenerator = Depends(get_claim_generator),
) -> DocumentIntelligence:
    """Propose grounded reserve records; the operator still accepts them."""
    total_text = sum(len(document.text) for document in request.documents)
    if total_text > MAX_DOCUMENT_INTELLIGENCE_TEXT:
        raise HTTPException(
            status_code=413,
            detail="documents exceed the 500,000-character combined limit",
        )
    try:
        return extract_document_intelligence(request.documents, generator)
    except NotConfiguredError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except RefusedError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


# Sync on purpose, and the one endpoint here that is. The model call is
# blocking -- pydantic-ai's `run_sync` drives its own event loop -- and calling
# that from an `async def` handler raises "this event loop is already running",
# which is a 500 on every request. Declared with plain `def`, FastAPI runs it in
# a threadpool where there is no loop to collide with. Nothing in this endpoint
# awaits: unlike the other two it needs no graph, so there is nothing to gain by
# making it a coroutine and a working endpoint to lose.
@app.post("/v1/enemy-courses-of-action", response_model=RankedCourses)
def enemy_courses(
    request: CoursesRequest,
    generator: CourseGenerator = Depends(get_course_generator),
) -> RankedCourses:
    try:
        return generate_courses(
            request.corridors,
            request.reserves,
            request.objectives,
            request.intent,
            generator,
            weights=request.weights,
        )
    except NotConfiguredError as error:
        # 503, not 502: nothing upstream failed, this deployment was never given
        # a model to ask. The distinction is what tells an operator to edit the
        # environment rather than retry.
        raise HTTPException(status_code=503, detail=str(error)) from error
    except RefusedError as error:
        # Never an empty list of courses: "the enemy has no options" and "we did
        # not get an answer" are opposite findings.
        raise HTTPException(status_code=502, detail=str(error)) from error


class FeedbackRequest(BaseModel):
    """One verdict on one course, and the weights it should move.

    The engine holds no state, so the caller supplies the current weights and
    stores what comes back. Keeping the rule here rather than in the terrain
    service means ranking behaviour lives in one place and is documented once.
    """

    weights: Weights
    course: CourseOfAction
    corridors: list[CorridorOut]
    verdict: Verdict


class FeedbackResponse(BaseModel):
    weights: Weights
    features: Features
    """What the judged course looked like — why the weights moved as they did."""


@app.post("/v1/preference/feedback", response_model=FeedbackResponse)
async def preference_feedback(request: FeedbackRequest) -> FeedbackResponse:
    features = extract_features(request.course, request.corridors)
    return FeedbackResponse(
        weights=update_weights(request.weights, features, request.verdict),
        features=features,
    )
