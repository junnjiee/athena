import { describe, expect, test } from 'bun:test'
import { suggestRoute } from '../src/lib/pathfind'
import { TERRAIN_CLASS as C, type GridData } from '../src/types/terrain'

const W = 40
const H = 40
// ~0.01° ≈ 1.1 km square → ~28 m cells
const BBOX = { west: 103.7, south: 1.3, east: 103.71, north: 1.31 }

function makeGrid(mutate?: (grid: GridData) => void): GridData {
  const n = W * H
  const grid: GridData = {
    bbox: BBOX,
    width: W,
    height: H,
    cellMeters: 28,
    elevation: new Float32Array(n).fill(10),
    cls: new Uint8Array(n).fill(C.OPEN),
    slope: new Uint8Array(n),
    cover: new Uint8Array(n).fill(10),
    concealment: new Uint8Array(n).fill(10),
    moveCost: new Uint8Array(n).fill(22),
    visibility: new Uint8Array(n).fill(80),
    vehicleMobility: new Uint8Array(n).fill(75),
    ambush: new Uint8Array(n),
  }
  mutate?.(grid)
  return grid
}

function lonAtCol(col: number): number {
  return BBOX.west + ((col + 0.5) / W) * (BBOX.east - BBOX.west)
}
function latAtRow(row: number): number {
  return BBOX.north - ((row + 0.5) / H) * (BBOX.north - BBOX.south)
}

const WEST_POINT = { longitude: lonAtCol(3), latitude: latAtRow(20) }
const EAST_POINT = { longitude: lonAtCol(36), latitude: latAtRow(20) }

/** column index of a route point, for asserting path shape */
function colOf(lon: number): number {
  return Math.floor(((lon - BBOX.west) / (BBOX.east - BBOX.west)) * W)
}
function rowOf(lat: number): number {
  return Math.floor(((BBOX.north - lat) / (BBOX.north - BBOX.south)) * H)
}

describe('A* route suggestion', () => {
  test('open ground: near-straight route with sane metrics', () => {
    const route = suggestRoute(makeGrid(), {
      start: WEST_POINT,
      goal: EAST_POINT,
      unitKind: 'infantry',
      lambda: 0,
    })
    expect(route).not.toBeNull()
    // ~33 cells × 28 m ≈ 920 m, staircase adds a little
    expect(route!.lengthMeters).toBeGreaterThan(850)
    expect(route!.lengthMeters).toBeLessThan(1100)
    expect(route!.etaMinutes).toBeGreaterThan(5)
    // simplification collapses a straight line to very few vertices
    expect(route!.points.length).toBeLessThan(6)
  })

  test('routes around water through the gap', () => {
    const grid = makeGrid((g) => {
      // vertical river at col 20 with a ford at row 5
      for (let row = 0; row < H; row++) {
        if (row === 5) continue
        g.cls[row * W + 20] = C.WATER
      }
    })
    const route = suggestRoute(grid, {
      start: WEST_POINT,
      goal: EAST_POINT,
      unitKind: 'infantry',
      lambda: 0,
    })
    expect(route).not.toBeNull()
    // every crossing of col 20 must happen at the ford row
    for (const p of route!.points) {
      if (colOf(p.longitude) === 20) expect(rowOf(p.latitude)).toBeLessThanOrEqual(7)
    }
  })

  test('unreachable goal returns null', () => {
    const grid = makeGrid((g) => {
      // solid moat around the goal cell
      const gc = 36
      const gr = 20
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          if (Math.abs(dr) === 2 || Math.abs(dc) === 2) g.cls[(gr + dr) * W + (gc + dc)] = C.WATER
        }
      }
    })
    expect(
      suggestRoute(grid, { start: WEST_POINT, goal: EAST_POINT, unitKind: 'infantry', lambda: 0 }),
    ).toBeNull()
  })

  test('risk dial bends the route around a kill zone', () => {
    const grid = makeGrid((g) => {
      // enemy watches a horizontal band across the direct line (rows 17-23),
      // except the far north stays unseen
      const danger = new Uint8Array(W * H)
      for (let row = 15; row < 26; row++) {
        for (let col = 10; col < 30; col++) danger[row * W + col] = 100
      }
      g.danger = danger
    })

    const fastest = suggestRoute(grid, { start: WEST_POINT, goal: EAST_POINT, unitKind: 'infantry', lambda: 0 })
    const safest = suggestRoute(grid, { start: WEST_POINT, goal: EAST_POINT, unitKind: 'infantry', lambda: 1 })
    expect(fastest).not.toBeNull()
    expect(safest).not.toBeNull()

    // λ=0 charges straight through; λ=1 goes the long way around and is cleaner
    expect(safest!.lengthMeters).toBeGreaterThan(fastest!.lengthMeters)
    expect(safest!.exposure).toBeLessThan(fastest!.exposure)
    expect(safest!.exposure).toBeLessThan(0.1)
    expect(fastest!.exposure).toBeGreaterThan(0.4)
  })

  test('mechanized units refuse no-go cells that infantry accepts', () => {
    const grid = makeGrid((g) => {
      // dense forest wall: passable on foot (slow), vehicleMobility 0
      for (let row = 0; row < H; row++) {
        g.cls[row * W + 20] = C.FOREST
        g.moveCost[row * W + 20] = 42
        g.vehicleMobility[row * W + 20] = 0
      }
    })
    const foot = suggestRoute(grid, { start: WEST_POINT, goal: EAST_POINT, unitKind: 'infantry', lambda: 0 })
    const tracks = suggestRoute(grid, { start: WEST_POINT, goal: EAST_POINT, unitKind: 'mechanized', lambda: 0 })
    expect(foot).not.toBeNull()
    expect(tracks).toBeNull()
  })
})
