import { describe, expect, test } from 'bun:test'
import { buildGridChannels } from '../src/services/classify'
import { TERRAIN_CLASS as C, type BBox, type OsmFeatures } from '../src/types'

// ~1.1 km square near the equator: 1 cell ≈ 111 m with a 10×10 grid
const bbox: BBox = { west: 103.7, south: 1.3, east: 103.71, north: 1.31 }
const W = 10
const H = 10
const CELL = 111

function flatHeights(value = 20): Float32Array {
  return new Float32Array(W * H).fill(value)
}

const emptyFeatures: OsmFeatures = { roads: [], buildings: [], areas: [], waterLines: [] }

function cellIndex(lon: number, lat: number): number {
  const col = Math.floor(((lon - bbox.west) / (bbox.east - bbox.west)) * W)
  const row = Math.floor(((bbox.north - lat) / (bbox.north - bbox.south)) * H)
  return row * W + col
}

describe('terrain classification', () => {
  test('empty features → everything open, walkable, exposed', () => {
    const g = buildGridChannels(bbox, W, H, CELL, flatHeights(), emptyFeatures)
    expect(g.cls.every((c) => c === C.OPEN)).toBe(true)
    expect(g.moveCost[0]).toBe(22)
    expect(g.visibility[0]).toBeGreaterThan(70)
    expect(g.slope.every((s) => s === 0)).toBe(true)
  })

  test('forest polygon classifies cells with high concealment and slow movement', () => {
    const features: OsmFeatures = {
      ...emptyFeatures,
      areas: [
        {
          kind: 'forest',
          // covers the west half of the bbox
          ring: [
            [103.7, 1.3],
            [103.705, 1.3],
            [103.705, 1.31],
            [103.7, 1.31],
          ],
        },
      ],
    }
    const g = buildGridChannels(bbox, W, H, CELL, flatHeights(), features)
    const inside = cellIndex(103.701, 1.305)
    const treeline = cellIndex(103.7045, 1.305)
    const outside = cellIndex(103.709, 1.305)
    expect(g.cls[inside]).toBe(C.FOREST)
    expect(g.cls[outside]).toBe(C.OPEN)
    expect(g.concealment[inside]).toBeGreaterThan(70)
    expect(g.moveCost[inside]).toBeGreaterThan(g.moveCost[outside])
    // the tree line bordering open ground is prime ambush terrain; deep forest is not
    expect(g.ambush[treeline]).toBeGreaterThan(50)
    expect(g.ambush[inside]).toBeLessThan(g.ambush[treeline])
  })

  test('water beats vegetation; buildings beat everything', () => {
    const ringAll: [number, number][] = [
      [103.7, 1.3],
      [103.71, 1.3],
      [103.71, 1.31],
      [103.7, 1.31],
    ]
    const features: OsmFeatures = {
      roads: [],
      waterLines: [],
      areas: [
        { kind: 'forest', ring: ringAll },
        { kind: 'water', ring: ringAll },
      ],
      buildings: [
        {
          footprint: [
            [103.7005, 1.3085],
            [103.7025, 1.3085],
            [103.7025, 1.3099],
            [103.7005, 1.3099],
          ],
          heightMeters: 12,
        },
      ],
    }
    const g = buildGridChannels(bbox, W, H, CELL, flatHeights(), features)
    expect(g.cls[cellIndex(103.706, 1.305)]).toBe(C.WATER)
    const buildingCell = cellIndex(103.7015, 1.309)
    expect(g.cls[buildingCell]).toBe(C.BUILDING)
    expect(g.cover[buildingCell]).toBeGreaterThanOrEqual(95)
    expect(g.vehicleMobility[cellIndex(103.706, 1.305)]).toBe(0)
  })

  test('road corridor overrides open ground and boosts vehicle mobility', () => {
    const features: OsmFeatures = {
      ...emptyFeatures,
      roads: [
        {
          roadClass: 'major',
          points: [
            [103.7, 1.305],
            [103.71, 1.305],
          ],
        },
      ],
    }
    const g = buildGridChannels(bbox, W, H, CELL, flatHeights(), features)
    const onRoad = cellIndex(103.705, 1.305)
    expect(g.cls[onRoad]).toBe(C.ROAD)
    expect(g.vehicleMobility[onRoad]).toBeGreaterThan(90)
    expect(g.moveCost[onRoad]).toBeLessThan(22)
  })

  test('slope raises movement cost and kills vehicle mobility', () => {
    // west→east ramp rising 60 m per cell ≈ 28° slope
    const heights = new Float32Array(W * H)
    for (let row = 0; row < H; row++) {
      for (let col = 0; col < W; col++) heights[row * W + col] = col * 60
    }
    const g = buildGridChannels(bbox, W, H, CELL, heights, emptyFeatures)
    const mid = cellIndex(103.705, 1.305)
    expect(g.slope[mid]).toBeGreaterThan(20)
    expect(g.moveCost[mid]).toBeGreaterThan(30)
    expect(g.vehicleMobility[mid]).toBeLessThan(20)
  })
})
