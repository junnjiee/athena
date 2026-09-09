import { config } from '../config'
import type {
  BlockPlan,
  BlockPointInput,
  BlockEstablishmentInput,
  DelayAssessmentInput,
  CourseFeatures,
  CourseOfAction,
  EnemyIntent,
  Orbat,
  RankedCourses,
  RankingWeights,
  StudyMarks,
  StudyResult,
  Verdict,
} from '../db/studyTypes'
import type { DocumentIntelligence, SourceDocument } from '../types/documentIntelligence'

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
  graphRevision: number
  marks: StudyMarks
  excludedEdgeIds: string[]
}

export class EngineUnavailableError extends Error {}

/** What the engine said, as a sentence rather than as its wire format.
 *
 *  FastAPI reports every failure as `{"detail": "..."}`, and that detail is
 *  written for the operator -- "set ATHENA_MODEL and PROVIDER_API_KEY" is the
 *  whole fix for the courses pass. Passing the raw body through instead buries
 *  that sentence in JSON in a toast, which is how a one-line configuration fix
 *  reads as the engine being broken. */
async function engineFailure(response: Response): Promise<EngineUnavailableError> {
  const body = await response.text().catch(() => '')
  let detail = body
  try {
    const parsed = JSON.parse(body) as { detail?: unknown }
    if (typeof parsed.detail === 'string') detail = parsed.detail
  } catch {
    // Not JSON -- an unhandled error renders as plain text. Use it as it came.
  }
  return new EngineUnavailableError(
    detail.trim() ? detail.slice(0, 400) : `engine returned HTTP ${response.status}`,
  )
}

export async function runRouteStudy(request: StudyRequest): Promise<StudyResult> {
  if (!config.engineUrl) {
    throw new EngineUnavailableError('ENGINE_URL is not set')
  }

  const response = await fetch(`${config.engineUrl}/v1/route-study`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      area_id: request.areaId,
      graph_revision: request.graphRevision,
      reserves: request.marks.reserves,
      objectives: request.marks.objectives,
      excluded_edge_ids: request.excludedEdgeIds,
    }),
    signal: AbortSignal.timeout(config.engineTimeoutMs),
  })

  if (!response.ok) {
    // Never degraded into an empty study: no corridors reads as "no approaches
    // exist", which is the opposite of "we could not look".
    throw await engineFailure(response)
  }

  return (await response.json()) as StudyResult
}

export interface BlockForceRequest {
  areaId: string
  graphRevision: number
  corridors: StudyResult['corridors']
  orbat: Orbat
  reserves: StudyMarks['reserves']
  blockPoints?: BlockPointInput[]
  delayAssessments?: DelayAssessmentInput[]
  blockEstablishments?: BlockEstablishmentInput[]
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
      graph_revision: request.graphRevision,
      corridors: request.corridors,
      orbat: request.orbat,
      reserves: request.reserves,
      block_points: request.blockPoints ?? [],
      delay_assessments: request.delayAssessments ?? [],
      block_establishments: request.blockEstablishments ?? [],
    }),
    signal: AbortSignal.timeout(config.engineTimeoutMs),
  })

  if (!response.ok) {
    throw await engineFailure(response)
  }

  return (await response.json()) as BlockPlan
}

export interface CoursesRequest {
  corridors: StudyResult['corridors']
  reserves: StudyMarks['reserves']
  objectives: StudyMarks['objectives']
  intent: EnemyIntent
  /** Learned ranking weights. Reorders the list only — the doctrinal pair is
   *  selected before these are applied and cannot be learned away. */
  weights: RankingWeights
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
    throw await engineFailure(response)
  }

  return (await response.json()) as RankedCourses
}

/** Sends extracted plain text—not source file bytes—to the grounded document
 * intelligence boundary. This is a model call and uses the longer timeout. */
export async function runDocumentIntelligence(
  documents: SourceDocument[],
): Promise<DocumentIntelligence> {
  if (!config.engineUrl) {
    throw new EngineUnavailableError('ENGINE_URL is not set')
  }

  const response = await fetch(`${config.engineUrl}/v1/document-intelligence`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ documents }),
    signal: AbortSignal.timeout(config.engineReasoningTimeoutMs),
  })
  if (!response.ok) throw await engineFailure(response)
  return (await response.json()) as DocumentIntelligence
}

export const NEUTRAL_WEIGHTS: RankingWeights = {
  speed: 0.5,
  blockable: 0.5,
  complexity: 0.5,
  likelihood: 0.5,
  danger: 0.5,
}

/** Sends one verdict to the engine and gets back the moved weights.
 *
 *  The rule lives in the engine so ranking behaviour is in one place and
 *  documented once; this service only stores the result. */
export async function runPreferenceFeedback(request: {
  weights: RankingWeights
  course: CourseOfAction
  corridors: StudyResult['corridors']
  verdict: Verdict
}): Promise<{ weights: RankingWeights; features: CourseFeatures }> {
  if (!config.engineUrl) {
    throw new EngineUnavailableError('ENGINE_URL is not set')
  }

  const response = await fetch(`${config.engineUrl}/v1/preference/feedback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(config.engineTimeoutMs),
  })

  if (!response.ok) {
    throw await engineFailure(response)
  }

  return (await response.json()) as { weights: RankingWeights; features: CourseFeatures }
}
