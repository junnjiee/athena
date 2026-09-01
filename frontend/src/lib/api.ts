import { decodeGrid } from './grid'
import type { BattlegroundMeta, BBoxDeg, GridData, OsmFeatures } from '../types/terrain'
import type { PlacedObjective, PlacedRoute, PlacedUnit } from '../types/entities'
import type { PlanSummary, SavedPlan } from '../types/plan'
import type { Forecast } from '../types/forecast'
import type { ReplayLog, RunResult } from '../types/replay'

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

export interface SimulationStatus {
  /** false when ENGINE_URL/ENGINE_API_TOKEN aren't set server-side */
  configured: boolean
  engineUrl: string | null
}

export async function fetchSimulationStatus(): Promise<SimulationStatus> {
  const res = await fetch('/api/simulations/status')
  if (!res.ok) throw new Error(await readError(res))
  return (await res.json()) as SimulationStatus
}

export interface SimulationBatch {
  batchId: string
  simulationCount: number
  /** soldiers the engine will field once establishment is expanded — a platoon
   *  marker is 21 of these, which is what the run actually costs */
  soldiers: number
  eventsUrl: string
  /** Ground problems the engine found while validating the payload, or null
   *  from an engine that does not report them. */
  diagnostics: ImportDiagnostics | null
}

/** What the engine noticed about the ground and the plan before running. */
export interface ImportDiagnostics {
  cells: number
  /** Adjacent cell pairs a soldier cannot step between, after real elevation is
   *  rounded to integer metres. A high count on steep ground shows up as agents
   *  that will not advance, so it is reported before the batch is spent. */
  unclimbableSteps: number
  /** Whether a side can physically reach its objective. Absent when that side
   *  drew none. False means the ground is severed between the force and the
   *  objective — a river with no crossing, a cliff line — so the plan is not
   *  slow, it is impossible, and running it wastes the whole batch. */
  blueObjectiveReachable?: boolean
  redObjectiveReachable?: boolean
}

/** Checks a plan against its ground without queueing a batch. Called when the
 *  run dialog opens, so an impossible plan is refused before it costs money. */
export async function fetchPlanDiagnostics(planId: string): Promise<ImportDiagnostics> {
  const res = await fetch(`/api/plans/${planId}/diagnostics`, { method: 'POST' })
  if (!res.ok) throw new Error(await readError(res))
  return (await res.json()) as ImportDiagnostics
}

export interface BatchSummary {
  batchId: string
  planId: string
  planName: string
  battlegroundId: string
  simulationCount: number
  ticks: number
  model: string | null
  soldiers: number
  createdAt: string
  status: string
  completed: number
  failed: number
  completedAt: string | null
}

export interface BatchRun {
  simulationId: string
  simulationIndex: number
  status: string
  summary: RunResult | null
  error: string | null
  replayPath: string | null
}

export interface BatchDetail {
  batchId: string
  planId: string | null
  planName: string | null
  battlegroundId: string | null
  soldiers: number | null
  simulationCount: number
  ticks: number
  model: string | null
  status: string
  createdAt: string
  completedAt: string | null
  runs: BatchRun[]
}

/** Every batch this service has submitted, newest first, with the engine's
 *  stored results attached. This is what makes a completed batch readable after
 *  the browser tab that watched it has gone. */
export async function listSimulationBatches(): Promise<BatchSummary[]> {
  const res = await fetch('/api/simulations')
  if (!res.ok) throw new Error(await readError(res))
  return ((await res.json()) as { batches: BatchSummary[] }).batches
}

/** One full replay, through the service rather than straight from the bucket:
 *  a presigned URL signs the Host header, so one signed for the bucket's
 *  internal hostname is unusable from a browser. */
export async function fetchReplay(replayPath: string): Promise<ReplayLog> {
  const res = await fetch(replayPath)
  if (!res.ok) throw new Error(await readError(res))
  return (await res.json()) as ReplayLog
}

export async function fetchSimulationBatch(batchId: string): Promise<BatchDetail> {
  const res = await fetch(`/api/simulations/${batchId}`)
  if (!res.ok) throw new Error(await readError(res))
  return (await res.json()) as BatchDetail
}

/** Queues a Monte Carlo batch over a saved plan. Returns as soon as the engine
 *  accepts it; results arrive on the event stream (see lib/simulationStream.ts). */
export async function startSimulation(
  planId: string,
  options: { simulationCount: number; ticks: number; model?: string },
): Promise<SimulationBatch> {
  const res = await fetch(`/api/plans/${planId}/simulate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(options),
  })
  if (!res.ok) throw new Error(await readError(res))
  return (await res.json()) as SimulationBatch
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
