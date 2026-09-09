import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../db/client'
import { courseFeedback, rankingWeights, routeStudies } from '../db/schema'
import type {
  CorridorEdit,
  EnemyIntent,
  Orbat,
  RankingWeights,
  StudyMarks,
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

const markSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  lon: z.number().gte(-180).lte(180),
  lat: z.number().gte(-85).lte(85),
  /** Present when an objective was dragged as ground rather than clicked as a
   *  point. lon/lat stays the centre, so the engine is none the wiser. */
  bbox: z
    .object({
      west: z.number().gte(-180).lte(180),
      south: z.number().gte(-85).lte(85),
      east: z.number().gte(-180).lte(180),
      north: z.number().gte(-85).lte(85),
    })
    .optional(),
})

export const reserveMarkSchema = markSchema.extend({
  level: z.enum(['K', 'K1', 'K2', 'K3', 'K4']).optional(),
  owning_formation: z.string().trim().min(1).max(80).optional(),
  /** Confirmed is an operator assertion backed by the two-source rule. New and
   *  legacy reserve marks therefore enter as assessed unless explicitly set. */
  intelligence_status: z.enum(['assessed', 'confirmed']).default('assessed'),
  locality: z.string().trim().min(1).max(120).optional(),
})

const marksSchema = z.object({
  reserves: z.array(reserveMarkSchema).min(1),
  objectives: z.array(markSchema).min(1),
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
  corridorEdits: z.record(z.object({ name: z.string().max(80).optional(), category: z.string().max(40).optional() })).optional(),
})


const echelonSchema = z.enum(['company', 'platoon', 'section', 'group'])

const orbatSchema = z.object({
  units: z.array(
    z.object({
      unit_id: z.string().min(1),
      name: z.string().trim().min(1).max(80),
      echelon: echelonSchema,
      parent_id: z.string().min(1).nullish(),
      lon: z.number().gte(-180).lte(180),
      lat: z.number().gte(-85).lte(85),
      strength: z.number().int().positive(),
      availability: z.enum(['uncommitted', 'committed', 'reserve']).default('uncommitted'),
    }),
  ),
})

export const blockForcesBody = z.object({
  orbat: orbatSchema,
  /** Largest formation the operator will commit to any one corridor. */
  ceiling: echelonSchema,
})


export const enemyCoursesBody = z.object({
  intent: z.object({
    objective_ids: z.array(z.string()).default([]),
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
    // graph search only sees mark identity and position. Saving an assessment
    // must not churn corridor identities when no pin moved.
    const routingMarks = (marks: StudyMarks) => ({
      reserves: marks.reserves.map(({ id, lon, lat }) => ({ id, lon, lat })),
      objectives: marks.objectives.map(({ id, lon, lat }) => ({ id, lon, lat })),
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
      ceiling: row.ceiling,
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
    const corridorEdits: Record<string, CorridorEdit> =
      parsed.data.corridorEdits ?? row.corridorEdits

    let result = row.result
    const research = needsResearch(row, parsed.data, currentGraphRevision)
    if (research) {
      try {
        result = await runRouteStudy({
          areaId: row.areaId,
          graphRevision: currentGraphRevision,
          marks,
          excludedEdgeIds: edgeOverrides,
        })
      } catch (error: unknown) {
        if (error instanceof EngineUnavailableError) {
          return reply.status(503).send({ error: error.message })
        }
        throw error
      }
    }

    await db
      .update(routeStudies)
      .set({
        name: parsed.data.name ?? row.name,
        marks,
        edgeOverrides,
        result,
        graphRevision: research ? currentGraphRevision : row.graphRevision,
        corridorEdits,
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
      // Untouched by this route, and returned so a client that replaces its
      // study with the response does not lose an assessment or an allocation
      // to a rename.
      orbat: row.orbat,
      ceiling: row.ceiling,
      blockPlan: row.blockPlan,
      intent: row.intent,
      courses: row.courses,
    }
  })


  /** Runs the S3 pass over the corridors this study already found.
   *
   *  Kept off the study's own PUT because the ORBAT is a separate question from
   *  the ground: changing which force is available must not re-run the route
   *  search, and changing the ground must not silently invalidate an
   *  allocation the commander is reading. */
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
      const { ceiling } = parsed.data

      let blockPlan
      try {
        blockPlan = await runBlockForces({
          areaId: row.areaId,
          graphRevision: row.graphRevision,
          corridors: row.result.corridors,
          orbat,
          ceiling,
        })
      } catch (error: unknown) {
        if (error instanceof EngineUnavailableError) {
          return reply.status(503).send({ error: error.message })
        }
        throw error
      }

      await db
        .update(routeStudies)
        .set({ orbat, ceiling, blockPlan, updatedAt: new Date() })
        .where(eq(routeStudies.id, req.params.id))

      return { orbat, ceiling, blockPlan }
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

      let courses
      try {
        courses = await runEnemyCourses({
          corridors: row.result.corridors,
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
