import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { config } from './config'
import { bboxExtentMeters } from './lib/geo'
import { unpackGrid } from './services/grid'
import { getJob, startPipeline, type ProgressListener } from './services/pipeline'
import { runDangerFieldInPool } from './workers/pool'
import type { BattlegroundJob, GridChannels } from './types'

const battlegroundBody = z
  .object({
    west: z.number().gte(-180).lte(180),
    south: z.number().gte(-85).lte(85),
    east: z.number().gte(-180).lte(180),
    north: z.number().gte(-85).lte(85),
    name: z.string().trim().min(1).max(80).default('Untitled Battleground'),
  })
  .refine((b) => b.west < b.east && b.south < b.north, {
    message: 'bbox must have west < east and south < north',
  })

const dangerBody = z.object({
  observers: z
    .array(
      z.object({
        longitude: z.number().gte(-180).lte(180),
        latitude: z.number().gte(-85).lte(85),
        eyeHeightM: z.number().gt(0).lte(100).optional(),
      }),
    )
    .min(1)
    .max(config.dangerMaxObservers),
  maxRangeM: z.number().gt(0).lte(10_000).optional(),
})

/** Grid channels unpacked lazily per job and memoized — danger requests repeat
 *  every time red-force positions move, the 800 KB decode shouldn't. */
const channelsCache = new WeakMap<BattlegroundJob, GridChannels>()

function channelsFor(job: BattlegroundJob): GridChannels | null {
  if (!job.gridBuffer) return null
  let channels = channelsCache.get(job)
  if (!channels) {
    channels = unpackGrid(job.gridBuffer).channels
    channelsCache.set(job, channels)
  }
  return channels
}

export function registerRoutes(app: FastifyInstance, onProgress: ProgressListener): void {
  app.get('/api/health', async () => ({ ok: true }))

  app.post('/api/battleground', async (req, reply) => {
    const parsed = battlegroundBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid body' })
    }
    const { name, ...bbox } = parsed.data
    const { widthM, heightM } = bboxExtentMeters(bbox)
    if (Math.max(widthM, heightM) > config.maxExtentMeters) {
      return reply
        .status(400)
        .send({ error: `selection exceeds ${config.maxExtentMeters / 1000} km limit` })
    }
    const job = startPipeline(bbox, name, onProgress)
    return reply.status(202).send({ id: job.id, status: job.status })
  })

  app.get<{ Params: { id: string } }>('/api/battleground/:id/meta', async (req, reply) => {
    const job = getJob(req.params.id)
    if (!job) return reply.status(404).send({ error: 'unknown battleground' })
    if (job.status === 'error') return reply.status(500).send({ error: job.error })
    if (job.status !== 'ready' || !job.meta) return reply.status(409).send({ error: 'not ready' })
    return { meta: job.meta, features: job.features }
  })

  app.get<{ Params: { id: string } }>('/api/battleground/:id/grid', async (req, reply) => {
    const job = getJob(req.params.id)
    if (!job) return reply.status(404).send({ error: 'unknown battleground' })
    if (job.status !== 'ready' || !job.gridBuffer) return reply.status(409).send({ error: 'not ready' })
    return reply.header('Content-Type', 'application/octet-stream').send(job.gridBuffer)
  })

  /** Cumulative enemy viewshed over the battleground grid: for each cell, the
   *  share (0-100) of the supplied observers that can see a standing soldier
   *  there. Returns a Uint8 raster the size of the grid. */
  app.post<{ Params: { id: string } }>('/api/battleground/:id/danger', async (req, reply) => {
    const job = getJob(req.params.id)
    if (!job) return reply.status(404).send({ error: 'unknown battleground' })
    if (job.status !== 'ready' || !job.meta) return reply.status(409).send({ error: 'not ready' })
    const channels = channelsFor(job)
    if (!channels) return reply.status(409).send({ error: 'not ready' })

    const parsed = dangerBody.safeParse(req.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid body' })
    }

    const { bbox, width, height, cellMeters } = job.meta
    const observers = parsed.data.observers
      .filter(
        (o) =>
          o.longitude >= bbox.west &&
          o.longitude <= bbox.east &&
          o.latitude >= bbox.south &&
          o.latitude <= bbox.north,
      )
      .map((o) => ({
        col: Math.floor(((o.longitude - bbox.west) / (bbox.east - bbox.west)) * width),
        row: Math.floor(((bbox.north - o.latitude) / (bbox.north - bbox.south)) * height),
        eyeHeightM: o.eyeHeightM,
      }))
    if (observers.length === 0) {
      return reply.status(400).send({ error: 'no observers inside the battleground bbox' })
    }

    const danger = await runDangerFieldInPool(
      { width, height, cellMeters, elevation: channels.height, cls: channels.cls },
      observers,
      { maxRangeM: parsed.data.maxRangeM },
    )
    return reply.header('Content-Type', 'application/octet-stream').send(Buffer.from(danger))
  })
}
