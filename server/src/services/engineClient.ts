import { config } from '../config'
import type { StudyMarks, StudyResult } from '../db/studyTypes'

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
