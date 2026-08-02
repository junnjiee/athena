import { describe, expect, test } from 'bun:test'
import {
  cellAt,
  cellCenter,
  cellsWithinRadius,
  distanceMeters,
  polylineLengthMeters,
  rasterizePolyline,
  type GridGeo,
} from '../src/lib/cells'

/** 10×10 grid on a 0.001° square at the equator — 111.32 m a side, so each
 *  cell is 11.132 m, and lon/lat degrees convert at the same rate. */
const GEO: GridGeo = {
  bbox: { west: 0, south: 0, east: 0.001, north: 0.001 },
  width: 10,
  height: 10,
  cellMeters: 11.132,
}

describe('cellAt', () => {
  test('the north-west corner is cell (0, 0)', () => {
    expect(cellAt(GEO, 0, 0.001)).toEqual({ x: 0, y: 0, index: 0 })
  })

  test('rows grow southward, columns eastward', () => {
    // just inside the south-east corner
    expect(cellAt(GEO, 0.00099, 0.00001)).toEqual({ x: 9, y: 9, index: 99 })
    expect(cellAt(GEO, 0.00099, 0.00099)).toEqual({ x: 9, y: 0, index: 9 })
    expect(cellAt(GEO, 0.00001, 0.00001)).toEqual({ x: 0, y: 9, index: 90 })
  })

  test('points outside the bbox have no cell', () => {
    expect(cellAt(GEO, -0.0001, 0.0005)).toBeNull()
    expect(cellAt(GEO, 0.0011, 0.0005)).toBeNull()
    expect(cellAt(GEO, 0.0005, 0.0011)).toBeNull()
    expect(cellAt(GEO, 0.0005, -0.0001)).toBeNull()
  })
})

describe('cellCenter', () => {
  test('round-trips back through cellAt for every cell', () => {
    for (let y = 0; y < GEO.height; y++) {
      for (let x = 0; x < GEO.width; x++) {
        const center = cellCenter(GEO, x, y)
        expect(cellAt(GEO, center.longitude, center.latitude)).toEqual({
          x,
          y,
          index: y * GEO.width + x,
        })
      }
    }
  })

  test('neighbouring cell centres are one cell apart on the ground', () => {
    expect(distanceMeters(cellCenter(GEO, 4, 5), cellCenter(GEO, 5, 5))).toBeCloseTo(11.132, 2)
    expect(distanceMeters(cellCenter(GEO, 5, 4), cellCenter(GEO, 5, 5))).toBeCloseTo(11.132, 2)
  })
})

describe('rasterizePolyline', () => {
  test('an eastward line crosses every column of its row exactly once', () => {
    const path = rasterizePolyline(GEO, [cellCenter(GEO, 0, 5), cellCenter(GEO, 9, 5)])
    expect(path.map((c) => c.x)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(path.every((c) => c.y === 5)).toBe(true)
  })

  test('a route lingering inside one cell contributes that cell once', () => {
    const center = cellCenter(GEO, 3, 3)
    const nudge = { longitude: center.longitude + 0.000001, latitude: center.latitude }
    const path = rasterizePolyline(GEO, [center, nudge, center])
    expect(path).toEqual([{ x: 3, y: 3, index: 33 }])
  })

  test('keeps drawing order, start → end', () => {
    const forward = rasterizePolyline(GEO, [cellCenter(GEO, 0, 0), cellCenter(GEO, 0, 9)])
    expect(forward.map((c) => c.y)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    const backward = rasterizePolyline(GEO, [cellCenter(GEO, 0, 9), cellCenter(GEO, 0, 0)])
    expect(backward.map((c) => c.y)).toEqual([9, 8, 7, 6, 5, 4, 3, 2, 1, 0])
  })

  test('covers only the in-bounds part of a route drawn past the edge', () => {
    const path = rasterizePolyline(GEO, [
      { longitude: -0.0005, latitude: 0.00055 },
      cellCenter(GEO, 2, 4),
    ])
    expect(path.length).toBeGreaterThan(0)
    expect(path[0].x).toBe(0)
    expect(path[path.length - 1]).toEqual({ x: 2, y: 4, index: 42 })
  })

  test('an empty drawing has no path', () => {
    expect(rasterizePolyline(GEO, [])).toEqual([])
  })
})

describe('cellsWithinRadius', () => {
  test('a radius under half a cell covers only the centre cell', () => {
    expect(cellsWithinRadius(GEO, cellCenter(GEO, 5, 5), 3)).toEqual([{ x: 5, y: 5, index: 55 }])
  })

  test('a one-cell radius covers the centre plus its four orthogonal neighbours', () => {
    // 11.13 m to an orthogonal neighbour, 15.74 m to a diagonal one
    const cells = cellsWithinRadius(GEO, cellCenter(GEO, 5, 5), 12)
    expect(cells.map((c) => `${c.x},${c.y}`).sort()).toEqual(['4,5', '5,4', '5,5', '5,6', '6,5'])
  })

  test('clamps to the grid when the disc runs off the edge', () => {
    const cells = cellsWithinRadius(GEO, cellCenter(GEO, 0, 0), 12)
    expect(cells.map((c) => `${c.x},${c.y}`).sort()).toEqual(['0,0', '0,1', '1,0'])
  })
})

describe('polylineLengthMeters', () => {
  test('sums segment lengths', () => {
    const length = polylineLengthMeters([
      cellCenter(GEO, 0, 5),
      cellCenter(GEO, 9, 5),
      cellCenter(GEO, 9, 8),
    ])
    expect(length).toBeCloseTo(12 * 11.132, 1)
  })

  test('a single point has no length', () => {
    expect(polylineLengthMeters([cellCenter(GEO, 1, 1)])).toBe(0)
  })
})
