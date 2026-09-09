import { decodeGrid } from './grid'
import type { BattlegroundMeta, BBoxDeg, GridData, OsmFeatures } from '../types/terrain'
import type { PlacedObjective, PlacedRoute, PlacedUnit } from '../types/entities'
import type { PlanSummary, SavedPlan } from '../types/plan'
import type { Forecast } from '../types/forecast'
import type {
  BlockPlan,
  CorridorEdit,
  CourseFeedbackResult,
  Echelon,
  EnemyIntent,
  OperationalAreaMeta,
  Orbat,
  Preferences,
  RankedCourses,
  RankingWeights,
  RoadEdit,
  RoadGraph,
  RouteStudy,
  RouteStudySummary,
  StudyMarks,
  Verdict,
} from '../types/routeStudy'

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string }
    return body.error ?? `HTTP ${res.status}`
  } catch {
    return `HTTP ${res.status}`
  }
}

export async function createBattleground(bbox: BBoxDeg, name: string): Promise<string> {
  const res = await fetch('/api/battleground', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...bbox, name }),
  })
  if (!res.ok) throw new Error(await readError(res))
  const body = (await res.json()) as { id: string }
  return body.id
}

export async function fetchBattlegroundMeta(
  id: string,
): Promise<{ meta: BattlegroundMeta; features: OsmFeatures }> {
  const res = await fetch(`/api/battleground/${id}/meta`)
  if (!res.ok) throw new Error(await readError(res))
  return (await res.json()) as { meta: BattlegroundMeta; features: OsmFeatures }
}

export async function fetchBattlegroundGrid(id: string, bbox: BBoxDeg): Promise<GridData> {
  const res = await fetch(`/api/battleground/${id}/grid`)
  if (!res.ok) throw new Error(await readError(res))
  return decodeGrid(await res.arrayBuffer(), bbox)
}

/** Hourly conditions and the light table over the battleground's own ground. */
export async function fetchForecast(id: string): Promise<Forecast> {
  const res = await fetch(`/api/battleground/${id}/forecast`)
  if (!res.ok) throw new Error(await readError(res))
  return (await res.json()) as Forecast
}

/** Persists the current plan against a battleground that's still generated
 *  server-side this session -- the terrain itself is never re-uploaded, the
 *  server reads it straight from its own job cache by `battlegroundId`. */
export async function savePlan(payload: {
  battlegroundId: string
  name: string
  units: PlacedUnit[]
  objectives: PlacedObjective[]
  routes: PlacedRoute[]
  /** mission start, epoch ms; null when unset */
  hHour: number | null
}): Promise<string> {
  const res = await fetch('/api/plans', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(await readError(res))
  const body = (await res.json()) as { id: string }
  return body.id
}

/** Overwrites an existing plan. Paired with `savePlan`: the page keeps the id
 *  it loaded or last saved and calls this instead, so re-saving edits the plan
 *  rather than leaving a trail of near-identical copies. */
export async function updatePlan(
  id: string,
  payload: {
    name: string
    units: PlacedUnit[]
    objectives: PlacedObjective[]
    routes: PlacedRoute[]
    hHour: number | null
  },
): Promise<void> {
  const res = await fetch(`/api/plans/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(await readError(res))
}

export async function renamePlan(id: string, name: string): Promise<void> {
  const res = await fetch(`/api/plans/${id}/name`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) throw new Error(await readError(res))
}

export async function duplicatePlan(id: string): Promise<string> {
  const res = await fetch(`/api/plans/${id}/duplicate`, { method: 'POST' })
  if (!res.ok) throw new Error(await readError(res))
  const body = (await res.json()) as { id: string }
  return body.id
}

export async function listPlans(): Promise<PlanSummary[]> {
  const res = await fetch('/api/plans')
  if (!res.ok) throw new Error(await readError(res))
  return (await res.json()) as PlanSummary[]
}

export async function deletePlan(id: string): Promise<void> {
  const res = await fetch(`/api/plans/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await readError(res))
}

/** Fetches a saved plan and decodes its terrain snapshot back into GridData,
 *  ready to hand straight to the battleground store's `loadSaved`. */
export async function fetchPlan(id: string): Promise<SavedPlan> {
  const res = await fetch(`/api/plans/${id}`)
  if (!res.ok) throw new Error(await readError(res))
  const body = (await res.json()) as {
    plan: {
      id: string
      name: string
      units: PlacedUnit[]
      objectives: PlacedObjective[]
      routes: PlacedRoute[]
      hHour: number | null
    }
    battleground: { meta: BattlegroundMeta; features: OsmFeatures; gridBufferBase64: string }
  }
  const binary = atob(body.battleground.gridBufferBase64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  const grid = decodeGrid(bytes.buffer, body.battleground.meta.bbox)

  return {
    plan: body.plan,
    meta: body.battleground.meta,
    features: body.battleground.features,
    grid,
  }
}

// --- Operational areas and route studies -------------------------------------
//
// The S2 side: wide ground, its road network, and the corridors an enemy
// reserve could reinforce along. Distinct from a battleground, which is the
// tactical 800 m grid a plan is drawn on.

export interface PlaceLookupResult {
  name: string
  kind: 'city' | 'town' | 'village' | 'hamlet' | 'borough' | 'suburb' | 'quarter' | 'neighbourhood'
  longitude: number
  latitude: number
  distanceMeters: number
}

export async function lookupNearestPlace(
  longitude: number,
  latitude: number,
  radiusMeters: number,
): Promise<PlaceLookupResult | null> {
  const query = new URLSearchParams({
    longitude: String(longitude),
    latitude: String(latitude),
    radiusMeters: String(Math.round(radiusMeters)),
  })
  const res = await fetch(`/api/places/nearest?${query}`)
  if (!res.ok) throw new Error(await readError(res))
  const body = (await res.json()) as { place: PlaceLookupResult | null }
  return body.place
}

export async function createOperationalArea(bbox: BBoxDeg, name: string): Promise<string> {
  const res = await fetch('/api/operational-area', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...bbox, name }),
  })
  if (!res.ok) throw new Error(await readError(res))
  const body = (await res.json()) as { id: string }
  return body.id
}

export async function listOperationalAreas(): Promise<OperationalAreaMeta[]> {
  const res = await fetch('/api/operational-area')
  if (!res.ok) throw new Error(await readError(res))
  return (await res.json()) as OperationalAreaMeta[]
}

export async function fetchOperationalArea(id: string): Promise<OperationalAreaMeta> {
  const res = await fetch(`/api/operational-area/${id}`)
  if (!res.ok) throw new Error(await readError(res))
  const body = (await res.json()) as { meta: OperationalAreaMeta }
  return body.meta
}

export async function updateOperationalRoadSettings(
  id: string,
  settings: Pick<OperationalAreaMeta, 'roadTheme' | 'roadEdits'>,
): Promise<OperationalAreaMeta> {
  const res = await fetch(`/api/operational-area/${id}/roads`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  })
  if (!res.ok) throw new Error(await readError(res))
  const body = (await res.json()) as { meta: OperationalAreaMeta }
  return body.meta
}

export async function updateOperationalRoadState(
  id: string,
  wayId: number,
  destroyed: boolean,
): Promise<OperationalAreaMeta> {
  const res = await fetch(`/api/operational-area/${id}/graph/roads/${wayId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ destroyed }),
  })
  if (!res.ok) throw new Error(await readError(res))
  const body = (await res.json()) as { meta: OperationalAreaMeta }
  return body.meta
}

export async function breakOperationalRoad(
  id: string,
  wayId: number,
  start: [number, number],
  end: [number, number],
): Promise<OperationalAreaMeta> {
  const res = await fetch(`/api/operational-area/${id}/graph/roads/${wayId}/breaks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ start, end }),
  })
  if (!res.ok) throw new Error(await readError(res))
  const body = (await res.json()) as { meta: OperationalAreaMeta }
  return body.meta
}

export async function addOperationalRoad(
  id: string,
  points: [number, number][],
  roadEdit: RoadEdit,
): Promise<{ meta: OperationalAreaMeta; wayId: number }> {
  const res = await fetch(`/api/operational-area/${id}/graph/roads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ points, roadClass: 'unclassified', roadEdit }),
  })
  if (!res.ok) throw new Error(await readError(res))
  return (await res.json()) as { meta: OperationalAreaMeta; wayId: number }
}

/** Drops the area and every study routed over it — a study without its graph
 *  cannot be reopened, so the two go together. Returns how many went with it. */
export async function deleteOperationalArea(id: string): Promise<number> {
  const res = await fetch(`/api/operational-area/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await readError(res))
  const body = (await res.json()) as { deletedStudies: number }
  return body.deletedStudies
}

/** The graph endpoint serves the stored gzip bytes directly. A browser does
 *  not unpack application/gzip automatically unless Content-Encoding is set,
 *  so detect the gzip signature before parsing. */
export async function fetchOperationalGraph(id: string, revision?: number): Promise<RoadGraph> {
  const query = revision === undefined ? '' : `?revision=${revision}`
  const res = await fetch(`/api/operational-area/${id}/graph${query}`)
  if (!res.ok) throw new Error(await readError(res))
  return decodeOperationalGraph(await res.arrayBuffer())
}

export async function decodeOperationalGraph(packed: ArrayBuffer): Promise<RoadGraph> {
  const bytes = new Uint8Array(packed)
  let json: string
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip'))
    json = await new Response(stream).text()
  } else {
    json = new TextDecoder().decode(bytes)
  }
  return JSON.parse(json) as RoadGraph
}

/** Runs a study. The server calls the engine and stores the result, so this
 *  resolves with corridors already derived rather than a job to poll. */
export async function createRouteStudy(payload: {
  areaId: string
  name: string
  marks: StudyMarks
  edgeOverrides?: string[]
}): Promise<RouteStudy> {
  const res = await fetch('/api/route-study', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(await readError(res))
  // Create returns the engine result and identifiers; marks/overrides are the
  // request payload the server just persisted, so keep them on the client-side
  // study shape without an unnecessary follow-up GET.
  const body = (await res.json()) as Pick<
    RouteStudy,
    | 'id'
    | 'areaId'
    | 'name'
    | 'graphRevision'
    | 'currentGraphRevision'
    | 'stale'
    | 'result'
    | 'corridorEdits'
  >
  return {
    ...body,
    marks: payload.marks,
    edgeOverrides: payload.edgeOverrides ?? [],
    // A new study has had neither pass run over it yet. Explicit nulls rather
    // than absent fields, so "not assessed" never reads as "nothing found".
    orbat: null,
    ceiling: null,
    blockPlan: null,
    intent: null,
    courses: null,
  }
}

export async function listRouteStudies(): Promise<RouteStudySummary[]> {
  const res = await fetch('/api/route-study')
  if (!res.ok) throw new Error(await readError(res))
  return (await res.json()) as RouteStudySummary[]
}

export async function fetchRouteStudy(id: string): Promise<RouteStudy> {
  const res = await fetch(`/api/route-study/${id}`)
  if (!res.ok) throw new Error(await readError(res))
  return (await res.json()) as RouteStudy
}

/** Saves edits. The server re-runs the search only when the ground or the
 *  marks changed; a rename returns the same corridors it was given. */
export async function updateRouteStudy(
  id: string,
  patch: {
    name?: string
    marks?: StudyMarks
    edgeOverrides?: string[]
    corridorEdits?: Record<string, CorridorEdit>
  },
): Promise<RouteStudy> {
  const res = await fetch(`/api/route-study/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  if (!res.ok) throw new Error(await readError(res))
  return (await res.json()) as RouteStudy
}

export async function deleteRouteStudy(id: string): Promise<void> {
  const res = await fetch(`/api/route-study/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error(await readError(res))
}

/** Runs the S2 pass: how this enemy would use the corridors already found.
 *
 *  The one call in the app that reaches a model, and the slowest by far — the
 *  caller is expected to show that something is thinking. */
export async function runEnemyCourses(
  studyId: string,
  intent: EnemyIntent,
): Promise<{ intent: EnemyIntent; courses: RankedCourses }> {
  const res = await fetch(`/api/route-study/${studyId}/courses`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ intent }),
  })
  if (!res.ok) throw new Error(await readError(res))
  return (await res.json()) as { intent: EnemyIntent; courses: RankedCourses }
}

/** Records a verdict on one course, and returns the weights it moved. */
export async function sendCourseFeedback(
  studyId: string,
  courseName: string,
  verdict: Verdict,
): Promise<CourseFeedbackResult> {
  const res = await fetch(`/api/route-study/${studyId}/courses/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ courseName, verdict }),
  })
  if (!res.ok) throw new Error(await readError(res))
  return (await res.json()) as CourseFeedbackResult
}

/** Runs the S3 pass over the corridors this study already found. Deliberately
 *  separate from the study's own PUT: changing the available force must not
 *  re-run the route search. */
export async function runBlockForces(
  studyId: string,
  orbat: Orbat,
  ceiling: Echelon,
): Promise<{ orbat: Orbat; ceiling: Echelon; blockPlan: BlockPlan }> {
  const res = await fetch(`/api/route-study/${studyId}/block-forces`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ orbat, ceiling }),
  })
  if (!res.ok) throw new Error(await readError(res))
  return (await res.json()) as { orbat: Orbat; ceiling: Echelon; blockPlan: BlockPlan }
}

/** The learned ranking weights, and how many verdicts produced them. */
export async function fetchPreferences(): Promise<Preferences> {
  const res = await fetch('/api/preferences')
  if (!res.ok) throw new Error(await readError(res))
  return (await res.json()) as Preferences
}

/** Forgets everything learned. The verdict history is kept server-side: it
 *  explains the drift that led here. */
export async function resetPreferences(): Promise<RankingWeights> {
  const res = await fetch('/api/preferences', { method: 'DELETE' })
  if (!res.ok) throw new Error(await readError(res))
  const body = (await res.json()) as { weights: RankingWeights }
  return body.weights
}
