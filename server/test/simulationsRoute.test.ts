import { gunzipSync } from 'node:zlib'
import { afterEach, describe, expect, mock, test } from 'bun:test'
import Fastify from 'fastify'
import { packGrid } from '../src/services/grid'
import { TERRAIN_CLASS } from '../src/types'
import type { GridChannels } from '../src/types'

/** Rows the stubbed drizzle chain resolves to; swapped per test. */
let rows: unknown[] = []

/** Batches recorded by the route under test, for assertions below. */
let inserted: unknown[] = []

function queryChain(): unknown {
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'from', 'innerJoin', 'where', 'limit', 'orderBy']) {
    chain[method] = () => chain
  }
  // The route records the batch it just queued. Writes resolve rather than
  // returning rows, so they get their own terminal instead of the chain's.
  chain.insert = () => ({
    values: (value: unknown) => {
      inserted.push(value)
      return Promise.resolve()
    },
  })
  chain.then = (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve)
  return chain
}

mock.module('../src/db/client', () => ({ db: queryChain() }))

const BBOX = { west: 0, south: 0, east: 0.01, north: 0.01 }

function gridBuffer(): Buffer {
  const n = 4
  const zero = () => new Uint8Array(n)
  const channels: GridChannels = {
    height: Float32Array.from([10, 11, 12, 13]),
    cls: Uint8Array.from([TERRAIN_CLASS.OPEN, TERRAIN_CLASS.OPEN, TERRAIN_CLASS.OPEN, TERRAIN_CLASS.ROAD]),
    slope: zero(),
    cover: zero(),
    concealment: zero(),
    moveCost: zero(),
    visibility: zero(),
    vehicleMobility: zero(),
    ambush: zero(),
  }
  return packGrid(channels, 2, 2, 1)
}

/** A joined plan+battleground row, as the simulate route selects it. */
function planRow(units: unknown[], routes: unknown[] = []) {
  return {
    plan: { id: 'plan-1', name: 'Test Plan', units, objectives: [], routes },
    battleground: { id: 'bg-1', bbox: BBOX, gridBuffer: gridBuffer() },
  }
}

function marker(overrides: Record<string, unknown> = {}) {
  return {
    id: 'unit-1',
    side: 'blue',
    name: 'Alpha',
    typeLabel: 'Rifle Section',
    position: { longitude: 0.005, latitude: 0.005 },
    symbolKind: 'blueSection',
    rotationRadians: 0,
    ...overrides,
  }
}

// `config` is a module-level const evaluated on first import, so setting
// process.env here would be too late whenever another test file has already
// pulled it in. Override the two engine fields instead, keeping the rest of the
// real config so nothing else that reads it changes behaviour.
const { config: realConfig } = await import('../src/config')
mock.module('../src/config', () => ({
  config: { ...realConfig, engineUrl: 'https://engine.test', engineToken: 'engine-secret' },
}))

const { registerSimulationRoutes, summarizeStream } = await import("../src/routes/simulations")

async function app() {
  const instance = Fastify()
  registerSimulationRoutes(instance)
  await instance.ready()
  return instance
}

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
  inserted = []
})

/** Captures the outbound engine request and returns a canned response. */
function stubEngine(response: Response) {
  const calls: { url: string; init: RequestInit }[] = []
  globalThis.fetch = (async (url: string | URL, init: RequestInit = {}) => {
    calls.push({ url: String(url), init })
    return response
  }) as unknown as typeof fetch
  return calls
}

/** Routes outbound fetches by URL, so an SSE stream and the replay fetches it
 *  triggers can be stubbed independently. */
function stubByUrl(handlers: Array<[RegExp, () => Response]>) {
  const calls: string[] = []
  globalThis.fetch = (async (url: string | URL) => {
    const target = String(url)
    calls.push(target)
    const match = handlers.find(([pattern]) => pattern.test(target))
    if (!match) return new Response('unstubbed', { status: 500 })
    return match[1]()
  }) as unknown as typeof fetch
  return calls
}

/** Byte stream of SSE chunks, one enqueue per chunk, so the transform has to
 *  reassemble across boundaries exactly as it does against a real socket. */
function sseBody(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk))
      controller.close()
    },
  })
}

/** A replay whose last step leaves blue holding the ground. */
const REPLAY = {
  schema_version: 3,
  steps: [
    {
      step: 0,
      soldiers: [
        { soldier_index: 0, team: 'blue', survival_status: 'alive' },
        { soldier_index: 1, team: 'red', survival_status: 'alive' },
      ],
      shots: [],
    },
    {
      step: 1,
      soldiers: [
        { soldier_index: 0, team: 'blue', survival_status: 'alive' },
        { soldier_index: 1, team: 'red', survival_status: 'casualty' },
      ],
      shots: [{ hit: true }],
    },
  ],
}

const completedBlock = (index: number) =>
  `id: ${index + 2}\nevent: simulation.completed\ndata: ${JSON.stringify({
    simulationId: `sim-${index}`,
    simulationIndex: index,
    replayUrl: `https://bucket.test/replay-${index}.json.gz`,
  })}\n\n`

/** Parse an SSE body back into blocks keyed by event type. */
function readEvents(body: string) {
  return body
    .split('\n\n')
    .filter((block) => block.trim() !== '')
    .map((block) => {
      const type = /^event: (.+)$/m.exec(block)?.[1]
      const id = /^id: (.+)$/m.exec(block)?.[1]
      const data = /^data: (.+)$/m.exec(block)?.[1]
      return { type, id, data: data === undefined ? undefined : JSON.parse(data) }
    })
}

const accepted = () =>
  new Response(
    JSON.stringify({
      batchId: 'batch-1',
      simulationCount: 100,
      eventsUrl: '/v1/simulation-batches/batch-1/events',
    }),
    { status: 202, headers: { 'Content-Type': 'application/json' } },
  )

/** The gzipped scenario the route uploaded, decoded back to JSON. */
async function submittedPayload(form: FormData) {
  const file = form.get('payload') as Blob
  const bytes = Buffer.from(await file.arrayBuffer())
  return JSON.parse(gunzipSync(bytes).toString('utf8'))
}

describe('POST /api/plans/:id/simulate', () => {
  test('uploads the scenario with the bearer token, never the raw plan id', async () => {
    rows = [planRow([marker()])]
    const calls = stubEngine(accepted())

    const res = await (await app()).inject({
      method: 'POST',
      url: '/api/plans/plan-1/simulate',
      payload: { simulationCount: 20, ticks: 80 },
    })

    expect(res.statusCode).toBe(202)
    expect(res.json<{ batchId: string }>().batchId).toBe('batch-1')

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://engine.test/v1/simulation-batches')
    const headers = calls[0].init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer engine-secret')

    const form = calls[0].init.body as FormData
    expect(form.get('simulationCount')).toBe('20')
    expect(form.get('ticks')).toBe('80')
    expect(form.get('planId')).toBeNull()
    expect(form.get('payload')).not.toBeNull()
  })

  test('expands establishment, so the engine fields men rather than markers', async () => {
    rows = [planRow([marker({ strength: 7 }), marker({ id: 'unit-2', side: 'red', strength: 3 })])]
    const calls = stubEngine(accepted())

    const res = await (await app()).inject({
      method: 'POST',
      url: '/api/plans/plan-1/simulate',
      payload: {},
    })

    const body = await submittedPayload(calls[0].init.body as FormData)
    expect(body.units).toHaveLength(10)
    expect(body.units.filter((u: { side: string }) => u.side === 'red')).toHaveLength(3)
    expect(body.terrain.width).toBe(2)
    // Reported back so the operator sees men, not the markers they drew.
    expect(res.json<{ soldiers: number }>().soldiers).toBe(10)
  })

  test('rewrites the events URL to this service, so the browser never sees the engine', async () => {
    rows = [planRow([marker()])]
    stubEngine(accepted())

    const res = await (await app()).inject({
      method: 'POST',
      url: '/api/plans/plan-1/simulate',
      payload: {},
    })

    expect(res.json<{ eventsUrl: string }>().eventsUrl).toBe(
      '/api/simulations/batch-1/events',
    )
  })

  test('404s an unknown plan before queueing any work', async () => {
    rows = []
    const calls = stubEngine(accepted())

    const res = await (await app()).inject({
      method: 'POST',
      url: '/api/plans/nope/simulate',
      payload: {},
    })

    expect(res.statusCode).toBe(404)
    expect(calls).toHaveLength(0)
  })

  test('refuses a plan with nothing to simulate', async () => {
    rows = [planRow([])]
    const calls = stubEngine(accepted())

    const res = await (await app()).inject({
      method: 'POST',
      url: '/api/plans/plan-1/simulate',
      payload: {},
    })

    expect(res.statusCode).toBe(422)
    expect(calls).toHaveLength(0)
  })

  test('a platoon-heavy plan now runs, because only commanders cost a call', async () => {
    // 5 x 21 = 105 soldiers. That used to be refused outright, because every
    // soldier was a model call per tick. They are now 15 sections, so the batch
    // costs 15 calls a tick rather than 105.
    rows = [planRow(Array.from({ length: 5 }, (_, i) => marker({ id: `u${i}`, strength: 21 })))]
    stubEngine(accepted())

    const res = await (await app()).inject({
      method: 'POST',
      url: '/api/plans/plan-1/simulate',
      payload: {},
    })

    expect(res.statusCode).toBe(202)
    expect(res.json<{ soldiers: number; agents: number }>()).toMatchObject({
      soldiers: 105,
      agents: 15,
    })
  })

  test('refuses a plan with more section commanders than the cost ceiling', async () => {
    // 41 single-soldier markers is 41 sections, so 41 model calls a tick. The
    // commanders are the bill, so they are what the ceiling counts.
    rows = [planRow(Array.from({ length: 41 }, (_, i) => marker({ id: `u${i}` })))]
    const calls = stubEngine(accepted())

    const res = await (await app()).inject({
      method: 'POST',
      url: '/api/plans/plan-1/simulate',
      payload: {},
    })

    expect(res.statusCode).toBe(422)
    expect(res.json<{ error: string }>().error).toContain('41 section commanders')
    expect(calls).toHaveLength(0)
  })

  test('refuses a plan with more soldiers than a run can carry', async () => {
    // 12 x 21 = 252 soldiers but only 36 commanders, so this clears the cost
    // ceiling and fails on the other one: per-tick visibility work is quadratic
    // in soldier count regardless of who is making the decisions.
    rows = [planRow(Array.from({ length: 12 }, (_, i) => marker({ id: `u${i}`, strength: 21 })))]
    const calls = stubEngine(accepted())

    const res = await (await app()).inject({
      method: 'POST',
      url: '/api/plans/plan-1/simulate',
      payload: {},
    })

    expect(res.statusCode).toBe(422)
    expect(res.json<{ error: string }>().error).toContain('252 soldiers')
    expect(calls).toHaveLength(0)
  })

  test('rejects an out-of-range simulation count', async () => {
    rows = [planRow([marker()])]
    const res = await (await app()).inject({
      method: 'POST',
      url: '/api/plans/plan-1/simulate',
      payload: { simulationCount: 100_000 },
    })

    expect(res.statusCode).toBe(400)
  })

  test('reports an unreachable engine as a bad gateway, not a crash', async () => {
    rows = [planRow([marker()])]
    globalThis.fetch = (async () => {
      throw new Error('ECONNREFUSED')
    }) as unknown as typeof fetch

    const res = await (await app()).inject({
      method: 'POST',
      url: '/api/plans/plan-1/simulate',
      payload: {},
    })

    expect(res.statusCode).toBe(502)
  })

  test("does not forward the engine's error body, which can echo its config", async () => {
    rows = [planRow([marker()])]
    stubEngine(
      new Response('TERRAIN_SERVICE_URL=http://internal:8787 is not set', { status: 503 }),
    )

    const res = await (await app()).inject({
      method: 'POST',
      url: '/api/plans/plan-1/simulate',
      payload: {},
    })

    expect(res.statusCode).toBe(502)
    expect(res.body).not.toContain('internal')
  })
})

describe('GET /api/simulations/:batchId/events', () => {
  test('forwards the bearer token and Last-Event-ID upstream', async () => {
    const calls = stubEngine(
      new Response('event: batch.completed\ndata: {}\n\n', {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }),
    )

    const res = await (await app()).inject({
      method: 'GET',
      url: '/api/simulations/batch-1/events',
      headers: { 'last-event-id': '42' },
    })

    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toContain('text/event-stream')

    const headers = calls[0].init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer engine-secret')
    expect(headers['Last-Event-ID']).toBe('42')
  })

  test('passes an unknown batch through as 404', async () => {
    stubEngine(new Response('unknown simulation batch', { status: 404 }))

    const res = await (await app()).inject({
      method: 'GET',
      url: '/api/simulations/nope/events',
    })

    expect(res.statusCode).toBe(404)
  })

})

/** Drives the SSE transform directly. `inject` cannot consume a multi-chunk
 *  streaming response — it reports the response destroyed before completion —
 *  and the transform is where the logic being tested actually lives. */
describe('summarizeStream', () => {
  const silent = { error: () => {} } as unknown as Parameters<typeof summarizeStream>[1]

  async function run(chunks: string[]): Promise<string> {
    let out = ''
    for await (const block of summarizeStream(sseBody(chunks), silent)) out += block
    return out
  }

  test('scores each completed run server-side, so the browser never sees a replay', async () => {
    stubByUrl([[/bucket\.test/, () => new Response(JSON.stringify(REPLAY), { status: 200 })]])

    const events = readEvents(
      await run([
        'id: 1\nevent: batch.queued\ndata: {"simulationCount":2}\n\n',
        completedBlock(0),
        completedBlock(1),
        'id: 4\nevent: batch.completed\ndata: {"status":"completed","completed":2,"failed":0}\n\n',
      ]),
    )

    expect(events.map((e) => e.type)).toEqual([
      'batch.queued',
      'simulation.completed',
      'simulation.completed',
      'batch.completed',
    ])

    const completed = events.filter((e) => e.type === 'simulation.completed')
    expect(completed[0].data.summary).toMatchObject({
      outcome: 'blue',
      ticks: 1,
      redLosses: 1,
      shotsFired: 1,
      hits: 1,
    })
    // The presigned URL is replaced by a path back through this service.
    expect(completed[0].data.replayUrl).toBeUndefined()
    expect(completed[0].data.replayPath).toContain('/api/simulations/replay?url=')
    // Engine ids survive, so Last-Event-ID resumption still works.
    expect(events.map((e) => e.id)).toEqual(['1', '2', '3', '4'])
  })

  test('a run whose replay cannot be read is reported, not dropped', async () => {
    stubByUrl([[/bucket\.test/, () => new Response('gone', { status: 404 })]])

    const completed = readEvents(await run([completedBlock(0)])).find(
      (e) => e.type === 'simulation.completed',
    )

    expect(completed?.data.summary).toBeNull()
    expect(completed?.data.summaryError).toContain('404')
  })

  test('forwards event types it does not know, and keep-alive comments, untouched', async () => {
    stubByUrl([])

    const body = await run([
      ': keep-alive\n\n',
      'id: 9\nevent: something.new\ndata: {"shape":"unknown"}\n\n',
    ])

    expect(body).toContain(': keep-alive')
    expect(body).toContain('event: something.new')
    expect(body).toContain('{"shape":"unknown"}')
  })

  test('reassembles events split across chunk boundaries', async () => {
    stubByUrl([[/bucket\.test/, () => new Response(JSON.stringify(REPLAY), { status: 200 })]])
    const block = completedBlock(0)

    // Split mid-JSON: a naive per-chunk parse would lose this event.
    const completed = readEvents(await run([block.slice(0, 40), block.slice(40)])).find(
      (e) => e.type === 'simulation.completed',
    )

    expect(completed?.data.summary.outcome).toBe('blue')
  })

  test('summarises one replay at a time, bounding memory on large batches', async () => {
    let inFlight = 0
    let peak = 0
    stubByUrl([
      [
        /bucket\.test/,
        () => {
          inFlight += 1
          peak = Math.max(peak, inFlight)
          inFlight -= 1
          return new Response(JSON.stringify(REPLAY), { status: 200 })
        },
      ],
    ])

    await run([completedBlock(0), completedBlock(1), completedBlock(2)])

    expect(peak).toBe(1)
  })
})

describe('GET /api/simulations/status', () => {
  test('reports configuration without leaking the token', async () => {
    const res = await (await app()).inject({ method: 'GET', url: '/api/simulations/status' })

    expect(res.json<{ configured: boolean; engineUrl: string }>()).toEqual({
      configured: true,
      engineUrl: 'https://engine.test',
    })
    expect(res.body).not.toContain('engine-secret')
  })
})

describe('scoring a run without reading its replay', () => {
  const silent = { error: () => {} } as unknown as Parameters<typeof summarizeStream>[1]

  async function drain(chunks: string[]): Promise<string> {
    let out = ''
    for await (const block of summarizeStream(sseBody(chunks), silent)) out += block
    return out
  }

  test("the engine's own outcome is used and the replay is never fetched", async () => {
    // This is the whole point: a replay repeats the battlefield surface, ~17 MB
    // on an 800x800 ground, so fetching one per run to compute a win rate moved
    // ~1.7 GB for a 100-run batch. The engine knows who won when the run ends.
    const calls = stubByUrl([[/.*/, () => new Response('unexpected', { status: 500 })]])
    const event = {
      simulationId: 'sim-1',
      simulationIndex: 0,
      replayUrl: 'https://bucket.test/replays/sim-1.json.gz',
      outcome: {
        outcome: 'blue',
        ticks: 22,
        blueAlive: 5,
        redAlive: 0,
        blueLosses: 2,
        redLosses: 4,
        shotsFired: 31,
        hits: 4,
      },
    }

    const out = await drain([
      `id: 7\nevent: simulation.completed\ndata: ${JSON.stringify(event)}\n\n`,
    ])
    const forwarded = JSON.parse(out.split('data: ')[1])

    expect(calls).toEqual([])
    expect(forwarded.summary.outcome).toBe('blue')
    expect(forwarded.summary.shotsFired).toBe(31)
    // The replay is still reachable on demand, just not fetched to score.
    expect(forwarded.replayPath).toContain('/api/simulations/replay?url=')
    expect(out.startsWith('id: 7\n')).toBe(true)
  })

  test('a batch from an engine that reports no outcome still falls back to the replay', async () => {
    const replay = {
      schema_version: 3,
      steps: [
        {
          step: 0,
          soldiers: [
            { soldier_index: 0, team: 'blue', survival_status: 'alive' },
            { soldier_index: 1, team: 'red', survival_status: 'alive' },
          ],
          shots: [],
        },
        {
          step: 1,
          soldiers: [
            { soldier_index: 0, team: 'blue', survival_status: 'alive' },
            { soldier_index: 1, team: 'red', survival_status: 'dead' },
          ],
          shots: [{ hit: true }],
        },
      ],
    }
    const calls = stubByUrl([
      [/replays/, () => new Response(JSON.stringify(replay), { status: 200 })],
    ])
    const event = {
      simulationId: 'sim-2',
      simulationIndex: 1,
      replayUrl: 'https://bucket.test/replays/sim-2.json.gz',
    }

    const out = await drain([
      `id: 8\nevent: simulation.completed\ndata: ${JSON.stringify(event)}\n\n`,
    ])
    const forwarded = JSON.parse(out.split('data: ')[1])

    expect(calls).toHaveLength(1)
    expect(forwarded.summary.outcome).toBe('blue')
  })
})

describe('batch history', () => {
  test('a queued batch is recorded against the plan it came from', async () => {
    // The engine is handed an uploaded scenario, so it has no idea which plan a
    // batch belongs to. Without this row a completed batch cannot be traced back
    // to the drawing that produced it.
    rows = [planRow([marker()])]
    stubEngine(
      new Response(
        JSON.stringify({
          batchId: 'batch-9',
          simulationCount: 3,
          eventsUrl: '/v1/simulation-batches/batch-9/events',
        }),
        { status: 202, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const instance = await app()
    const res = await instance.inject({
      method: 'POST',
      url: '/api/plans/plan-1/simulate',
      payload: { simulationCount: 3, ticks: 20 },
    })

    expect(res.statusCode).toBe(202)
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({
      id: 'batch-9',
      planId: 'plan-1',
      planName: 'Test Plan',
      battlegroundId: 'bg-1',
      simulationCount: 3,
      ticks: 20,
      soldiers: 1,
    })
  })

  test('a rejected submission leaves no history row', async () => {
    rows = [planRow([marker()])]
    stubEngine(new Response('nope', { status: 500 }))

    const instance = await app()
    await instance.inject({
      method: 'POST',
      url: '/api/plans/plan-1/simulate',
      payload: {},
    })

    expect(inserted).toEqual([])
  })
})
