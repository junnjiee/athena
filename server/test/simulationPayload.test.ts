import { gunzipSync } from 'node:zlib'
import { describe, expect, test } from 'bun:test'
import {
  buildSimulationPayload,
  countSoldiers,
  encodeSimulationPayload,
  soldiersFor,
  type EnginePayload,
} from '../src/services/simulationPayload'
import { packGrid } from '../src/services/grid'
import { TERRAIN_CLASS } from '../src/types'
import type { GridChannels } from '../src/types'
import type { PlacedUnit } from '../src/db/planTypes'

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

function build(units: PlacedUnit[], objectives: EnginePayload['objectives'] = []): EnginePayload {
  return buildSimulationPayload({
    battleground: { bbox: BBOX, gridBuffer: grid() },
    plan: { units, objectives: objectives as never },
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
