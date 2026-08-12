import { decodeGrid } from './grid'
import type { BattlegroundMeta, BBoxDeg, GridData, OsmFeatures } from '../types/terrain'
import type { PlacedObjective, PlacedRoute, PlacedUnit } from '../types/entities'
import type { PlanSummary, SavedPlan } from '../types/plan'
import type { Forecast } from '../types/forecast'

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
