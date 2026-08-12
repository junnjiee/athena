import { describe, expect, mock, test } from 'bun:test'
import Fastify from 'fastify'

const BBOX = { west: 0, south: 0, east: 0.001, north: 0.001 }

const BATTLEGROUND_ROW = {
  id: 'bg-1',
  name: 'Test Ground',
  bbox: BBOX,
  width: 2,
  height: 2,
  cellMeters: 1,
  generatedAt: '2026-01-01T00:00:00.000Z',
  weather: null,
  featureCounts: { roads: 0, buildings: 0, areas: 0 },
  segmentation: null,
  gridBuffer: Buffer.from([1, 2, 3, 4]),
  features: { roads: [], buildings: [], areas: [], waterLines: [] },
}

function validReplay(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    schema_version: 3,
    battlefield: {
      width: 2,
      height: 2,
      surface: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
        { x: 1, y: 1, z: 0 },
      ],
      terrain_classes: [0, 0, 0, 0],
      communication_groups: [],
    },
    steps: [
      {
        step: 0,
        soldiers: [
          { soldier_index: 0, team: 'blue', position: { x: 0, y: 0, z: 0 }, survival_status: 'alive' },
          { soldier_index: 1, team: 'red', position: { x: 1, y: 1, z: 0 }, survival_status: 'alive' },
        ],
        shots: [],
        messages: [],
      },
    ],
    ...overrides,
  }
}

/** Rows the stubbed select chain resolves to; swapped per test. */
let selectRows: unknown[] = []
/** When non-empty, each select() call shifts its result off this queue
 *  instead of `selectRows` -- lets a test script multiple selects within one
 *  request differently (e.g. the "battleground missing, upsert from the job
 *  cache, then refetch" path). */
let selectQueue: unknown[][] = []
/** Values passed to db.insert(...).values(...) calls, most recent last. */
let insertedValues: Record<string, unknown>[] = []
/** Rows the stubbed delete().returning() resolves to. */
let deleteRows: unknown[] = []
/** Job the stubbed getJob() resolves to; undefined means "no such job". */
let stubJob: unknown = undefined

function selectChain(): unknown {
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'from', 'innerJoin', 'where', 'limit', 'orderBy']) {
    chain[method] = () => chain
  }
  chain.then = (resolve: (value: unknown[]) => unknown) =>
    Promise.resolve(selectQueue.length > 0 ? (selectQueue.shift() ?? []) : selectRows).then(resolve)
  return chain
}

mock.module('../src/db/client', () => ({
  db: {
    select: () => selectChain(),
    insert: () => ({
      values: (values: Record<string, unknown>) => {
        insertedValues.push(values)
        const result = Promise.resolve(undefined) as Promise<undefined> & {
          onConflictDoNothing: (arg: unknown) => Promise<undefined>
        }
        result.onConflictDoNothing = () => Promise.resolve(undefined)
        return result
      },
    }),
    delete: () => ({
      where: () => ({
        returning: () => Promise.resolve(deleteRows),
      }),
    }),
  },
}))

mock.module('../src/services/pipeline', () => ({
  getJob: () => stubJob,
}))

const { registerReplayRoutes } = await import('../src/routes/replays')

async function app() {
  const instance = Fastify()
  registerReplayRoutes(instance)
  await instance.ready()
  return instance
}

describe('POST /api/replays', () => {
  test('imports a valid v3 replay against a matching battleground', async () => {
    selectRows = [BATTLEGROUND_ROW]
    insertedValues = []
    const res = await (
      await app()
    ).inject({
      method: 'POST',
      url: '/api/replays',
      payload: { battlegroundId: 'bg-1', name: 'Run 1', replay: validReplay() },
    })

    expect(res.statusCode).toBe(201)
    expect(res.json<{ id: string }>().id).toBeTruthy()
    expect(insertedValues).toHaveLength(1)
    expect(insertedValues[0]).toMatchObject({ battlegroundId: 'bg-1', name: 'Run 1', stepCount: 1, soldierCount: 2 })
  })

  test('upserts the battleground from the pipeline job cache when no plan has saved it yet', async () => {
    // A battleground only gets a DB row once a plan is saved against it --
    // importing a replay right after generation (no saved plan) must fall
    // back to the in-memory job cache instead of 404ing.
    selectRows = []
    selectQueue = [[], [BATTLEGROUND_ROW]] // first lookup: missing; refetch after upsert: found
    insertedValues = []
    stubJob = {
      status: 'ready',
      meta: {
        id: 'bg-1',
        name: 'Test Ground',
        bbox: BBOX,
        width: 2,
        height: 2,
        cellMeters: 1,
        generatedAt: '2026-01-01T00:00:00.000Z',
        weather: null,
        featureCounts: { roads: 0, buildings: 0, areas: 0 },
        segmentation: null,
      },
      gridBuffer: Buffer.from([1, 2, 3, 4]),
      features: { roads: [], buildings: [], areas: [], waterLines: [] },
    }

    const res = await (
      await app()
    ).inject({
      method: 'POST',
      url: '/api/replays',
      payload: { battlegroundId: 'bg-1', name: 'Run 1', replay: validReplay() },
    })

    expect(res.statusCode).toBe(201)
    expect(insertedValues).toHaveLength(2) // battlegrounds upsert, then the simulation_runs insert
    expect(insertedValues[0]).toMatchObject({ id: 'bg-1', width: 2, height: 2 })
    stubJob = undefined
  })

  test('404s when neither a DB row nor a pipeline job exists for the battleground', async () => {
    selectRows = []
    stubJob = undefined
    const res = await (
      await app()
    ).inject({
      method: 'POST',
      url: '/api/replays',
      payload: { battlegroundId: 'nope', name: 'Run 1', replay: validReplay() },
    })
    expect(res.statusCode).toBe(404)
  })

  test('404s for an unknown battleground', async () => {
    selectRows = []
    const res = await (
      await app()
    ).inject({
      method: 'POST',
      url: '/api/replays',
      payload: { battlegroundId: 'nope', name: 'Run 1', replay: validReplay() },
    })
    expect(res.statusCode).toBe(404)
  })

  test('409s when the replay battlefield dimensions do not match the battleground grid', async () => {
    selectRows = [BATTLEGROUND_ROW]
    const res = await (
      await app()
    ).inject({
      method: 'POST',
      url: '/api/replays',
      payload: {
        battlegroundId: 'bg-1',
        name: 'Run 1',
        replay: validReplay({
          battlefield: {
            width: 4,
            height: 4,
            surface: Array.from({ length: 16 }, (_, i) => ({ x: i % 4, y: Math.floor(i / 4), z: 0 })),
            terrain_classes: Array.from({ length: 16 }, () => 0),
            communication_groups: [],
          },
        }),
      },
    })
    expect(res.statusCode).toBe(409)
  })

  test('400s a schema_version 2 payload (stale shape)', async () => {
    selectRows = [BATTLEGROUND_ROW]
    const v2 = { ...validReplay(), schema_version: 2 }
    const res = await (
      await app()
    ).inject({
      method: 'POST',
      url: '/api/replays',
      payload: { battlegroundId: 'bg-1', name: 'Run 1', replay: v2 },
    })
    expect(res.statusCode).toBe(400)
  })

  test('400s when surface length does not match width*height', async () => {
    selectRows = [BATTLEGROUND_ROW]
    const res = await (
      await app()
    ).inject({
      method: 'POST',
      url: '/api/replays',
      payload: {
        battlegroundId: 'bg-1',
        name: 'Run 1',
        replay: validReplay({
          battlefield: {
            width: 2,
            height: 2,
            surface: [{ x: 0, y: 0, z: 0 }],
            terrain_classes: [0, 0, 0, 0],
            communication_groups: [],
          },
        }),
      },
    })
    expect(res.statusCode).toBe(400)
  })
})

describe('GET /api/replays', () => {
  test('lists saved runs', async () => {
    selectRows = [
      {
        id: 'run-1',
        name: 'Run 1',
        battlegroundId: 'bg-1',
        battlegroundName: 'Test Ground',
        stepCount: 1,
        soldierCount: 2,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]
    const res = await (await app()).inject({ method: 'GET', url: '/api/replays' })
    expect(res.statusCode).toBe(200)
    expect(res.json<unknown[]>()).toEqual(selectRows)
  })
})

describe('GET /api/replays/:id', () => {
  test('bundles the replay with its terrain snapshot', async () => {
    selectRows = [
      {
        run: {
          id: 'run-1',
          name: 'Run 1',
          battlegroundId: 'bg-1',
          stepCount: 1,
          soldierCount: 2,
          replayLog: validReplay(),
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        battleground: BATTLEGROUND_ROW,
      },
    ]
    const res = await (await app()).inject({ method: 'GET', url: '/api/replays/run-1' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.run).toMatchObject({ id: 'run-1', name: 'Run 1' })
    expect(body.replay.schema_version).toBe(3)
    expect(body.meta).toMatchObject({ id: 'bg-1', width: 2, height: 2 })
    expect(body.gridBufferBase64).toBe(BATTLEGROUND_ROW.gridBuffer.toString('base64'))
  })

  test('404s for an unknown replay', async () => {
    selectRows = []
    const res = await (await app()).inject({ method: 'GET', url: '/api/replays/nope' })
    expect(res.statusCode).toBe(404)
  })
})

describe('DELETE /api/replays/:id', () => {
  test('deletes an existing run', async () => {
    deleteRows = [{ id: 'run-1' }]
    const res = await (await app()).inject({ method: 'DELETE', url: '/api/replays/run-1' })
    expect(res.statusCode).toBe(204)
  })

  test('404s for an unknown run', async () => {
    deleteRows = []
    const res = await (await app()).inject({ method: 'DELETE', url: '/api/replays/nope' })
    expect(res.statusCode).toBe(404)
  })
})
