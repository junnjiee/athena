import type { FastifyBaseLogger, FastifyInstance } from 'fastify'
import { Readable } from 'node:stream'
import { desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { summarizeRun, type ReplayLog, type RunResult } from '../services/replaySummary'
import { config } from '../config'
import { db } from '../db/client'
import { battlegrounds, plans, simulationBatches } from '../db/schema'
import {
  buildSimulationPayload,
  countAgents,
  countSoldiers,
  encodeSimulationPayload,
} from '../services/simulationPayload'

/**
 * Bridge to the Athena simulation engine.
 *
 * The engine authenticates with a shared bearer token and has no user model, so
 * it is never reachable from the browser. This service holds the token, submits
 * batches on the operator's behalf, and relays the engine's event stream back.
 *
 * Scenarios are uploaded as a payload rather than named by plan id. The engine
 * supports both, but the pull path can only carry what `GET /api/plans/:id`
 * returns — one entry per drawn marker — and a marker is an establishment, not a
 * soldier. Building the payload here is what lets a 21-man platoon reach the
 * engine as 21 agents (services/simulationPayload.ts). The terrain inside it is
 * decoded from the stored grid, so the battleground still has one source of
 * bytes; only the laydown is derived.
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
  /** Ground problems the engine found while validating the payload. */
  diagnostics?: ImportDiagnostics
}

function engineUnconfigured(): string | null {
  if (!config.engineUrl) return 'ENGINE_URL is not set'
  if (!config.engineToken) return 'ENGINE_API_TOKEN is not set'
  return null
}

const authorization = () => ({ Authorization: `Bearer ${config.engineToken}` })

/** Path the browser uses to pull a full replay back through this service. */
export function replayPath(replayUrl: string): string {
  return `/api/simulations/replay?url=${encodeURIComponent(replayUrl)}`
}

interface SseBlock {
  id?: string
  event?: string
  data: string
}

/** Parse one `\n\n`-terminated SSE block. Comment-only blocks (keep-alives)
 *  come back with no event and no data, and are forwarded verbatim. */
function parseBlock(raw: string): SseBlock {
  const block: SseBlock = { data: '' }
  const data: string[] = []
  for (const line of raw.split('\n')) {
    if (line.startsWith('id:')) block.id = line.slice(3).trim()
    else if (line.startsWith('event:')) block.event = line.slice(6).trim()
    else if (line.startsWith('data:')) data.push(line.slice(5).trim())
  }
  block.data = data.join('\n')
  return block
}

function formatBlock(block: SseBlock, data: unknown): string {
  return (
    (block.id === undefined ? '' : `id: ${block.id}\n`) +
    (block.event === undefined ? '' : `event: ${block.event}\n`) +
    `data: ${JSON.stringify(data)}\n\n`
  )
}

/** Ground and plan problems the engine found while validating the payload. */
interface ImportDiagnostics {
  cells: number
  unclimbableSteps: number
  /** Absent when that side drew no objective. False means the ground between
   *  the force and its objective is severed — a river with no crossing, a cliff
   *  line — so the plan is not slow, it is impossible. */
  blueObjectiveReachable?: boolean
  redObjectiveReachable?: boolean
}

interface EngineBatchSummary {
  batchId: string
  status: string
  completed: number
  failed: number
  completedAt: string | null
}

interface EngineBatchDetail {
  batchId: string
  simulationCount: number
  ticks: number
  model: string | null
  status: string
  createdAt: string
  completedAt: string | null
  runs: {
    simulationId: string
    simulationIndex: number
    status: string
    outcome: RunResult | null
    error: string | null
    replayUrl: string | null
  }[]
}

interface CompletedEvent {
  simulationId: string
  simulationIndex: number
  replayUrl: string
  /** The engine's own scoring, present since it started reporting outcomes on
   *  the completion event. Absent for a batch run by an older engine. */
  outcome?: RunResult
}

/**
 * The run's result, preferring the engine's own count over reading the replay.
 *
 * The engine knows who was left standing at the moment the run ends, so it now
 * says so on the completion event. Before that this had to fetch the replay to
 * find out — and a replay repeats the whole battlefield surface, ~17 MB on an
 * 800×800 ground, so a 100-run batch pulled ~1.7 GB from the bucket to produce
 * one win rate.
 *
 * The fetch stays as a fallback for batches queued by an engine that does not
 * report outcomes, and because a replay that cannot be read should be reported
 * as an unscored completion rather than dropped.
 */
async function summarizeCompleted(
  event: CompletedEvent,
  log: FastifyBaseLogger,
): Promise<Record<string, unknown>> {
  const base = {
    simulationId: event.simulationId,
    simulationIndex: event.simulationIndex,
    replayPath: replayPath(event.replayUrl),
  }

  if (event.outcome) return { ...base, summary: event.outcome }

  try {
    const res = await fetch(event.replayUrl, {
      signal: AbortSignal.timeout(config.engineTimeoutMs),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return { ...base, summary: summarizeRun((await res.json()) as ReplayLog) }
  } catch (error: unknown) {
    log.error({ error, simulationId: event.simulationId }, 'could not summarise replay')
    return {
      ...base,
      summary: null,
      summaryError: error instanceof Error ? error.message : 'replay unavailable',
    }
  }
}

/** Rewrite `simulation.completed` blocks to carry a summary; forward the rest.
 *  Exported for tests: `inject` cannot drive a multi-chunk streaming response,
 *  and this transform is where the logic lives. */
export async function* summarizeStream(
  body: ReadableStream<Uint8Array>,
  log: FastifyBaseLogger,
): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const transform = async (raw: string): Promise<string> => {
    const block = parseBlock(raw)
    if (block.event !== 'simulation.completed' || block.data === '') return raw
    try {
      const event = JSON.parse(block.data) as CompletedEvent
      return formatBlock(block, await summarizeCompleted(event, log))
    } catch (error: unknown) {
      // An event we cannot parse is the engine's to define, not ours to drop.
      log.error({ error }, 'unparseable simulation.completed event, forwarding as-is')
      return raw
    }
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    let boundary = buffer.indexOf('\n\n')
    while (boundary !== -1) {
      const raw = buffer.slice(0, boundary + 2)
      buffer = buffer.slice(boundary + 2)
      yield await transform(raw)
      boundary = buffer.indexOf('\n\n')
    }
  }

  if (buffer !== '') yield buffer
}

export function registerSimulationRoutes(app: FastifyInstance): void {
  /** Which engine features are usable. Booleans only — never the token. */
  app.get('/api/simulations/status', async () => ({
    configured: engineUnconfigured() === null,
    engineUrl: config.engineUrl || null,
  }))

  /**
   * Checks a plan against its ground without queueing anything.
   *
   * The run dialog calls this when it opens, so an impossible plan is refused
   * before it costs a batch rather than after. An objective on the far side of
   * a river with no crossing is the case that matters: it runs, the force walks
   * to the bank, and the answer comes back "inconclusive" — which reads exactly
   * like a plan that was merely too slow.
   */
  app.post<{ Params: { id: string } }>('/api/plans/:id/diagnostics', async (req, reply) => {
    const missing = engineUnconfigured()
    if (missing) return reply.status(503).send({ error: missing })

    const rows = await db
      .select({ plan: plans, battleground: battlegrounds })
      .from(plans)
      .innerJoin(battlegrounds, eq(plans.battlegroundId, battlegrounds.id))
      .where(eq(plans.id, req.params.id))
      .limit(1)
    const row = rows[0]
    if (!row) return reply.status(404).send({ error: 'unknown plan' })
    if (countSoldiers(row.plan.units) === 0) return { cells: 0, unclimbableSteps: 0 }

    const payload = encodeSimulationPayload(
      buildSimulationPayload({
        battleground: {
          bbox: row.battleground.bbox,
          gridBuffer: row.battleground.gridBuffer,
          isDay: row.battleground.weather?.isDay ?? null,
        },
        plan: {
          units: row.plan.units,
          objectives: row.plan.objectives,
          routes: row.plan.routes,
        },
      }),
    )

    const form = new FormData()
    form.append(
      'payload',
      new Blob([new Uint8Array(payload)], { type: 'application/gzip' }),
      'payload.json.gz',
    )

    try {
      const res = await fetch(`${config.engineUrl}/v1/payload-diagnostics`, {
        method: 'POST',
        headers: authorization(),
        body: form,
        signal: AbortSignal.timeout(config.engineTimeoutMs),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return (await res.json()) as ImportDiagnostics
    } catch (error: unknown) {
      app.log.error({ error }, 'engine diagnostics failed')
      return reply.status(502).send({ error: 'could not reach the simulation engine' })
    }
  })

  /** Queues a Monte Carlo batch over a saved plan. Returns as soon as the
   *  engine accepts it; results arrive on the event stream below. */
  app.post<{ Params: { id: string } }>('/api/plans/:id/simulate', async (req, reply) => {
    const missing = engineUnconfigured()
    if (missing) return reply.status(503).send({ error: missing })

    const parsed = runBody.safeParse(req.body ?? {})
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.issues[0]?.message ?? 'invalid body' })
    }

    // Read the plan and its ground here rather than letting the engine discover
    // a missing plan asynchronously, one worker at a time, after the batch is
    // already queued.
    const rows = await db
      .select({ plan: plans, battleground: battlegrounds })
      .from(plans)
      .innerJoin(battlegrounds, eq(plans.battlegroundId, battlegrounds.id))
      .where(eq(plans.id, req.params.id))
      .limit(1)
    const row = rows[0]
    if (!row) return reply.status(404).send({ error: 'unknown plan' })

    const soldiers = countSoldiers(row.plan.units)
    if (soldiers === 0) {
      return reply
        .status(422)
        .send({ error: 'this plan has no units to simulate — place a force first' })
    }
    if (soldiers > config.maxSoldiersPerSimulation) {
      return reply.status(422).send({
        error:
          `this plan fields ${soldiers} soldiers; the limit is ` +
          `${config.maxSoldiersPerSimulation}. Reduce unit strengths on the Units page.`,
      })
    }

    const agents = countAgents(row.plan.units)
    if (agents > config.maxAgentsPerSimulation) {
      // Section commanders are the ones spending money, so this is the cost
      // ceiling. Say what the plan actually costs rather than "too big".
      return reply.status(422).send({
        error:
          `this plan fields ${agents} section commanders, each one model call ` +
          `per tick; the limit is ${config.maxAgentsPerSimulation}. Reduce unit ` +
          `strengths or the number of markers.`,
      })
    }

    const payload = encodeSimulationPayload(
      buildSimulationPayload({
        battleground: {
          bbox: row.battleground.bbox,
          gridBuffer: row.battleground.gridBuffer,
          // Daylight over this ground, from the forecast the pipeline stored.
          // A plan drawn for an 0300 approach used to simulate like a midday one.
          isDay: row.battleground.weather?.isDay ?? null,
        },
        plan: {
          units: row.plan.units,
          objectives: row.plan.objectives,
          routes: row.plan.routes,
        },
      }),
    )

    const form = new FormData()
    form.append(
      'payload',
      new Blob([new Uint8Array(payload)], { type: 'application/gzip' }),
      'payload.json.gz',
    )
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

    // Recorded after the engine accepts it, so a rejected submission leaves no
    // history row. The plan name is snapshotted: renaming a plan later should
    // not relabel a batch that ran against the old one.
    await db.insert(simulationBatches).values({
      id: body.batchId,
      planId: row.plan.id,
      planName: row.plan.name,
      battlegroundId: row.battleground.id,
      simulationCount: body.simulationCount,
      ticks: parsed.data.ticks,
      model: parsed.data.model ?? null,
      soldiers,
    })

    return reply.status(202).send({
      batchId: body.batchId,
      simulationCount: body.simulationCount,
      /** Soldiers the engine will actually field, after establishment expansion —
       *  the number the operator drew is markers, not men. */
      soldiers,
      /** Of those, the ones whose decisions cost a model call. */
      agents,
      /** Quantizing real elevation to integer metres can leave steps a soldier
       *  cannot climb. Surfaced before the batch runs rather than after, where
       *  it looks like agents that mysteriously will not advance. */
      diagnostics: body.diagnostics ?? null,
      eventsUrl: `/api/simulations/${body.batchId}/events`,
    })
  })

  /**
   * Batches this service has submitted, newest first, with the engine's stored
   * results attached.
   *
   * Neither side can answer this alone: the engine knows every run's outcome but
   * is handed an uploaded scenario, so it has no idea which plan a batch came
   * from; this service knows the plan but deliberately does not duplicate the
   * results. One list read from each, joined on the batch id.
   */
  app.get('/api/simulations', async (_req, reply) => {
    const missing = engineUnconfigured()
    if (missing) return reply.status(503).send({ error: missing })

    const rows = await db
      .select()
      .from(simulationBatches)
      .orderBy(desc(simulationBatches.createdAt))
      .limit(50)
    if (rows.length === 0) return { batches: [] }

    let engineBatches: Map<string, EngineBatchSummary>
    try {
      const res = await fetch(`${config.engineUrl}/v1/simulation-batches?limit=100`, {
        headers: authorization(),
        signal: AbortSignal.timeout(config.engineTimeoutMs),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = (await res.json()) as { batches: EngineBatchSummary[] }
      engineBatches = new Map(body.batches.map((batch) => [batch.batchId, batch]))
    } catch (error: unknown) {
      app.log.error({ error }, 'engine batch list failed')
      return reply.status(502).send({ error: 'could not reach the simulation engine' })
    }

    return {
      batches: rows.map((row) => {
        const engine = engineBatches.get(row.id)
        return {
          batchId: row.id,
          planId: row.planId,
          planName: row.planName,
          battlegroundId: row.battlegroundId,
          simulationCount: row.simulationCount,
          ticks: row.ticks,
          model: row.model,
          soldiers: row.soldiers,
          createdAt: row.createdAt,
          // A batch the engine no longer holds is reported as unknown rather
          // than hidden: the row is evidence the run happened.
          status: engine?.status ?? 'unknown',
          completed: engine?.completed ?? 0,
          failed: engine?.failed ?? 0,
          completedAt: engine?.completedAt ?? null,
        }
      }),
    }
  })

  /** One batch: the plan it ran, plus every run's stored outcome. This is what
   *  makes a completed batch readable after its event stream is gone. */
  app.get<{ Params: { batchId: string } }>(
    '/api/simulations/:batchId',
    async (req, reply) => {
      const missing = engineUnconfigured()
      if (missing) return reply.status(503).send({ error: missing })

      const rows = await db
        .select()
        .from(simulationBatches)
        .where(eq(simulationBatches.id, req.params.batchId))
        .limit(1)
      const row = rows[0]

      let detail: EngineBatchDetail
      try {
        const res = await fetch(
          `${config.engineUrl}/v1/simulation-batches/${req.params.batchId}`,
          {
            headers: authorization(),
            signal: AbortSignal.timeout(config.engineTimeoutMs),
          },
        )
        if (res.status === 404) return reply.status(404).send({ error: 'unknown batch' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        detail = (await res.json()) as EngineBatchDetail
      } catch (error: unknown) {
        app.log.error({ error }, 'engine batch detail failed')
        return reply.status(502).send({ error: 'could not reach the simulation engine' })
      }

      return {
        batchId: detail.batchId,
        planId: row?.planId ?? null,
        planName: row?.planName ?? null,
        battlegroundId: row?.battlegroundId ?? null,
        soldiers: row?.soldiers ?? null,
        simulationCount: detail.simulationCount,
        ticks: detail.ticks,
        model: detail.model,
        status: detail.status,
        createdAt: detail.createdAt,
        completedAt: detail.completedAt,
        runs: detail.runs.map((run) => ({
          simulationId: run.simulationId,
          simulationIndex: run.simulationIndex,
          status: run.status,
          summary: run.outcome,
          error: run.error,
          // Presigned for the bucket's internal hostname, so it is proxied
          // rather than handed to the browser -- same reasoning as the stream.
          replayPath: run.replayUrl ? replayPath(run.replayUrl) : null,
        })),
      }
    },
  )

  /**
   * Fetches one replay from the engine's object store on the browser's behalf.
   *
   * The engine hands out presigned URLs on its own bucket. Going through this
   * service means the bucket needs no CORS policy naming the frontend, and — the
   * reason it is not optional — a presigned URL signs the Host header, so a URL
   * signed for the bucket's internal hostname cannot be replayed by a browser
   * that reaches the same bucket under a different one.
   *
   * The caller supplies the URL, so the origin allowlist is what stops this
   * being a general-purpose fetcher pointed at anything the server can reach.
   */
  app.get<{ Querystring: { url?: string } }>(
    '/api/simulations/replay',
    async (req, reply) => {
      if (!config.engineReplayOrigin) {
        return reply.status(503).send({ error: 'ENGINE_REPLAY_ORIGIN is not set' })
      }

      const raw = req.query.url
      if (!raw) return reply.status(400).send({ error: 'url is required' })

      let target: URL
      try {
        target = new URL(raw)
      } catch {
        return reply.status(400).send({ error: 'url is not a valid URL' })
      }
      if (target.origin !== config.engineReplayOrigin) {
        return reply.status(403).send({ error: 'url is not on the engine replay origin' })
      }

      let upstream: Response
      try {
        upstream = await fetch(target, { signal: AbortSignal.timeout(config.engineTimeoutMs) })
      } catch (error: unknown) {
        app.log.error({ error }, 'replay fetch failed')
        return reply.status(502).send({ error: 'could not reach the replay store' })
      }

      if (!upstream.ok || !upstream.body) {
        return reply
          .status(upstream.status === 404 ? 404 : 502)
          .send({ error: `replay unavailable (HTTP ${upstream.status})` })
      }

      // The worker stores replays gzipped. undici transparently decodes them, so
      // what leaves here is plain JSON regardless of how it was stored.
      return reply.header('Content-Type', 'application/json').send(upstream.body)
    },
  )

  /**
   * Relays the engine's server-sent events for a batch, summarising each replay
   * on the way past.
   *
   * Event types this service does not know are forwarded untouched, and the
   * engine's own event ids are preserved so `Last-Event-ID` resumption keeps
   * working. Only `simulation.completed` is rewritten: its presigned
   * `replayUrl` is replaced by the run's `summary` plus a proxied path for
   * fetching the full replay on demand.
   *
   * The alternative — letting the browser fetch every replay — meant a 100-run
   * batch moved well over a gigabyte to produce one win rate, because each
   * replay repeats the whole battlefield surface (see services/replaySummary).
   *
   * Replays are summarised one at a time, in stream order. That bounds memory
   * to a single decoded replay and keeps ids monotonic for resumption, at the
   * cost of serialising fetches this service makes to its own object store.
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
        .send(Readable.from(summarizeStream(upstream.body, app.log)))
    },
  )
}
