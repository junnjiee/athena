import { describe, expect, test } from 'bun:test'
import { estimateMovement, pandolfWatts, slopeSpeedFactor, weatherFactors } from '../src/lib/movement'
import { DEFAULT_LOADOUT, loadoutFromPreset } from '../src/types/movement'
import { TERRAIN_CLASS as C, type GridData, type Weather } from '../src/types/terrain'
import type { LonLat } from '../src/types/entities'

const W = 40
const H = 40
const BBOX = { west: 103.7, south: 1.3, east: 103.71, north: 1.31 }

function makeGrid(mutate?: (g: GridData) => void): GridData {
  const n = W * H
  const g: GridData = {
    bbox: BBOX,
    width: W,
    height: H,
    cellMeters: 28,
    elevation: new Float32Array(n).fill(10),
    cls: new Uint8Array(n).fill(C.OPEN),
    slope: new Uint8Array(n),
    cover: new Uint8Array(n),
    concealment: new Uint8Array(n),
    moveCost: new Uint8Array(n).fill(22),
    visibility: new Uint8Array(n),
    vehicleMobility: new Uint8Array(n).fill(75),
    ambush: new Uint8Array(n),
  }
  mutate?.(g)
  return g
}

const lon = (col: number) => BBOX.west + ((col + 0.5) / W) * (BBOX.east - BBOX.west)
const lat = (row: number) => BBOX.north - ((row + 0.5) / H) * (BBOX.north - BBOX.south)
const WEST: LonLat = { longitude: lon(3), latitude: lat(20) }
const EAST: LonLat = { longitude: lon(36), latitude: lat(20) }

describe('slopeSpeedFactor (Tobler)', () => {
  test('flat ground is the 1.0 reference', () => {
    expect(slopeSpeedFactor(0, false)).toBeCloseTo(1, 5)
  })
  test('gentle downhill is faster than flat', () => {
    expect(slopeSpeedFactor(3, true)).toBeGreaterThan(1)
  })
  test('steep uphill is much slower', () => {
    expect(slopeSpeedFactor(30, false)).toBeLessThan(0.4)
  })
})

describe('pandolfWatts', () => {
  test('heavier load costs more energy', () => {
    const light = pandolfWatts(75, 10, 1.4, 0, 1.1)
    const heavy = pandolfWatts(75, 40, 1.4, 0, 1.1)
    expect(heavy).toBeGreaterThan(light)
  })
  test('uphill costs more than flat', () => {
    const flat = pandolfWatts(75, 25, 1.4, 0, 1.1)
    const up = pandolfWatts(75, 25, 1.4, 15, 1.1)
    expect(up).toBeGreaterThan(flat)
  })
  test('never below resting metabolism', () => {
    expect(pandolfWatts(75, 0, 0, -20, 1.0)).toBeGreaterThanOrEqual(1.2 * 75)
  })
})

describe('weatherFactors', () => {
  test('no weather → neutral', () => {
    expect(weatherFactors(null)).toEqual({ speed: 1, energy: 1 })
  })
  test('rain slows and tires', () => {
    const w: Weather = {
      temperatureC: 20, windSpeedKmh: 5, windDirectionDeg: 0, cloudCoverPct: 80,
      precipitationMm: 4, visibilityM: 8000, isDay: true,
    }
    const f = weatherFactors(w)
    expect(f.speed).toBeLessThan(1)
    expect(f.energy).toBeGreaterThan(1)
  })
})

describe('estimateMovement', () => {
  test('rush is faster but burns more energy than prowl over the same ground', () => {
    const grid = makeGrid()
    const rush = estimateMovement([WEST, EAST], 'rush', DEFAULT_LOADOUT, grid, null)
    const prowl = estimateMovement([WEST, EAST], 'prowl', DEFAULT_LOADOUT, grid, null)
    expect(rush.distanceM).toBeCloseTo(prowl.distanceM, 0)
    expect(rush.durationMin).toBeLessThan(prowl.durationMin)
    expect(rush.energyKJ).toBeGreaterThan(prowl.energyKJ)
  })

  test('slope raises time, energy, and terrain penalty', () => {
    const flat = makeGrid()
    const hill = makeGrid((g) => g.slope.fill(25))
    const onFlat = estimateMovement([WEST, EAST], 'march', DEFAULT_LOADOUT, flat, null)
    const onHill = estimateMovement([WEST, EAST], 'march', DEFAULT_LOADOUT, hill, null)
    expect(onHill.durationMin).toBeGreaterThan(onFlat.durationMin)
    expect(onHill.energyKJ).toBeGreaterThan(onFlat.energyKJ)
    expect(onHill.terrainPenaltyPct).toBeGreaterThan(onFlat.terrainPenaltyPct)
  })

  test('heavier loadout raises energy and fatigue', () => {
    const grid = makeGrid()
    const light = estimateMovement([WEST, EAST], 'march', loadoutFromPreset('light'), grid, null)
    const approach = estimateMovement([WEST, EAST], 'march', loadoutFromPreset('approach'), grid, null)
    expect(approach.energyKJ).toBeGreaterThan(light.energyKJ)
    expect(approach.fatigueIndex).toBeGreaterThanOrEqual(light.fatigueIndex)
  })

  test('forest terrain costs more energy than open ground', () => {
    const open = makeGrid()
    const forest = makeGrid((g) => g.cls.fill(C.FOREST))
    const onOpen = estimateMovement([WEST, EAST], 'march', DEFAULT_LOADOUT, open, null)
    const onForest = estimateMovement([WEST, EAST], 'march', DEFAULT_LOADOUT, forest, null)
    expect(onForest.energyKJ).toBeGreaterThan(onOpen.energyKJ)
  })

  test('fatigue index stays within 0–100', () => {
    const grid = makeGrid((g) => g.slope.fill(35))
    const e = estimateMovement([WEST, EAST], 'crawl', loadoutFromPreset('approach'), grid, null)
    expect(e.fatigueIndex).toBeGreaterThanOrEqual(0)
    expect(e.fatigueIndex).toBeLessThanOrEqual(100)
  })

  test('degrades gracefully with no grid (flat clear assumption)', () => {
    const e = estimateMovement([WEST, EAST], 'march', DEFAULT_LOADOUT, null, null)
    expect(e.distanceM).toBeGreaterThan(0)
    expect(e.durationMin).toBeGreaterThan(0)
    expect(e.terrainPenaltyPct).toBe(0)
  })
})
