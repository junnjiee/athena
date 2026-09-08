import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { db } from '../db/client'
import { routeStudies } from '../db/schema'
import type { CorridorEdit, Orbat, StudyMarks } from '../db/studyTypes'
import { EngineUnavailableError, runBlockForces, runRouteStudy } from '../services/engineClient'

const markSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  lon: z.number().gte(-180).lte(180),
  lat: z.number().gte(-85).lte(85),
})

const marksSchema = z.object({
  reserves: z.array(markSchema).min(1),
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

/** Whether an edit changes what the engine would find.
 *
 *  Only the ground and the marks do. Renaming, categorising, splitting or
 *  merging corridors are presentation over a result that has not changed, and
 *  re-running the search for a typed name would churn corridor identity for
 *  nothing -- which is exactly what the operator's edits are keyed on. */
export function needsResearch(
  current: { marks: StudyMarks; edgeOverrides: string[] },
  next: { marks?: StudyMarks; edgeOverrides?: string[] },
): boolean {
  if (next.marks && JSON.stringify(next.marks) !== JSON.stringify(current.marks)) return true
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

    let result
    try {
      result = await runRouteStudy({ areaId, marks, excludedEdgeIds: edgeOverrides })
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
      marks,
      edgeOverrides,
      result,
      corridorEdits: {},
    })
    return reply.status(201).send({ id, name, areaId, result, corridorEdits: {} })
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
    return {
      id: row.id,
      areaId: row.areaId,
      name: row.name,
      marks: row.marks,
      edgeOverrides: row.edgeOverrides,
      result: row.result,
      corridorEdits: row.corridorEdits,
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

    const marks = parsed.data.marks ?? row.marks
    const edgeOverrides = parsed.data.edgeOverrides ?? row.edgeOverrides
    const corridorEdits: Record<string, CorridorEdit> =
      parsed.data.corridorEdits ?? row.corridorEdits

    let result = row.result
    if (needsResearch(row, parsed.data)) {
      try {
        result = await runRouteStudy({ areaId: row.areaId, marks, excludedEdgeIds: edgeOverrides })
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
        corridorEdits,
        updatedAt: new Date(),
      })
      .where(eq(routeStudies.id, req.params.id))

    return {
      id: row.id,
      areaId: row.areaId,
      name: parsed.data.name ?? row.name,
      marks,
      edgeOverrides,
      result,
      corridorEdits,
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

  app.delete<{ Params: { id: string } }>('/api/route-study/:id', async (req, reply) => {
    await db.delete(routeStudies).where(eq(routeStudies.id, req.params.id))
    return reply.status(204).send()
  })
}
