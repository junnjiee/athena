import { config } from '../config'
import type {
  BlockPlan,
  Echelon,
  EnemyIntent,
  Orbat,
  RankedCourses,
  StudyMarks,
  StudyResult,
} from '../db/studyTypes'

/**
 * Calls the planning engine.
 *
 * The engine is stateless and holds nothing: this service owns the areas, the
 * marks and every operator edit, and hands the engine only what one study
 * needs. The engine pulls the graph itself by area id, so a road network never
 * travels through this process on its way there.
 */

export interface StudyRequest {
  areaId: string
  marks: StudyMarks
  excludedEdgeIds: string[]
}

export class EngineUnavailableError extends Error {}

export async function runRouteStudy(request: StudyRequest): Promise<StudyResult> {
  if (!config.engineUrl) {
    throw new EngineUnavailableError('ENGINE_URL is not set')
  }

  const response = await fetch(`${config.engineUrl}/v1/route-study`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      area_id: request.areaId,
      reserves: request.marks.reserves,
      objectives: request.marks.objectives,
      excluded_edge_ids: request.excludedEdgeIds,
    }),
    signal: AbortSignal.timeout(config.engineTimeoutMs),
  })

  if (!response.ok) {
    // Never degraded into an empty study: no corridors reads as "no approaches
    // exist", which is the opposite of "we could not look".
    const detail = await response.text().catch(() => '')
    throw new EngineUnavailableError(`engine returned HTTP ${response.status}: ${detail.slice(0, 200)}`)
  }

  return (await response.json()) as StudyResult
}

export interface BlockForceRequest {
  areaId: string
  corridors: StudyResult['corridors']
  orbat: Orbat
  ceiling: Echelon
}

/** Asks the engine what could block each corridor.
 *
 *  Corridors are sent rather than named, so the engine answers against the
 *  operator's current picture — including corridors they have already blocked
 *  — instead of re-deriving a possibly different set. */
export async function runBlockForces(request: BlockForceRequest): Promise<BlockPlan> {
  if (!config.engineUrl) {
    throw new EngineUnavailableError('ENGINE_URL is not set')
  }

  const response = await fetch(`${config.engineUrl}/v1/block-forces`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      area_id: request.areaId,
      corridors: request.corridors,
      orbat: request.orbat,
      ceiling: request.ceiling,
    }),
    signal: AbortSignal.timeout(config.engineTimeoutMs),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new EngineUnavailableError(
      `engine returned HTTP ${response.status}: ${detail.slice(0, 200)}`,
    )
  }

  return (await response.json()) as BlockPlan
}

export interface CoursesRequest {
  corridors: StudyResult['corridors']
  reserves: StudyMarks['reserves']
  objectives: StudyMarks['objectives']
  intent: EnemyIntent
}

/** Asks the engine to assess how the enemy would use these corridors.
 *
 *  The only call in this service that reaches a model. A failure is surfaced
 *  rather than degraded for the same reason as everywhere else here: an empty
 *  assessment reads as "the enemy has no options". */
export async function runEnemyCourses(request: CoursesRequest): Promise<RankedCourses> {
  if (!config.engineUrl) {
    throw new EngineUnavailableError('ENGINE_URL is not set')
  }

  const response = await fetch(`${config.engineUrl}/v1/enemy-courses-of-action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(config.engineReasoningTimeoutMs),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new EngineUnavailableError(
      `engine returned HTTP ${response.status}: ${detail.slice(0, 200)}`,
    )
  }

  return (await response.json()) as RankedCourses
}
