import { describe, expect, mock, test } from 'bun:test'
import Fastify from 'fastify'
import { cellCenter, type GridGeo } from '../src/lib/cells'
import { packGrid } from '../src/services/grid'
import { TERRAIN_CLASS, type GridChannels } from '../src/types'

const GEO: GridGeo = {
  bbox: { west: 0, south: 0, east: 0.001, north: 0.001 },
  width: 10,
  height: 10,
  cellMeters: 11.132,
}
const N = GEO.width * GEO.height

function channels(): GridChannels {
  const fill = (v: number) => new Uint8Array(N).fill(v)
  return {
    height: Float32Array.from({ length: N }, (_, i) => 100 + i),
    cls: fill(TERRAIN_CLASS.FOREST),
    slope: fill(7),
    cover: fill(80),
    concealment: fill(90),
    moveCost: fill(40),
    visibility: fill(15),
    vehicleMobility: fill(5),
    ambush: fill(70),
  }
}

const ROW = {
  plan: {
    id: 'plan-1',
    name: 'Ridge Probe',
    units: [
      {
        id: 'u1',
        side: 'blue',
        name: 'Alpha',
        typeLabel: 'Blue Force Platoon',
        position: cellCenter(GEO, 1, 1),
        symbolKind: 'bluePlatoon',
        rotationRadians: 0,
      },
    ],
    objectives: [],
    routes: [
      {
        id: 'r1',
        side: 'blue',
        startUnitId: 'u1',
        points: [cellCenter(GEO, 1, 1), cellCenter(GEO, 1, 4)],
        endRef: null,
        movementType: 'prowl',
        loadout: { bodyMassKg: 75, loadMassKg: 14, preset: 'light' },
      },
    ],
  },
  battleground: {
    id: 'bg-1',
    name: 'Test Ground',
    bbox: GEO.bbox,
    width: GEO.width,
    height: GEO.height,
    cellMeters: GEO.cellMeters,
    weather: null,
    gridBuffer: packGrid(channels(), GEO.width, GEO.height, GEO.cellMeters),
  },
}

/** Rows the stubbed drizzle chain will resolve to; swapped per test. */
let rows: unknown[] = []

/** Minimal thenable stand-in for the drizzle query builder — every chained call
 *  returns itself, and awaiting it yields whatever `rows` is set to. */
function queryChain(): unknown {
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'from', 'innerJoin', 'where', 'limit', 'orderBy']) {
    chain[method] = () => chain
  }
  chain.then = (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve)
  return chain
}

mock.module('../src/db/client', () => ({
  db: queryChain(),
}))

const { registerPlanRoutes } = await import('../src/routes/plans')

async function app() {
  const instance = Fastify()
  registerPlanRoutes(instance)
  await instance.ready()
  return instance
}

describe('GET /api/plans/:id/brief', () => {
  test('returns the drawn plan georeferenced onto the terrain grid', async () => {
    rows = [ROW]
    const res = await (await app()).inject({ method: 'GET', url: '/api/plans/plan-1/brief' })

    expect(res.statusCode).toBe(200)
    const body = res.json()

    expect(body.planId).toBe('plan-1')
    expect(body.planName).toBe('Ridge Probe')
    expect(body.battleground).toMatchObject({ id: 'bg-1', width: 10, height: 10 })
    expect(body.cellSpace.origin).toBe('north-west')

    const [deployment, movement] = body.drawings
    expect(deployment).toMatchObject({
      id: 'u1',
      kind: 'deployment',
      label: 'blue platoon deployment',
      echelon: 'platoon',
    })
    expect(deployment.cell).toMatchObject({ x: 1, y: 1, index: 11 })
    expect(deployment.cell.terrain).toMatchObject({ clsName: 'Dense Forest', cover: 80 })

    expect(movement).toMatchObject({
      id: 'r1',
      kind: 'movement',
      label: 'blue movement arrow (prowl)',
    })
    expect(movement.path.map((c: { y: number }) => c.y)).toEqual([1, 2, 3, 4])
    expect(movement.corridor).toMatchObject({
      cellCount: 4,
      dominantClass: 'Dense Forest',
      crossesWater: false,
      meanCover: 80,
      meanMoveCostFactor: 2,
    })
  })

  test('404s for an unknown plan', async () => {
    rows = []
    const res = await (await app()).inject({ method: 'GET', url: '/api/plans/nope/brief' })
    expect(res.statusCode).toBe(404)
    expect(res.json<{ error: string }>()).toEqual({ error: 'unknown plan' })
  })
})
