import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { config } from './config'
import { bboxExtentMeters } from './lib/geo'
import { getJob, startPipeline, type ProgressListener } from './services/pipeline'
import { fetchForecast, type Forecast } from './services/forecast'
import { LruCache } from './lib/lru'

/** One forecast per battleground for the life of the process. Weather moves on
 *  the hour, and a planning session is shorter than that. */
const forecastCache = new LruCache<Forecast>(config.jobCacheSize)

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

  /** Hourly conditions plus sunrise/sunset over the battleground's own ground,
   *  for planning a mission window rather than a single instant (#57). Cached
   *  per job so scrubbing a timeline doesn't re-hit Open-Meteo. */
  app.get<{ Params: { id: string } }>('/api/battleground/:id/forecast', async (req, reply) => {
    const job = getJob(req.params.id)
    if (!job) return reply.status(404).send({ error: 'unknown battleground' })
    if (job.status !== 'ready' || !job.meta) return reply.status(409).send({ error: 'not ready' })

    const cached = forecastCache.get(job.meta.id)
    if (cached) return cached

    const { bbox } = job.meta
    const forecast = await fetchForecast((bbox.south + bbox.north) / 2, (bbox.west + bbox.east) / 2)
    if (!forecast) return reply.status(502).send({ error: 'forecast unavailable' })

    forecastCache.set(job.meta.id, forecast)
    return forecast
  })

  app.get<{ Params: { id: string } }>('/api/battleground/:id/grid', async (req, reply) => {
    const job = getJob(req.params.id)
    if (!job) return reply.status(404).send({ error: 'unknown battleground' })
    if (job.status !== 'ready' || !job.gridBuffer) return reply.status(409).send({ error: 'not ready' })
    return reply.header('Content-Type', 'application/octet-stream').send(job.gridBuffer)
  })
}
