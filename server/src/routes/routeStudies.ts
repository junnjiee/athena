import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../db/client'
import { courseFeedback, rankingWeights, routeStudies } from '../db/schema'
import type {
  BlockEstablishmentInput,
  BlockPlan,
  BlockPointInput,
  CorridorEdit,
  CourseCorridor,
  DelayAssessmentInput,
  EnemyIntent,
  Orbat,
  RankedCourses,
  RankingWeights,
  StudyMarks,
  StudyResult,
} from '../db/studyTypes'
import {
  EngineUnavailableError,
  NEUTRAL_WEIGHTS,
  runBlockForces,
  runEnemyCourses,
  runPreferenceFeedback,
  runRouteStudy,
} from '../services/engineClient'
import { loadOperationalAreaRevision } from '../services/operationalAreaStore'
import { reattachCorridorEdits } from '../services/corridorEdits'

function boundedContext(value: string | undefined, maxLength: number): string | undefined {
  const normalized = value?.replace(/\s+/g, ' ').trim()
  return normalized ? normalized.slice(0, maxLength) : undefined
}

/** Adds only operator-authored context to the model pass. Stable corridor ids
 *  and derived route facts remain unchanged and continue to ground output. */
export function corridorsForCourseAssessment(
  corridors: StudyResult['corridors'],
  edits: Record<string, CorridorEdit>,
): CourseCorridor[] {
  return corridors.map((corridor) => {
    const edit = edits[corridor.id]
    const operatorName = boundedContext(edit?.name, 80)
    const operatorCategory = boundedContext(edit?.category, 40)
    return {
      ...corridor,
      ...(operatorName ? { operator_name: operatorName } : {}),
      ...(operatorCategory ? { operator_category: operatorCategory } : {}),
    }
  })
}

/** Structured intent may only point at objectives belonging to this study. */
export function unknownIntentObjectiveIds(
  intent: EnemyIntent,
  objectives: StudyMarks['objectives'],
): string[] {
  const known = new Set(objectives.map((objective) => objective.id))
  return [...new Set(intent.objective_ids.filter((id) => !known.has(id)))].sort()
}

/** Remove only objective selections that disappeared from a rerouted study. */
export function reconcileIntentWithObjectives(
  intent: EnemyIntent | null,
  objectives: StudyMarks['objectives'],
): EnemyIntent | null {
  if (!intent) return null
  const known = new Set(objectives.map((objective) => objective.id))
  return {
    ...intent,
    objective_ids: intent.objective_ids.filter((id) => known.has(id)),
  }
}

/** Whether every saved effort still names ground in the new route result.
 *  Legacy efforts without an objective retain pair-level compatibility. */
export function coursesRemainGrounded(
  courses: RankedCourses | null,
  result: StudyResult,
): boolean {
  if (!courses) return true
  const pairs = new Set<string>()
  const triples = new Set<string>()
  for (const corridor of result.corridors) {
    for (const route of corridor.routes) {
      pairs.add(JSON.stringify([corridor.id, route.reserve_id]))
      triples.add(JSON.stringify([corridor.id, route.reserve_id, route.objective_id]))
    }
  }
  return courses.courses.every(
    (course) => course.efforts.length > 0 && course.efforts.every((effort) => (
      effort.objective_id
        ? triples.has(JSON.stringify([
            effort.corridor_id,
            effort.reserve_id,
            effort.objective_id,
          ]))
        : pairs.has(JSON.stringify([effort.corridor_id, effort.reserve_id]))
    )),
  )
}

export function reconcileCourseState(
  intent: EnemyIntent | null,
  courses: RankedCourses | null,
  objectives: StudyMarks['objectives'],
  result: StudyResult,
): { intent: EnemyIntent | null; courses: RankedCourses | null } {
  const reconciledIntent = reconcileIntentWithObjectives(intent, objectives)
  const intentChanged = reconciledIntent?.objective_ids.length !== intent?.objective_ids.length
  return {
    intent: reconciledIntent,
    courses: intentChanged || !coursesRemainGrounded(courses, result) ? null : courses,
  }
}

function inletRouteKey(reserveId: string, objectiveId: string, edgeIds: string[]): string {
  return JSON.stringify([reserveId, objectiveId, edgeIds])
}

/** Keep operator inputs only for route identities that survived a rerun.
 *  Inlet identity deliberately ignores corridor regrouping. */
export function blockInputsForRoutes(
  plan: BlockPlan,
  result: StudyResult,
): {
  blockPoints: BlockPointInput[]
  delayAssessments: DelayAssessmentInput[]
  blockEstablishments: BlockEstablishmentInput[]
} {
  const liveRoutes = new Set(
    result.corridors.flatMap((corridor) => corridor.routes.map((route) => (
      inletRouteKey(route.reserve_id, route.objective_id, route.edge_ids)
    ))),
  )
  const liveInletIds = new Set(
    (plan.inlets ?? [])
      .filter((inlet) => liveRoutes.has(
        inletRouteKey(inlet.reserve_id, inlet.objective_id, inlet.edge_ids),
      ))
      .map((inlet) => inlet.inlet_id),
  )
  return {
    blockPoints: (plan.block_points ?? [])
      .filter((point) => liveInletIds.has(point.inlet_id))
      .map(({ inlet_id, lon, lat }) => ({ inlet_id, lon, lat })),
    delayAssessments: (plan.delay_assessments ?? [])
      .filter((assessment) => liveInletIds.has(assessment.inlet_id)),
    blockEstablishments: (plan.block_establishments ?? [])
      .filter((assessment) => liveInletIds.has(assessment.inlet_id)),
  }
}

export function reserveBlockInputsChanged(current: StudyMarks, next: StudyMarks): boolean {
  return JSON.stringify(current.reserves) !== JSON.stringify(next.reserves)
}

const markBoundsSchema = z.object({
  west: z.number().gte(-180).lte(180),
  south: z.number().gte(-85).lte(85),
  east: z.number().gte(-180).lte(180),
  north: z.number().gte(-85).lte(85),
}).refine((bounds) => bounds.north > bounds.south && bounds.east !== bounds.west, {
  message: 'objective bounds must have positive latitude and longitude extent',
})

const markSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  lon: z.number().gte(-180).lte(180),
  lat: z.number().gte(-85).lte(85),
  locality: z.string().trim().min(1).max(120).optional(),
  /** Area objectives route to the first live road point reached inside these bounds. */
  bbox: markBoundsSchema.optional(),
})

export const objectiveMarkSchema = markSchema

const platformCountSchema = z.object({
  id: z.string().min(1),
  platform: z.string().trim().min(1).max(80),
  establishment_count: z.number().int().positive().max(10_000),
})

const taskOrganizationElementSchema = z.object({
  id: z.string().min(1),
  designation: z.string().trim().min(1).max(80),
  echelon: z.enum(['division', 'regiment', 'battalion', 'company', 'platoon', 'section']),
  modifier: z.enum(['=', '-', 'full', '+']),
  order_of_move: z.number().int().positive().max(100),
  platforms: z.array(platformCountSchema).max(100),
})

const reserveTimingSchema = z.object({
  decision_minutes: z.number().nonnegative().max(10_080).optional(),
  readiness_minutes: z.number().nonnegative().max(10_080).optional(),
  deployment_minutes: z.number().nonnegative().max(10_080).optional(),
})

const intelligenceEvidenceSchema = z.object({
  source_document_id: z.string().trim().min(1).max(120),
  source_document_name: z.string().trim().min(1).max(240),
  excerpt: z.string().trim().min(1).max(500),
})

const intelligenceEvidenceListSchema = z.array(intelligenceEvidenceSchema).max(20).refine(
  (evidence) => new Set(evidence.map((item) => item.source_document_id)).size === evidence.length,
  'intelligence evidence source ids must be unique',
)

export const reserveMarkSchema = markSchema.extend({
  level: z.enum(['K', 'K1', 'K2', 'K3', 'K4']).optional(),
  owning_formation: z.string().trim().min(1).max(80).optional(),
  /** Confirmed is an operator assertion backed by the two-source rule. New and
   *  legacy reserve marks therefore enter as assessed unless explicitly set. */
  intelligence_status: z.enum(['assessed', 'confirmed']).default('assessed'),
  intelligence_evidence: intelligenceEvidenceListSchema.optional(),
  task_organization: z.array(taskOrganizationElementSchema).max(100).optional(),
  timing: reserveTimingSchema.optional(),
})

const marksSchema = z.object({
  reserves: z.array(reserveMarkSchema).min(1),
  objectives: z.array(objectiveMarkSchema).min(1),
})

const createBody = z.object({
  areaId: z.string().min(1),
  name: z.string().trim().min(1).max(80).default('Untitled Study'),
  marks: marksSchema,
  edgeOverrides: z.array(z.string()).default([]),
})

const updateBody = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  marks: marksSchema.optional(),
  edgeOverrides: z.array(z.string()).optional(),
  corridorEdits: z.record(z.object({
    name: z.string().max(80).optional(),
    category: z.string().max(40).optional(),
    reattachment: z.object({
      from_corridor_id: z.string().min(1),
      from_revision: z.number().int().positive(),
      to_revision: z.number().int().positive(),
      overlap: z.number().min(0).max(1),
    }).optional(),
  })).optional(),
})


const echelonSchema = z.enum(['company', 'platoon', 'section', 'group'])
const weaponSystemSchema = z.enum([
  'ATGM',
  'Light RR',
  'LAW',
  '40mm AGL',
  '12.7mm HMG',
  'GPMG',
  'SAW',
  '81mm mortar',
  '60mm mortar',
  'mini UAV',
])

const weaponHoldingSchema = z.object({
  id: z.string().min(1),
  weapon: weaponSystemSchema,
  count: z.number().int().positive().max(10_000),
})

const orbatUnitSchema = z.object({
  unit_id: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  echelon: echelonSchema,
  parent_id: z.string().min(1).nullish(),
  lon: z.number().gte(-180).lte(180),
  lat: z.number().gte(-85).lte(85),
  strength: z.number().int().positive(),
  weapons: z.array(weaponHoldingSchema).max(100).default([]),
  availability: z.enum(['uncommitted', 'committed', 'reserve']).default('uncommitted'),
  redcon: z.union([
    z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5),
  ]).nullish(),
}).superRefine((unit, ctx) => {
  const ids = new Set<string>()
  const systems = new Set<string>()
  unit.weapons.forEach((holding, index) => {
    if (ids.has(holding.id)) {
      ctx.addIssue({ code: 'custom', path: ['weapons', index, 'id'], message: 'duplicate holding id' })
    }
    if (systems.has(holding.weapon)) {
      ctx.addIssue({ code: 'custom', path: ['weapons', index, 'weapon'], message: 'duplicate weapon system' })
    }
    ids.add(holding.id)
    systems.add(holding.weapon)
  })
})

const orbatSchema = z.object({
  units: z.array(orbatUnitSchema),
})

const blockPointSchema = z.object({
  inlet_id: z.string().min(1).max(120),
  lon: z.number().gte(-180).lte(180),
  lat: z.number().gte(-85).lte(85),
})

const delayAssessmentSchema = z.object({
  inlet_id: z.string().min(1).max(120),
  unit_id: z.string().min(1).max(120),
  delay_minutes: z.number().finite().gt(0).max(10_080),
})

const blockEstablishmentSchema = z.object({
  inlet_id: z.string().min(1).max(120),
  unit_id: z.string().min(1).max(120),
  block_point_lon: z.number().gte(-180).lte(180),
  block_point_lat: z.number().gte(-85).lte(85),
  established_minutes: z.number().finite().gte(0).max(10_080),
})

export const blockForcesBody = z.object({
  orbat: orbatSchema,
  blockPoints: z.array(blockPointSchema).max(128).default([]).refine(
    (points) => new Set(points.map((point) => point.inlet_id)).size === points.length,
    'block point inlet ids must be unique',
  ),
  delayAssessments: z.array(delayAssessmentSchema).max(128).default([]).refine(
    (assessments) => new Set(assessments.map((entry) => entry.inlet_id)).size === assessments.length,
    'delay assessment inlet ids must be unique',
  ),
  blockEstablishments: z.array(blockEstablishmentSchema).max(128).default([]).refine(
    (entries) => new Set(entries.map((entry) => entry.inlet_id)).size === entries.length,
    'block establishment inlet ids must be unique',
  ),
})


export const enemyCoursesBody = z.object({
  intent: z.object({
    objective_ids: z.array(z.string().trim().min(1)).max(100).default([]).refine(
      (ids) => new Set(ids).size === ids.length,
      'intent objective ids must be unique',
    ),
    /** Free text, as an S2 would write it. Reaches the model unedited. */
    narrative: z.string().max(4000).default(''),
  }),
})


/** The single weights row, created neutral on first read.
 *
 *  Neutral means nothing has been learned, so courses come back in doctrinal
 *  order — which is what a fresh deployment should do. */
const WEIGHTS_ID = 'default'

async function loadWeights(): Promise<RankingWeights> {
  const rows = await db
    .select()
    .from(rankingWeights)
    .where(eq(rankingWeights.id, WEIGHTS_ID))
    .limit(1)
  return rows[0]?.weights ?? NEUTRAL_WEIGHTS
}

async function saveWeights(weights: RankingWeights): Promise<void> {
  await db
    .insert(rankingWeights)
    .values({ id: WEIGHTS_ID, weights, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: rankingWeights.id,
      set: { weights, updatedAt: new Date() },
    })
}

export const feedbackBody = z.object({
  courseName: z.string().min(1).max(80),
  verdict: z.enum(['accepted', 'rejected']),
})

/** Whether an edit changes what the engine would find.
 *
 *  Only the ground and the marks do. Renaming, categorising, splitting or
 *  merging corridors are presentation over a result that has not changed, and
 *  re-running the search for a typed name would churn corridor identity for
 *  nothing -- which is exactly what the operator's edits are keyed on. */
export function needsResearch(
  current: { marks: StudyMarks; edgeOverrides: string[]; graphRevision?: number },
  next: { marks?: StudyMarks; edgeOverrides?: string[] },
  currentGraphRevision = current.graphRevision,
): boolean {
  // A stale study only advances when the operator explicitly runs it (the run
  // request carries marks). Presentation-only edits remain attached to the
  // old corridor identities until that deliberate re-run.
  if (
    next.marks &&
    current.graphRevision !== undefined &&
    currentGraphRevision !== undefined &&
    current.graphRevision !== currentGraphRevision
  ) {
    return true
  }
  if (next.marks) {
    // Names and reserve intelligence annotate the deployment overlay; the
    // graph search sees mark identity, position, and objective ground. Saving
    // an assessment must not churn corridor identities when none changed.
    const routingMarks = (marks: StudyMarks) => ({
      reserves: marks.reserves.map(({ id, lon, lat }) => ({ id, lon, lat })),
      objectives: marks.objectives.map(({ id, lon, lat, bbox }) => ({ id, lon, lat, bbox })),
    })
    if (JSON.stringify(routingMarks(next.marks)) !== JSON.stringify(routingMarks(current.marks))) {
      return true
    }
  }
  if (
    next.edgeOverrides &&
    JSON.stringify([...next.edgeOverrides].sort()) !== JSON.stringify([...current.edgeOverrides].sort())
  ) {
    return true
  }
  return false
}

export function registerRouteStudyRoutes(app: FastifyInstance): void {
  app.post('/api/route-study', async (req, reply) => {
    const parsed = createBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid body' })
    }
    const { areaId, name, marks, edgeOverrides } = parsed.data
    const graphRevision = await loadOperationalAreaRevision(areaId)
    if (graphRevision === null) return reply.status(404).send({ error: 'unknown operational area' })

    let result
    try {
      result = await runRouteStudy({ areaId, graphRevision, marks, excludedEdgeIds: edgeOverrides })
    } catch (error: unknown) {
      // An engine we could not reach is a 503, never a study with no corridors:
      // an empty result reads as "no approaches exist".
      if (error instanceof EngineUnavailableError) {
        return reply.status(503).send({ error: error.message })
      }
      throw error
    }

    const id = randomUUID()
    await db.insert(routeStudies).values({
      id,
      areaId,
      name,
      graphRevision,
      marks,
      edgeOverrides,
      result,
      corridorEdits: {},
    })
    return reply.status(201).send({
      id,
      name,
      areaId,
      graphRevision,
      currentGraphRevision: graphRevision,
      stale: false,
      result,
      corridorEdits: {},
    })
  })

  app.get('/api/route-study', async () => {
    const rows = await db
      .select({
        id: routeStudies.id,
        areaId: routeStudies.areaId,
        name: routeStudies.name,
        updatedAt: routeStudies.updatedAt,
      })
      .from(routeStudies)
    return rows
  })

  app.get<{ Params: { id: string } }>('/api/route-study/:id', async (req, reply) => {
    const rows = await db.select().from(routeStudies).where(eq(routeStudies.id, req.params.id)).limit(1)
    const row = rows[0]
    if (!row) return reply.status(404).send({ error: 'unknown route study' })
    const currentGraphRevision = await loadOperationalAreaRevision(row.areaId)
    if (currentGraphRevision === null) {
      return reply.status(404).send({ error: 'unknown operational area' })
    }
    return {
      id: row.id,
      areaId: row.areaId,
      name: row.name,
      graphRevision: row.graphRevision,
      currentGraphRevision,
      stale: row.graphRevision !== currentGraphRevision,
      marks: row.marks,
      edgeOverrides: row.edgeOverrides,
      result: row.result,
      corridorEdits: row.corridorEdits,
      // The S2 and S3 passes, null until each has been run. Returned here
      // because a study reopened tomorrow has to show the assessment and the
      // allocation the commander is reading, not just the ground.
      orbat: row.orbat,
      blockPlan: row.blockPlan,
      intent: row.intent,
      courses: row.courses,
    }
  })

  app.put<{ Params: { id: string } }>('/api/route-study/:id', async (req, reply) => {
    const parsed = updateBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid body' })
    }

    const rows = await db.select().from(routeStudies).where(eq(routeStudies.id, req.params.id)).limit(1)
    const row = rows[0]
    if (!row) return reply.status(404).send({ error: 'unknown route study' })
    const currentGraphRevision = await loadOperationalAreaRevision(row.areaId)
    if (currentGraphRevision === null) {
      return reply.status(404).send({ error: 'unknown operational area' })
    }

    const marks = parsed.data.marks ?? row.marks
    const edgeOverrides = parsed.data.edgeOverrides ?? row.edgeOverrides
    let corridorEdits: Record<string, CorridorEdit> =
      parsed.data.corridorEdits ?? row.corridorEdits

    let result = row.result
    let blockPlan = row.blockPlan
    const research = needsResearch(row, parsed.data, currentGraphRevision)
    const replanBlocks = blockPlan !== null && (
      research || reserveBlockInputsChanged(row.marks, marks)
    )
    if (research || replanBlocks) {
      try {
        if (research) {
          result = await runRouteStudy({
            areaId: row.areaId,
            graphRevision: currentGraphRevision,
            marks,
            excludedEdgeIds: edgeOverrides,
          })
          if (row.graphRevision !== currentGraphRevision) {
            corridorEdits = reattachCorridorEdits(
              row.result,
              result,
              corridorEdits,
              row.graphRevision,
              currentGraphRevision,
            )
          }
        }
        if (replanBlocks && blockPlan) {
          if (!row.orbat) {
            blockPlan = null
          } else {
            const retained = blockInputsForRoutes(blockPlan, result)
            blockPlan = await runBlockForces({
              areaId: row.areaId,
              graphRevision: research ? currentGraphRevision : row.graphRevision,
              corridors: result.corridors,
              orbat: row.orbat,
              reserves: marks.reserves,
              ...retained,
            })
          }
        }
      } catch (error: unknown) {
        if (error instanceof EngineUnavailableError) {
          return reply.status(503).send({ error: error.message })
        }
        throw error
      }
    }
    const { intent, courses } = research
      ? reconcileCourseState(row.intent, row.courses, marks.objectives, result)
      : { intent: row.intent, courses: row.courses }

    await db
      .update(routeStudies)
      .set({
        name: parsed.data.name ?? row.name,
        marks,
        edgeOverrides,
        result,
        graphRevision: research ? currentGraphRevision : row.graphRevision,
        corridorEdits,
        blockPlan,
        intent,
        courses,
        updatedAt: new Date(),
      })
      .where(eq(routeStudies.id, req.params.id))

    return {
      id: row.id,
      areaId: row.areaId,
      name: parsed.data.name ?? row.name,
      graphRevision: research ? currentGraphRevision : row.graphRevision,
      currentGraphRevision,
      stale: research ? false : row.graphRevision !== currentGraphRevision,
      marks,
      edgeOverrides,
      result,
      corridorEdits,
      // Presentation-only edits retain both passes. A reroute recalculates the
      // block plan from current inlets and reconciles the saved S2 assessment.
      orbat: row.orbat,
      blockPlan,
      intent,
      courses,
    }
  })


  /** Runs the S3 pass over the corridors this study already found.
   *
   *  Kept off the study's own PUT because the ORBAT is a separate question from
   *  the ground: changing which force is available must not re-run the route
   *  search. A later ground change recomputes this pass from the retained ORBAT
   *  and any operator inputs whose exact inlet route survived. */
  app.post<{ Params: { id: string } }>(
    '/api/route-study/:id/block-forces',
    async (req, reply) => {
      const parsed = blockForcesBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid body' })
      }

      const rows = await db
        .select()
        .from(routeStudies)
        .where(eq(routeStudies.id, req.params.id))
        .limit(1)
      const row = rows[0]
      if (!row) return reply.status(404).send({ error: 'unknown route study' })

      const orbat = parsed.data.orbat as Orbat

      let blockPlan
      try {
        blockPlan = await runBlockForces({
          areaId: row.areaId,
          graphRevision: row.graphRevision,
          corridors: row.result.corridors,
          orbat,
          reserves: row.marks.reserves,
          blockPoints: parsed.data.blockPoints,
          delayAssessments: parsed.data.delayAssessments,
          blockEstablishments: parsed.data.blockEstablishments,
        })
      } catch (error: unknown) {
        if (error instanceof EngineUnavailableError) {
          return reply.status(503).send({ error: error.message })
        }
        throw error
      }

      await db
        .update(routeStudies)
        .set({ orbat, blockPlan, updatedAt: new Date() })
        .where(eq(routeStudies.id, req.params.id))

      return { orbat, blockPlan }
    },
  )


  /** Runs the S2 pass: how this enemy would use the corridors already found.
   *
   *  The only endpoint here that reaches a model. Corridors are sent from the
   *  stored study rather than recomputed, so the assessment is about the ground
   *  the operator is actually looking at. */
  app.post<{ Params: { id: string } }>(
    '/api/route-study/:id/courses',
    async (req, reply) => {
      const parsed = enemyCoursesBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid body' })
      }

      const rows = await db
        .select()
        .from(routeStudies)
        .where(eq(routeStudies.id, req.params.id))
        .limit(1)
      const row = rows[0]
      if (!row) return reply.status(404).send({ error: 'unknown route study' })

      const intent = parsed.data.intent as EnemyIntent
      const unknownObjectives = unknownIntentObjectiveIds(intent, row.marks.objectives)
      if (unknownObjectives.length > 0) {
        return reply.status(400).send({
          error: `intent names objective(s) outside this study: ${unknownObjectives.join(', ')}`,
        })
      }

      let courses
      try {
        courses = await runEnemyCourses({
          corridors: corridorsForCourseAssessment(row.result.corridors, row.corridorEdits),
          reserves: row.marks.reserves,
          objectives: row.marks.objectives,
          intent,
          weights: await loadWeights(),
        })
      } catch (error: unknown) {
        if (error instanceof EngineUnavailableError) {
          return reply.status(503).send({ error: error.message })
        }
        throw error
      }

      await db
        .update(routeStudies)
        .set({ intent, courses, updatedAt: new Date() })
        .where(eq(routeStudies.id, req.params.id))

      return { intent, courses }
    },
  )


  /** Records a verdict on one course and lets it move the ranking weights.
   *
   *  The verdict is stored with the course's feature vector rather than a
   *  pointer to the course: a course has no identity across runs -- the model
   *  rewrites it every time -- but 'fast', 'blockable' and 'multi-pronged' mean
   *  the same thing next week, which is what makes feedback attachable. */
  app.post<{ Params: { id: string } }>(
    '/api/route-study/:id/courses/feedback',
    async (req, reply) => {
      const parsed = feedbackBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid body' })
      }

      const rows = await db
        .select()
        .from(routeStudies)
        .where(eq(routeStudies.id, req.params.id))
        .limit(1)
      const row = rows[0]
      if (!row) return reply.status(404).send({ error: 'unknown route study' })

      const course = row.courses?.courses.find((c) => c.name === parsed.data.courseName)
      if (!course) {
        return reply.status(404).send({ error: 'no such course in this study' })
      }

      let moved
      try {
        moved = await runPreferenceFeedback({
          weights: await loadWeights(),
          course,
          corridors: row.result.corridors,
          verdict: parsed.data.verdict,
        })
      } catch (error: unknown) {
        if (error instanceof EngineUnavailableError) {
          return reply.status(503).send({ error: error.message })
        }
        throw error
      }

      await saveWeights(moved.weights)
      await db.insert(courseFeedback).values({
        id: randomUUID(),
        studyId: row.id,
        courseName: course.name,
        verdict: parsed.data.verdict,
        features: moved.features,
      })

      return { weights: moved.weights, features: moved.features }
    },
  )

  /** The learned weights, and how many verdicts produced them. Exposed because
   *  a ranking nobody can inspect is one nobody should trust. */
  app.get('/api/preferences', async () => {
    const history = await db.select().from(courseFeedback)
    return { weights: await loadWeights(), verdicts: history.length }
  })

  /** Forgets everything learned. The history is kept: it explains the drift
   *  that led here, and deleting it would remove the evidence. */
  app.delete('/api/preferences', async () => {
    await saveWeights(NEUTRAL_WEIGHTS)
    return { weights: NEUTRAL_WEIGHTS }
  })

  app.delete<{ Params: { id: string } }>('/api/route-study/:id', async (req, reply) => {
    await db.delete(routeStudies).where(eq(routeStudies.id, req.params.id))
    return reply.status(204).send()
  })
}
