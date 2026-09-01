import { gunzipSync } from 'node:zlib'
import { describe, expect, test } from 'bun:test'
import {
  buildSimulationPayload,
  countAgents,
  countSoldiers,
  encodeSimulationPayload,
  soldiersFor,
  type EnginePayload,
} from '../src/services/simulationPayload'
import { packGrid } from '../src/services/grid'
import { TERRAIN_CLASS } from '../src/types'
import type { GridChannels } from '../src/types'
import type { PlacedRoute, PlacedUnit } from '../src/db/planTypes'

const BBOX = { west: 0, south: 0, east: 0.01, north: 0.01 }

/** 2×2 grid with a distinct class and elevation per cell. */
function grid(): Buffer {
  const n = 4
  const channels: GridChannels = {
    height: Float32Array.from([10.123456, 11.5, 12, 13.987654]),
    cls: Uint8Array.from([
      TERRAIN_CLASS.OPEN,
      TERRAIN_CLASS.FOREST,
      TERRAIN_CLASS.WATER,
      TERRAIN_CLASS.ROAD,
    ]),
    slope: new Uint8Array(n),
    cover: new Uint8Array(n),
    concealment: new Uint8Array(n),
    moveCost: new Uint8Array(n),
    visibility: new Uint8Array(n),
    vehicleMobility: new Uint8Array(n),
    ambush: new Uint8Array(n),
  }
  return packGrid(channels, 2, 2, 1)
}

function unit(overrides: Partial<PlacedUnit> = {}): PlacedUnit {
  return {
    id: 'unit-1',
    side: 'blue',
    name: 'Alpha',
    typeLabel: 'Rifle Platoon',
    position: { longitude: 0.005, latitude: 0.005 },
    symbolKind: 'bluePlatoon',
    rotationRadians: 0,
    ...overrides,
  }
}

function build(
  units: PlacedUnit[],
  objectives: EnginePayload['objectives'] = [],
  routes: PlacedRoute[] = [],
  isDay: boolean | null = null,
): EnginePayload {
  return buildSimulationPayload({
    battleground: { bbox: BBOX, gridBuffer: grid(), isDay },
    plan: { units, objectives: objectives as never, routes },
  })
}

describe('establishment expansion', () => {
  test('a platoon of 21 becomes 21 soldiers, not one marker', () => {
    const payload = build([unit({ strength: 21 })])

    expect(payload.units).toHaveLength(21)
    expect(new Set(payload.units.map((u) => u.id)).size).toBe(21)
    expect(payload.units[0].name).toBe('Alpha 1')
    expect(payload.units[20].name).toBe('Alpha 21')
  })

  test('every soldier starts at the marker, leaving the engine to spread them', () => {
    const payload = build([unit({ strength: 4 })])

    for (const soldier of payload.units) {
      expect(soldier.position).toEqual({ longitude: 0.005, latitude: 0.005 })
      expect(soldier.side).toBe('blue')
    }
  })

  test('a marker with no establishment stays one soldier under its own id', () => {
    const payload = build([unit()])

    expect(payload.units).toHaveLength(1)
    expect(payload.units[0].id).toBe('unit-1')
    expect(payload.units[0].name).toBe('Alpha')
  })

  test('a fortification contributes its single occupant, not an establishment', () => {
    // Trenches carry no template, and the engine cannot represent the works
    // themselves -- one holder keeps the position occupied rather than leaving a
    // hole in the defence.
    expect(soldiersFor(unit({ symbolKind: 'trench', strength: 21 }))).toBe(1)
    expect(soldiersFor(unit({ symbolKind: 'preparedTrench' }))).toBe(1)
  })

  test('counts soldiers across the whole plan, which is what the cost ceiling gates', () => {
    expect(
      countSoldiers([
        unit({ id: 'a', strength: 21 }),
        unit({ id: 'b', side: 'red', strength: 7 }),
        unit({ id: 'c', symbolKind: 'trench' }),
      ]),
    ).toBe(29)
  })
})

describe('terrain projection', () => {
  test('carries the grid through row-major with dimensions from the buffer', () => {
    const { terrain } = build([])

    expect(terrain.width).toBe(2)
    expect(terrain.height).toBe(2)
    expect(terrain.cellMeters).toBe(1)
    expect(terrain.bbox).toEqual(BBOX)
    expect(terrain.cells.cls).toEqual([
      TERRAIN_CLASS.OPEN,
      TERRAIN_CLASS.FOREST,
      TERRAIN_CLASS.WATER,
      TERRAIN_CLASS.ROAD,
    ])
    expect(terrain.cells.elevation).toHaveLength(4)
  })

  test('rounds elevation to centimetres, well inside what the engine quantizes away', () => {
    const { terrain } = build([])

    expect(terrain.cells.elevation[0]).toBe(10.12)
    expect(terrain.cells.elevation[3]).toBe(13.99)
  })

  test('sends class names so a renumbering on either side fails loudly', () => {
    // The engine asserts these against its own TerrainClass and 422s on a
    // mismatch, which is the point -- silence here would load forest as scrub.
    const { terrain } = build([])

    expect(terrain.classNames[TERRAIN_CLASS.FOREST]).toBe('Dense Forest')
    expect(terrain.classNames[TERRAIN_CLASS.BUILDING]).toBe('Structure')
  })
})

describe('encoding', () => {
  test('gzips to JSON the engine can round-trip', () => {
    const payload = build([unit({ strength: 2 })])
    const encoded = encodeSimulationPayload(payload)

    // The engine sniffs the gzip magic bytes rather than trusting the filename.
    expect(encoded[0]).toBe(0x1f)
    expect(encoded[1]).toBe(0x8b)
    expect(JSON.parse(gunzipSync(encoded).toString('utf8'))).toEqual(payload)
  })
})

describe('the drawn plan reaching the engine', () => {
  const route: PlacedRoute = {
    id: 'route-1',
    side: 'blue',
    startUnitId: 'unit-1',
    points: [
      { longitude: 0.001, latitude: 0.001 },
      { longitude: 0.009, latitude: 0.009 },
    ],
    endRef: null,
    movementType: 'prowl',
    loadout: { bodyMassKg: 80, loadMassKg: 25, preset: 'fighting' },
  }

  test("a marker's route is carried by every soldier expanded from it", () => {
    // The arrow was drawn for the establishment, so all 21 men follow it. A
    // route on only the first soldier would send one man forward alone.
    const payload = build([unit({ strength: 21 })], [], [route])

    expect(payload.units).toHaveLength(21)
    for (const soldier of payload.units) {
      expect(soldier.route).toEqual(route.points)
      expect(soldier.movementType).toBe('prowl')
    }
  })

  test('a unit with no route drawn sends no route field at all', () => {
    // Absent rather than empty: the engine treats a missing route as "no axis
    // given" and falls back to the objective, which an empty list would not.
    const payload = build([unit({ id: 'other-unit' })], [], [route])

    expect(payload.units[0].route).toBeUndefined()
    expect(payload.units[0].movementType).toBeUndefined()
  })

  test('a route with a single point is not an axis and is dropped', () => {
    const payload = build(
      [unit()],
      [],
      [{ ...route, points: [{ longitude: 0.001, latitude: 0.001 }] }],
    )

    expect(payload.units[0].route).toBeUndefined()
  })

  test("an objective's side reaches the engine so it knows who is taking it", () => {
    const payload = build([unit()], [
      {
        id: 'obj-1',
        name: 'OBJ BRAVO',
        description: 'the crossroads',
        position: { longitude: 0.005, latitude: 0.005 },
        radiusMeters: 25,
        side: 'blue',
      },
    ] as never)

    expect(payload.objectives[0].side).toBe('blue')
  })

  test('an objective drawn before sides existed stays contested', () => {
    const payload = build([unit()], [
      {
        id: 'obj-1',
        name: 'OBJ ALPHA',
        description: '',
        position: { longitude: 0.005, latitude: 0.005 },
        radiusMeters: 25,
      },
    ] as never)

    expect('side' in payload.objectives[0]).toBe(false)
  })
})

describe('ground the commander made rather than found', () => {
  test('a trench marker becomes protective terrain, not just a man in a hole', () => {
    // A fortification used to reach the engine as one soldier standing on
    // whatever the classifier decided that cell was, so the works did nothing.
    const payload = build([unit({ symbolKind: 'trench' })])

    expect(payload.terrain.overrides?.length).toBeGreaterThan(0)
    expect(payload.terrain.overrides?.every((o) => o.cls === 10)).toBe(true)
    // The class grid itself is untouched: the numbering stays a straight
    // contract with the terrain pipeline, which never emits a trench.
    expect(payload.terrain.cells.cls).not.toContain(10)
  })

  test('a plan with no fortifications sends no overrides at all', () => {
    expect(build([unit()]).terrain.overrides).toBeUndefined()
  })

  test("an establishment's vision range reaches every soldier expanded from it", () => {
    const payload = build([unit({ strength: 4, visionRangeM: 500 })])

    expect(payload.units).toHaveLength(4)
    expect(payload.units.every((s) => s.visionRangeM === 500)).toBe(true)
  })

  test('a plan drawn over night ground says so', () => {
    expect(build([unit()], [], [], false).isDay).toBe(false)
    expect(build([unit()], [], [], true).isDay).toBe(true)
    // Absent rather than defaulted: the engine treats a missing flag as daytime,
    // and a battleground whose pipeline recorded no weather has no opinion.
    expect('isDay' in build([unit()])).toBe(false)
  })
})

describe('sections and who pays for them', () => {
  test('a 21-man platoon becomes three sections, not one commander of twenty', () => {
    // A rifle section is seven men under one commander and a platoon is three of
    // them. Only commanders make a model call, so this is the difference between
    // 21 calls a tick and 3.
    const payload = build([unit({ strength: 21 })])
    const commanders = payload.units.filter((s) => s.commander)

    expect(payload.units).toHaveLength(21)
    expect(commanders).toHaveLength(3)
    expect(new Set(payload.units.map((s) => s.sectionId)).size).toBe(3)
    expect(countAgents([unit({ strength: 21 })])).toBe(3)
  })

  test('every soldier belongs to exactly one section, and each has one commander', () => {
    const payload = build([unit({ strength: 21 })])
    const bySection = new Map<string, number>()
    for (const soldier of payload.units.filter((s) => s.commander)) {
      bySection.set(soldier.sectionId!, (bySection.get(soldier.sectionId!) ?? 0) + 1)
    }

    expect(payload.units.every((s) => s.sectionId)).toBe(true)
    expect([...bySection.values()]).toEqual([1, 1, 1])
  })

  test('a lone marker commands itself', () => {
    const payload = build([unit()])

    expect(payload.units[0].commander).toBe(true)
    expect(payload.units[0].sectionId).toBe('unit-1')
    expect(countAgents([unit()])).toBe(1)
  })

  test('a part-strength section still gets a commander', () => {
    // Four men is not a full section but still needs someone deciding.
    expect(countAgents([unit({ strength: 4 })])).toBe(1)
    expect(countAgents([unit({ strength: 8 })])).toBe(2)
  })
})
