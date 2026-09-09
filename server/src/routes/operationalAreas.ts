import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { config } from '../config'
import { bboxExtentMeters } from '../lib/geo'
import {
  getOperationalAreaJob,
  startOperationalAreaIngest,
  type ProgressListener,
} from '../services/operationalArea'
import {
  deleteOperationalArea,
  listOperationalAreas,
  loadOperationalArea,
  loadOperationalGraphBuffer,
  persistOperationalGraphRevision,
  updateOperationalRoadSettings,
} from '../services/operationalAreaStore'
import { addRoad, setRoadDestroyed } from '../services/graphMutations'

const areaBody = z
  .object({
    west: z.number().gte(-180).lte(180),
    south: z.number().gte(-85).lte(85),
    east: z.number().gte(-180).lte(180),
    north: z.number().gte(-85).lte(85),
    name: z.string().trim().min(1).max(80).default('Untitled Area'),
  })
  .refine((b) => b.west < b.east && b.south < b.north, {
    message: 'bbox must have west < east and south < north',
  })

const roadEdit = z.object({
  name: z.string().trim().min(1).max(40),
  width: z.union([z.literal(2), z.literal(4), z.literal(6)]),
  dual: z.boolean(),
  type: z.enum(['X', 'Y', 'Z']),
})

export const roadSettingsBody = z
  .object({
    roadTheme: z.enum(['raptors', 'big-cats', 'weather', 'trees']).optional(),
    roadEdits: z.record(roadEdit).optional(),
  })
  .refine((value) => value.roadTheme !== undefined || value.roadEdits !== undefined, {
    message: 'roadTheme or roadEdits is required',
  })

export const roadStateBody = z.object({ destroyed: z.boolean() })

export const addRoadBody = z.object({
  points: z
    .array(z.tuple([z.number().gte(-180).lte(180), z.number().gte(-85).lte(85)]))
    .min(2)
    .max(64),
  roadClass: z.enum([
    'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential',
    'unclassified', 'service', 'living_street', 'track',
  ]).default('unclassified'),
  roadEdit: roadEdit.optional(),
})

export function registerOperationalAreaRoutes(
  app: FastifyInstance,
  onProgress: ProgressListener,
): void {
  /** Starts an ingest. Returns immediately; progress arrives over Socket.IO on
   *  the job id, exactly as battleground generation does. */
  app.post(
    '/api/operational-area',
    {
      config: {
        rateLimit: {
          max: config.battlegroundRateLimit,
          timeWindow: config.battlegroundRateWindowMs,
        },
      },
    },
    async (req, reply) => {
      const parsed = areaBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid body' })
      }
      const { name, ...bbox } = parsed.data
      const { widthM, heightM } = bboxExtentMeters(bbox)
      if (Math.max(widthM, heightM) > config.operationalMaxExtentMeters) {
        return reply.status(400).send({
          error: `area exceeds ${config.operationalMaxExtentMeters / 1000} km limit`,
        })
      }
      const job = startOperationalAreaIngest(bbox, name, onProgress)
      return reply.status(202).send({ id: job.id, status: job.status })
    },
  )

  app.get('/api/operational-area', async () => listOperationalAreas())

  app.patch<{ Params: { id: string } }>('/api/operational-area/:id/roads', async (req, reply) => {
    const parsed = roadSettingsBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid body' })
    }
    const updated = await updateOperationalRoadSettings(req.params.id, parsed.data)
    if (!updated) return reply.status(404).send({ error: 'unknown operational area' })
    return { meta: updated }
  })

  app.patch<{ Params: { id: string; wayId: string } }>(
    '/api/operational-area/:id/graph/roads/:wayId',
    async (req, reply) => {
      const parsed = roadStateBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid body' })
      }
      const wayId = Number(req.params.wayId)
      if (!Number.isSafeInteger(wayId)) {
        return reply.status(400).send({ error: 'wayId must be an integer' })
      }

      const stored = await loadOperationalArea(req.params.id)
      if (!stored) return reply.status(404).send({ error: 'unknown operational area' })
      const mutation = setRoadDestroyed(stored.graph, wayId, parsed.data.destroyed)
      if (!mutation.found) return reply.status(404).send({ error: 'unknown road' })
      if (!mutation.changed) return { meta: stored.meta, changed: false }

      const meta = await persistOperationalGraphRevision(
        req.params.id,
        stored.meta.currentRevision,
        mutation.graph,
      )
      if (!meta) {
        return reply.status(409).send({ error: 'road graph changed; reload and retry' })
      }
      return { meta, changed: true }
    },
  )

  app.post<{ Params: { id: string } }>(
    '/api/operational-area/:id/graph/roads',
    async (req, reply) => {
      const parsed = addRoadBody.safeParse(req.body)
      if (!parsed.success) {
        return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid body' })
      }
      const stored = await loadOperationalArea(req.params.id)
      if (!stored) return reply.status(404).send({ error: 'unknown operational area' })
      const outside = parsed.data.points.some(
        ([lon, lat]) =>
          lon < stored.meta.bbox.west || lon > stored.meta.bbox.east ||
          lat < stored.meta.bbox.south || lat > stored.meta.bbox.north,
      )
      if (outside) return reply.status(400).send({ error: 'road points must stay inside the AO' })

      const mutation = addRoad(stored.graph, parsed.data.points, parsed.data.roadClass)
      if (!mutation.ok) return reply.status(400).send({ error: mutation.reason })
      const roadEdits = parsed.data.roadEdit
        ? { ...stored.meta.roadEdits, [String(mutation.wayId)]: parsed.data.roadEdit }
        : stored.meta.roadEdits
      const meta = await persistOperationalGraphRevision(
        req.params.id,
        stored.meta.currentRevision,
        mutation.graph,
        roadEdits,
      )
      if (!meta) {
        return reply.status(409).send({ error: 'road graph changed; reload and retry' })
      }
      return reply.status(201).send({ meta, wayId: mutation.wayId })
    },
  )

  /** Live job first, falling back to the stored row, so an area survives the
   *  process that built it. */
  app.get<{ Params: { id: string } }>('/api/operational-area/:id', async (req, reply) => {
    const job = getOperationalAreaJob(req.params.id)
    if (job) {
      if (job.status === 'error') return reply.status(500).send({ error: job.error })
      if (job.status !== 'ready' || !job.meta) {
        return reply.status(409).send({ error: 'not ready' })
      }
      return { meta: job.meta }
    }

    const stored = await loadOperationalArea(req.params.id)
    if (!stored) return reply.status(404).send({ error: 'unknown operational area' })
    return { meta: stored.meta }
  })

  /** The engine's input. Served as the stored gzip bytes rather than re-encoded
   *  JSON: the engine pulls this on every study, and inflating a graph here
   *  only to have it recompressed on the wire is pure waste. */
  app.get<{ Params: { id: string }; Querystring: { revision?: string } }>(
    '/api/operational-area/:id/graph',
    async (req, reply) => {
      const revision = req.query.revision === undefined ? undefined : Number(req.query.revision)
      if (revision !== undefined && (!Number.isInteger(revision) || revision < 1)) {
        return reply.status(400).send({ error: 'revision must be a positive integer' })
      }
      const packed = await loadOperationalGraphBuffer(req.params.id, revision)
      if (packed) {
        return reply.header('Content-Type', 'application/gzip').send(packed)
      }

      // Not yet persisted, but possibly still in the job that built it.
      const job = getOperationalAreaJob(req.params.id)
      if (!job) return reply.status(404).send({ error: 'unknown operational area or revision' })
      if (job.status === 'error') return reply.status(500).send({ error: job.error })
      return reply.status(409).send({ error: 'not ready' })
    },
  )

  /** Drops the area and the studies routed over it. The count comes back so
   *  the client can say what it cost rather than guessing from a stale list. */
  app.delete<{ Params: { id: string } }>('/api/operational-area/:id', async (req, reply) => {
    const result = await deleteOperationalArea(req.params.id)
    if (!result) return reply.status(404).send({ error: 'unknown operational area' })
    return result
  })
}
