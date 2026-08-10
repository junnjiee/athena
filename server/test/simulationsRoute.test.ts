import { afterEach, describe, expect, mock, test } from 'bun:test'
import Fastify from 'fastify'

/** Rows the stubbed drizzle chain resolves to; swapped per test. */
let rows: unknown[] = []

function queryChain(): unknown {
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'from', 'where', 'limit']) {
    chain[method] = () => chain
  }
  chain.then = (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve)
  return chain
}

mock.module('../src/db/client', () => ({ db: queryChain() }))

// `config` is a module-level const evaluated on first import, so setting
// process.env here would be too late whenever another test file has already
// pulled it in. Override the two engine fields instead, keeping the rest of the
// real config so nothing else that reads it changes behaviour.
const { config: realConfig } = await import('../src/config')
mock.module('../src/config', () => ({
  config: { ...realConfig, engineUrl: 'https://engine.test', engineToken: 'engine-secret' },
}))

const { registerSimulationRoutes } = await import('../src/routes/simulations')

async function app() {
  const instance = Fastify()
  registerSimulationRoutes(instance)
  await instance.ready()
  return instance
}

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
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

const accepted = () =>
  new Response(
    JSON.stringify({
      batchId: 'batch-1',
      simulationCount: 100,
      eventsUrl: '/v1/simulation-batches/batch-1/events',
    }),
    { status: 202, headers: { 'Content-Type': 'application/json' } },
  )

describe('POST /api/plans/:id/simulate', () => {
  test('submits the plan id with the bearer token and never the payload', async () => {
    rows = [{ id: 'plan-1' }]
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
    expect(form.get('planId')).toBe('plan-1')
    expect(form.get('simulationCount')).toBe('20')
    expect(form.get('ticks')).toBe('80')
    expect(form.get('payload')).toBeNull()
  })

  test('rewrites the events URL to this service, so the browser never sees the engine', async () => {
    rows = [{ id: 'plan-1' }]
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

  test('rejects an out-of-range simulation count', async () => {
    rows = [{ id: 'plan-1' }]
    const res = await (await app()).inject({
      method: 'POST',
      url: '/api/plans/plan-1/simulate',
      payload: { simulationCount: 100_000 },
    })

    expect(res.statusCode).toBe(400)
  })

  test('reports an unreachable engine as a bad gateway, not a crash', async () => {
    rows = [{ id: 'plan-1' }]
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
    rows = [{ id: 'plan-1' }]
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
