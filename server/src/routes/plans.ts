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
  // ORBAT establishment (#58). Optional so plans saved before templates
  // existed still load, and so fortifications -- which have no establishment
  // -- round-trip unchanged.
  templateId: z.string().optional(),
  strength: z.number().int().positive().optional(),
  visionRangeM: z.number().positive().optional(),
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

/** A plan update never moves a plan to different ground, so battlegroundId is
 *  deliberately absent -- the terrain a plan was drawn on is immutable. */
const updatePlanBody = z.object({
  name: z.string().trim().min(1).max(120),
  units: z.array(placedUnitSchema),
  objectives: z.array(placedObjectiveSchema),
  routes: z.array(placedRouteSchema),
})

/** Rename touches nothing but the title, so the drawing needn't be re-sent. */
const renamePlanBody = z.object({ name: z.string().trim().min(1).max(120) })

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

  /** Forks a plan onto the same ground under a new name. Terrain is shared by
   *  reference -- battlegrounds are immutable once written, so the copy points
   *  at the same row rather than duplicating a megabyte of grid. */
  app.post<{ Params: { id: string } }>('/api/plans/:id/duplicate', async (req, reply) => {
    const rows = await db.select().from(plans).where(eq(plans.id, req.params.id)).limit(1)
    const source = rows[0]
    if (!source) return reply.status(404).send({ error: 'unknown plan' })

    const id = randomUUID()
    await db.insert(plans).values({
      id,
      battlegroundId: source.battlegroundId,
      name: `${source.name} (copy)`.slice(0, 120),
      units: source.units,
      objectives: source.objectives,
      routes: source.routes,
    })
    return reply.status(201).send({ id })
  })

  app.get('/api/plans', async () => {
    const rows = await db
      .select({
        id: plans.id,
        name: plans.name,
        battlegroundName: battlegrounds.name,
        createdAt: plans.createdAt,
        updatedAt: plans.updatedAt,
      })
      .from(plans)
      .innerJoin(battlegrounds, eq(plans.battlegroundId, battlegrounds.id))
      .orderBy(desc(plans.updatedAt))
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

  /** Overwrites a plan's drawing in place. The client tracks the id it loaded
   *  or last saved, so re-saving updates that row instead of accumulating a new
   *  one per save (which is what POST /api/plans did on its own). */
  app.put<{ Params: { id: string } }>('/api/plans/:id', async (req, reply) => {
    const parsed = updatePlanBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid body' })
    }
    const { name, units, objectives, routes } = parsed.data

    const updated = await db
      .update(plans)
      .set({ name, units, objectives, routes, updatedAt: new Date() })
      .where(eq(plans.id, req.params.id))
      .returning({ id: plans.id })

    if (updated.length === 0) return reply.status(404).send({ error: 'unknown plan' })
    return { id: updated[0].id }
  })

  app.patch<{ Params: { id: string } }>('/api/plans/:id/name', async (req, reply) => {
    const parsed = renamePlanBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid body' })
    }

    const updated = await db
      .update(plans)
      .set({ name: parsed.data.name, updatedAt: new Date() })
      .where(eq(plans.id, req.params.id))
      .returning({ id: plans.id })

    if (updated.length === 0) return reply.status(404).send({ error: 'unknown plan' })
    return { id: updated[0].id }
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
