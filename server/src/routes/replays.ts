import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db/client'
import { battlegrounds, simulationRuns } from '../db/schema'
import { getJob } from '../services/pipeline'

const positionSchema = z.object({ x: z.number().int(), y: z.number().int(), z: z.number().int() })
const teamSchema = z.enum(['blue', 'red'])

const battlefieldSchema = z
  .object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    surface: z.array(positionSchema),
    terrain_classes: z.array(z.number().int().min(0).max(9)),
    communication_groups: z.array(
      z.object({
        group_id: z.string(),
        name: z.string(),
        team: teamSchema,
        member_indices: z.array(z.number().int()),
      }),
    ),
  })
  .refine((b) => b.surface.length === b.width * b.height, { message: 'surface length must equal width*height' })
  .refine((b) => b.terrain_classes.length === b.width * b.height, {
    message: 'terrain_classes length must equal width*height',
  })

const stepSchema = z.object({
  step: z.number().int().nonnegative(),
  soldiers: z.array(
    z.object({
      soldier_index: z.number().int(),
      team: teamSchema,
      position: positionSchema,
      survival_status: z.enum(['alive', 'casualty', 'dead']),
    }),
  ),
  shots: z.array(
    z.object({
      shooter_index: z.number().int(),
      target_index: z.number().int(),
      shooter_position: positionSchema,
      target_position: positionSchema,
      hit: z.boolean(),
    }),
  ),
  messages: z.array(z.object({ sender_index: z.number().int(), group_id: z.string(), content: z.string() })),
})

/** Guards against the stale schema_version 2 shape (separate cover/concealment
 *  position lists) reaching storage at all -- a v2 file fails validation here
 *  with a clear 400 instead of silently misrendering downstream. */
const replayLogSchema = z.object({
  schema_version: z.literal(3),
  battlefield: battlefieldSchema,
  steps: z.array(stepSchema).min(1),
})

const importReplayBody = z.object({
  battlegroundId: z.string().min(1),
  name: z.string().trim().min(1).max(120),
  replay: replayLogSchema,
})

export function registerReplayRoutes(app: FastifyInstance): void {
  app.post('/api/replays', async (req, reply) => {
    const parsed = importReplayBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid body' })
    }
    const { battlegroundId, name, replay } = parsed.data

    const rows = await db.select().from(battlegrounds).where(eq(battlegrounds.id, battlegroundId)).limit(1)
    let battleground = rows[0]

    if (!battleground) {
      // A battleground only gets a DB row once a plan is saved against it
      // (routes/plans.ts) -- importing a replay right after generating, with
      // no plan saved yet, would otherwise 404 even though the terrain is
      // right there in the pipeline's job cache. Upsert it the same way
      // plans.ts does when saving a plan.
      const job = getJob(battlegroundId)
      if (!job || job.status !== 'ready' || !job.meta || !job.gridBuffer || !job.features) {
        return reply.status(404).send({ error: 'unknown battleground' })
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
      const refetched = await db.select().from(battlegrounds).where(eq(battlegrounds.id, battlegroundId)).limit(1)
      battleground = refetched[0]
      if (!battleground) return reply.status(404).send({ error: 'unknown battleground' })
    }

    if (replay.battlefield.width !== battleground.width || replay.battlefield.height !== battleground.height) {
      return reply.status(409).send({
        error: `replay battlefield is ${replay.battlefield.width}x${replay.battlefield.height}, but the battleground grid is ${battleground.width}x${battleground.height}`,
      })
    }

    const id = randomUUID()
    await db.insert(simulationRuns).values({
      id,
      battlegroundId,
      name,
      stepCount: replay.steps.length,
      soldierCount: replay.steps[0]?.soldiers.length ?? 0,
      replayLog: replay,
    })

    return reply.status(201).send({ id })
  })

  app.get('/api/replays', async () => {
    const rows = await db
      .select({
        id: simulationRuns.id,
        name: simulationRuns.name,
        battlegroundId: simulationRuns.battlegroundId,
        battlegroundName: battlegrounds.name,
        stepCount: simulationRuns.stepCount,
        soldierCount: simulationRuns.soldierCount,
        createdAt: simulationRuns.createdAt,
      })
      .from(simulationRuns)
      .innerJoin(battlegrounds, eq(simulationRuns.battlegroundId, battlegrounds.id))
      .orderBy(desc(simulationRuns.createdAt))
    return rows
  })

  app.get<{ Params: { id: string } }>('/api/replays/:id', async (req, reply) => {
    const rows = await db
      .select({ run: simulationRuns, battleground: battlegrounds })
      .from(simulationRuns)
      .innerJoin(battlegrounds, eq(simulationRuns.battlegroundId, battlegrounds.id))
      .where(eq(simulationRuns.id, req.params.id))
      .limit(1)
    const row = rows[0]
    if (!row) return reply.status(404).send({ error: 'unknown replay' })

    return {
      run: { id: row.run.id, name: row.run.name, createdAt: row.run.createdAt },
      replay: row.run.replayLog,
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
    }
  })

  app.delete<{ Params: { id: string } }>('/api/replays/:id', async (req, reply) => {
    const deleted = await db
      .delete(simulationRuns)
      .where(eq(simulationRuns.id, req.params.id))
      .returning({ id: simulationRuns.id })
    if (deleted.length === 0) return reply.status(404).send({ error: 'unknown replay' })
    return reply.status(204).send()
  })
}
