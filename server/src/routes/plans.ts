import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client'
import { battlegrounds, plans } from '../db/schema'
import { getJob } from '../services/pipeline'
import { buildPlanBrief } from '../services/planBrief'

const lonLat = z.object({ longitude: z.number(), latitude: z.number() })

const placedUnitSchema = z.object({
  id: z.string(),
  side: z.enum(['blue', 'red']),
  name: z.string(),
  typeLabel: z.string(),
  position: lonLat,
  symbolKind: z.enum(['blueSection', 'bluePlatoon', 'redSection', 'redPlatoon', 'trench', 'preparedTrench']),
  rotationRadians: z.number(),
})

const placedObjectiveSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  position: lonLat,
  radiusMeters: z.number(),
})

const routeEndRefSchema = z
  .object({ kind: z.enum(['unit', 'objective']), id: z.string() })
  .nullable()

const movementLoadoutSchema = z.object({
  bodyMassKg: z.number(),
  loadMassKg: z.number(),
  preset: z.enum(['light', 'fighting', 'approach', 'custom']),
})

const placedRouteSchema = z.object({
  id: z.string(),
  side: z.enum(['blue', 'red']),
  startUnitId: z.string(),
  points: z.array(lonLat),
  endRef: routeEndRefSchema,
  movementType: z.enum(['prowl', 'patrol', 'charge']),
  loadout: movementLoadoutSchema,
})

const savePlanBody = z.object({
  battlegroundId: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  units: z.array(placedUnitSchema),
  objectives: z.array(placedObjectiveSchema),
  routes: z.array(placedRouteSchema),
})

export function registerPlanRoutes(app: FastifyInstance): void {
  app.post('/api/plans', async (req, reply) => {
    const parsed = savePlanBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid body' })
    }
    const { battlegroundId, name, units, objectives, routes } = parsed.data

    // The client never re-uploads the terrain -- read it straight from the
    // pipeline's in-memory job cache (still there from generation this session).
    const job = getJob(battlegroundId)
    if (!job || job.status !== 'ready' || !job.meta || !job.gridBuffer || !job.features) {
      return reply
        .status(409)
        .send({ error: 'battleground no longer available server-side; re-run terrain generation' })
    }

    await db
      .insert(battlegrounds)
      .values({
        id: job.meta.id,
        name: job.meta.name,
        bbox: job.meta.bbox,
        width: job.meta.width,
        height: job.meta.height,
        cellMeters: job.meta.cellMeters,
        generatedAt: job.meta.generatedAt,
        weather: job.meta.weather,
        featureCounts: job.meta.featureCounts,
        segmentation: job.meta.segmentation ?? null,
        gridBuffer: job.gridBuffer,
        features: job.features,
      })
      .onConflictDoNothing({ target: battlegrounds.id })

    const planId = randomUUID()
    await db.insert(plans).values({
      id: planId,
      battlegroundId: job.meta.id,
      name,
      units,
      objectives,
      routes,
    })

    return reply.status(201).send({ id: planId })
  })

  app.get('/api/plans', async () => {
    const rows = await db
      .select({
        id: plans.id,
        name: plans.name,
        battlegroundName: battlegrounds.name,
        createdAt: plans.createdAt,
      })
      .from(plans)
      .innerJoin(battlegrounds, eq(plans.battlegroundId, battlegrounds.id))
      .orderBy(desc(plans.createdAt))
    return rows
  })

  app.get<{ Params: { id: string } }>('/api/plans/:id', async (req, reply) => {
    const rows = await db
      .select({ plan: plans, battleground: battlegrounds })
      .from(plans)
      .innerJoin(battlegrounds, eq(plans.battlegroundId, battlegrounds.id))
      .where(eq(plans.id, req.params.id))
      .limit(1)
    const row = rows[0]
    if (!row) return reply.status(404).send({ error: 'unknown plan' })

    return {
      plan: {
        id: row.plan.id,
        name: row.plan.name,
        units: row.plan.units,
        objectives: row.plan.objectives,
        routes: row.plan.routes,
      },
      battleground: {
        meta: {
          id: row.battleground.id,
          name: row.battleground.name,
          bbox: row.battleground.bbox,
          width: row.battleground.width,
          height: row.battleground.height,
          cellMeters: row.battleground.cellMeters,
          generatedAt: row.battleground.generatedAt,
          weather: row.battleground.weather,
          featureCounts: row.battleground.featureCounts,
          segmentation: row.battleground.segmentation,
        },
        features: row.battleground.features,
        gridBufferBase64: row.battleground.gridBuffer.toString('base64'),
      },
    }
  })

  /** The drawn plan expressed over the terrain: every unit/objective/route
   *  georeferenced onto simulation-grid cells and tagged with what kind of
   *  drawing it is. This is the payload the simulation engine consumes -- it
   *  never has to do lon/lat math or guess at a marker's intent. */
  app.get<{ Params: { id: string } }>('/api/plans/:id/brief', async (req, reply) => {
    const rows = await db
      .select({ plan: plans, battleground: battlegrounds })
      .from(plans)
      .innerJoin(battlegrounds, eq(plans.battlegroundId, battlegrounds.id))
      .where(eq(plans.id, req.params.id))
      .limit(1)
    const row = rows[0]
    if (!row) return reply.status(404).send({ error: 'unknown plan' })

    return buildPlanBrief({
      plan: {
        id: row.plan.id,
        name: row.plan.name,
        units: row.plan.units,
        objectives: row.plan.objectives,
        routes: row.plan.routes,
      },
      battleground: {
        id: row.battleground.id,
        name: row.battleground.name,
        bbox: row.battleground.bbox,
        width: row.battleground.width,
        height: row.battleground.height,
        cellMeters: row.battleground.cellMeters,
        weather: row.battleground.weather,
        gridBuffer: row.battleground.gridBuffer,
      },
    })
  })

  app.delete<{ Params: { id: string } }>('/api/plans/:id', async (req, reply) => {
    const deleted = await db.delete(plans).where(eq(plans.id, req.params.id)).returning({ id: plans.id })
    if (deleted.length === 0) return reply.status(404).send({ error: 'unknown plan' })
    return reply.status(204).send()
  })
}
