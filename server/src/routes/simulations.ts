import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { config } from '../config'
import { db } from '../db/client'
import { plans } from '../db/schema'

/**
 * Bridge to the Athena simulation engine.
 *
 * The engine authenticates with a shared bearer token and has no user model, so
 * it is never reachable from the browser. This service holds the token, submits
 * batches on the operator's behalf, and relays the engine's event stream back.
 *
 * Scenarios are submitted as a plan id, not an uploaded payload: the engine
 * pulls the plan straight from `GET /api/plans/:id` here, so there is one
 * representation of a battleground rather than two that can disagree.
 */

const runBody = z.object({
  simulationCount: z.number().int().positive().max(500).default(100),
  ticks: z.number().int().positive().max(2000).default(60),
  /** OpenRouter model id; the engine picks its own default when absent. */
  model: z.string().trim().min(1).optional(),
})

interface SubmitBatchResponse {
  batchId: string
  simulationCount: number
  eventsUrl: string
}

function engineUnconfigured(): string | null {
  if (!config.engineUrl) return 'ENGINE_URL is not set'
  if (!config.engineToken) return 'ENGINE_API_TOKEN is not set'
  return null
}

const authorization = () => ({ Authorization: `Bearer ${config.engineToken}` })

export function registerSimulationRoutes(app: FastifyInstance): void {
  /** Which engine features are usable. Booleans only — never the token. */
  app.get('/api/simulations/status', async () => ({
    configured: engineUnconfigured() === null,
    engineUrl: config.engineUrl || null,
  }))

  /** Queues a Monte Carlo batch over a saved plan. Returns as soon as the
   *  engine accepts it; results arrive on the event stream below. */
  app.post<{ Params: { id: string } }>('/api/plans/:id/simulate', async (req, reply) => {
    const missing = engineUnconfigured()
    if (missing) return reply.status(503).send({ error: missing })

    const parsed = runBody.safeParse(req.body ?? {})
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid body' })
    }

    // Fail here rather than letting the engine discover a missing plan
    // asynchronously, one worker at a time, after the batch is already queued.
    const rows = await db
      .select({ id: plans.id })
      .from(plans)
      .where(eq(plans.id, req.params.id))
      .limit(1)
    if (rows.length === 0) return reply.status(404).send({ error: 'unknown plan' })

    const form = new FormData()
    form.append('planId', req.params.id)
    form.append('simulationCount', String(parsed.data.simulationCount))
    form.append('ticks', String(parsed.data.ticks))
    if (parsed.data.model) form.append('model', parsed.data.model)

    let res: Response
    try {
      res = await fetch(`${config.engineUrl}/v1/simulation-batches`, {
        method: 'POST',
        headers: authorization(),
        body: form,
        signal: AbortSignal.timeout(config.engineTimeoutMs),
      })
    } catch (error: unknown) {
      app.log.error({ error }, 'engine submit failed')
      return reply.status(502).send({ error: 'could not reach the simulation engine' })
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      app.log.error({ status: res.status, detail }, 'engine rejected the batch')
      // The engine's body can echo internal configuration, so don't forward it.
      return reply
        .status(res.status === 422 ? 422 : 502)
        .send({ error: `engine rejected the batch (HTTP ${res.status})` })
    }

    const body = (await res.json()) as SubmitBatchResponse
    return reply.status(202).send({
      batchId: body.batchId,
      simulationCount: body.simulationCount,
      eventsUrl: `/api/simulations/${body.batchId}/events`,
    })
  })

  /**
   * Relays the engine's server-sent events for a batch.
   *
   * A plain pipe rather than a parse-and-re-emit: the engine already assigns
   * event ids for resumption, and re-serialising would mean this service had to
   * understand every event type the engine will ever add. `Last-Event-ID` is
   * forwarded so a reconnecting browser resumes where it left off.
   */
  app.get<{ Params: { batchId: string } }>(
    '/api/simulations/:batchId/events',
    async (req, reply) => {
      const missing = engineUnconfigured()
      if (missing) return reply.status(503).send({ error: missing })

      const lastEventId = req.headers['last-event-id']
      let upstream: Response
      try {
        upstream = await fetch(
          `${config.engineUrl}/v1/simulation-batches/${req.params.batchId}/events`,
          {
            headers: {
              ...authorization(),
              Accept: 'text/event-stream',
              ...(typeof lastEventId === 'string' ? { 'Last-Event-ID': lastEventId } : {}),
            },
          },
        )
      } catch (error: unknown) {
        app.log.error({ error }, 'engine event stream failed')
        return reply.status(502).send({ error: 'could not reach the simulation engine' })
      }

      if (!upstream.ok || !upstream.body) {
        return reply
          .status(upstream.status === 404 ? 404 : 502)
          .send({ error: `engine stream unavailable (HTTP ${upstream.status})` })
      }

      // No timeout on this fetch: the stream is long-lived by design, and it
      // ends when the engine emits batch.completed or the client disconnects.
      return reply
        .header('Content-Type', 'text/event-stream')
        .header('Cache-Control', 'no-cache')
        .header('Connection', 'keep-alive')
        .header('X-Accel-Buffering', 'no')
        .send(upstream.body)
    },
  )
}
