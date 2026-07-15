import { describe, expect, test } from 'bun:test'
import { makeTopoProjection } from '../src/lib/topoProjection'
import { TERRAIN_CLASS as C, type GridData } from '../src/types/terrain'

const BBOX = { west: 103.7, south: 1.3, east: 103.74, north: 1.33 }

function makeGrid(): GridData {
  const width = 40
  const height = 30
  const n = width * height
  return {
    bbox: BBOX,
    width,
    height,
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
}

describe('unprojectXY', () => {
  test('maps canvas corners back to the bbox corners', () => {
    const { unprojectXY } = makeTopoProjection(makeGrid(), 800, 600)
    expect(unprojectXY(0, 0)).toEqual([BBOX.west, BBOX.north])
    expect(unprojectXY(800, 600)).toEqual([BBOX.east, BBOX.south])
  })

  test('round-trips projectLonLat within float precision', () => {
    const { projectLonLat, unprojectXY } = makeTopoProjection(makeGrid(), 800, 600)
    const lon = 103.7123
    const lat = 1.3211
    const [x, y] = projectLonLat(lon, lat)
    const [lon2, lat2] = unprojectXY(x, y)
    expect(lon2).toBeCloseTo(lon, 9)
    expect(lat2).toBeCloseTo(lat, 9)
  })
})
