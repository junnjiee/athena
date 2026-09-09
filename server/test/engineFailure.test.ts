import { afterEach, describe, expect, test } from 'bun:test'

process.env.ENGINE_URL = 'http://engine.test'
const { EngineUnavailableError, runBlockForces, runDocumentIntelligence, runEnemyCourses, runRouteStudy } = await import(
  '../src/services/engineClient'
)

const realFetch = globalThis.fetch

function respondWith(body: string, status: number, contentType = 'application/json') {
  globalThis.fetch = (async () =>
    new Response(body, { status, headers: { 'Content-Type': contentType } })) as unknown as typeof fetch
}

const request = {
  corridors: [],
  reserves: [],
  objectives: [],
  intent: { objective_ids: [], narrative: '' },
  weights: { speed: 0.5, blockable: 0.5, complexity: 0.5, likelihood: 0.5, danger: 0.5 },
}

afterEach(() => {
  globalThis.fetch = realFetch
})

/** The courses pass is the one call that can fail for a reason the operator can
 *  fix, so what the engine wrote has to survive the trip to the screen. */
describe('a failing engine call', () => {
  test("surfaces FastAPI's detail as a sentence, not as JSON", async () => {
    respondWith(JSON.stringify({ detail: 'set ATHENA_MODEL and PROVIDER_API_KEY' }), 503)

    await expect(runEnemyCourses(request)).rejects.toThrow('set ATHENA_MODEL and PROVIDER_API_KEY')
  })

  test('never shows the operator the wire format', async () => {
    respondWith(JSON.stringify({ detail: 'no model configured' }), 503)

    const error = await runEnemyCourses(request).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(EngineUnavailableError)
    expect((error as Error).message).toBe('no model configured')
  })

  test('a plain-text failure is used as it came', async () => {
    // An unhandled error in the engine renders as text, not as {"detail": ...}.
    respondWith('Internal Server Error', 500, 'text/plain')

    await expect(runEnemyCourses(request)).rejects.toThrow('Internal Server Error')
  })

  test('an empty body still names the status rather than saying nothing', async () => {
    respondWith('', 502)

    await expect(runEnemyCourses(request)).rejects.toThrow('engine returned HTTP 502')
  })
})

describe('revision-pinned engine calls', () => {
  test('a route study names the immutable graph revision to search', async () => {
    let sent: Record<string, unknown> = {}
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body)) as Record<string, unknown>
      return Response.json({ corridors: [], unreachable: [] })
    }) as typeof fetch

    await runRouteStudy({
      areaId: 'ao-1',
      graphRevision: 7,
      marks: { reserves: [], objectives: [] },
      excludedEdgeIds: [],
    })

    expect(sent.graph_revision).toBe(7)
  })

  test('block forces use the same graph revision as their corridors', async () => {
    let sent: Record<string, unknown> = {}
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body)) as Record<string, unknown>
      return Response.json({ corridors: [], allocation: [], unblockable: [], uncovered: [] })
    }) as typeof fetch

    await runBlockForces({
      areaId: 'ao-1',
      graphRevision: 4,
      corridors: [],
      orbat: { units: [] },
      reserves: [],
      blockPoints: [{ inlet_id: 'inlet-1', lon: 103.8, lat: 1.35 }],
      delayAssessments: [{ inlet_id: 'inlet-1', unit_id: 'sec1', delay_minutes: 45 }],
    })

    expect(sent.graph_revision).toBe(4)
    expect(sent.reserves).toEqual([])
    expect(sent.block_points).toEqual([{ inlet_id: 'inlet-1', lon: 103.8, lat: 1.35 }])
    expect(sent.delay_assessments).toEqual([
      { inlet_id: 'inlet-1', unit_id: 'sec1', delay_minutes: 45 },
    ])
  })
})

describe('document intelligence engine calls', () => {
  test('sends extracted text without source bytes', async () => {
    let sent: Record<string, unknown> = {}
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body)) as Record<string, unknown>
      return Response.json({ proposals: [], rejected: [] })
    }) as typeof fetch

    await runDocumentIntelligence([{ id: 'sitrep', name: 'sitrep.txt', text: 'Reserve IVO Kranji' }])

    expect(sent.documents).toEqual([{ id: 'sitrep', name: 'sitrep.txt', text: 'Reserve IVO Kranji' }])
  })

  test('surfaces model configuration failures', async () => {
    respondWith(JSON.stringify({ detail: 'set ATHENA_MODEL and PROVIDER_API_KEY' }), 503)
    await expect(runDocumentIntelligence([])).rejects.toThrow('set ATHENA_MODEL and PROVIDER_API_KEY')
  })
})
