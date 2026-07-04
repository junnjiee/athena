import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { config } from './config'
import { bboxExtentMeters } from './lib/geo'
import { getJob, startPipeline, type ProgressListener } from './services/pipeline'

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

  app.get<{ Params: { id: string } }>('/api/battleground/:id/grid', async (req, reply) => {
    const job = getJob(req.params.id)
    if (!job) return reply.status(404).send({ error: 'unknown battleground' })
    if (job.status !== 'ready' || !job.gridBuffer) return reply.status(409).send({ error: 'not ready' })
    return reply.header('Content-Type', 'application/octet-stream').send(job.gridBuffer)
  })
}
