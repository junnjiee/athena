import { describe, expect, test } from 'bun:test'
import {
  TILE_SIZE,
  bboxPixelRegion,
  latToPixelY,
  lonToPixelX,
  metersPerPixel,
  terrariumToMeters,
  tilesForRegion,
  zoomForResolution,
} from '../src/lib/tiles'

describe('tile math', () => {
  test('lon/lat to pixel round world anchors', () => {
    expect(lonToPixelX(-180, 0)).toBe(0)
    expect(lonToPixelX(0, 0)).toBe(TILE_SIZE / 2)
    expect(lonToPixelX(180, 0)).toBe(TILE_SIZE)
    expect(latToPixelY(0, 0)).toBeCloseTo(TILE_SIZE / 2, 6)
  })

  test('metersPerPixel halves each zoom level', () => {
    const z10 = metersPerPixel(10, 1.35)
    const z11 = metersPerPixel(11, 1.35)
    expect(z10 / z11).toBeCloseTo(2, 6)
  })

  test('zoomForResolution picks finest zoom needed, clamped to max', () => {
    // ~10 m cells near the equator need z14 (z14 ≈ 9.55 m/px)
    expect(zoomForResolution(10, 1.35, 10, 15)).toBe(14)
    // 1 m cells clamp to maxZoom
    expect(zoomForResolution(1, 1.35, 10, 15)).toBe(15)
    // very coarse cells clamp to minZoom
    expect(zoomForResolution(500, 1.35, 10, 15)).toBe(10)
  })

  test('terrarium decoding matches spec', () => {
    // sea level: (128*256 + 0 + 0) - 32768 = 0
    expect(terrariumToMeters(128, 0, 0)).toBe(0)
    expect(terrariumToMeters(128, 100, 0)).toBe(100)
    expect(terrariumToMeters(128, 0, 128)).toBeCloseTo(0.5, 6)
  })

  test('pixel region covers SAFTI-sized bbox with correct tiles', () => {
    const bbox = { west: 103.63, south: 1.34, east: 103.66, north: 1.37 }
    const region = bboxPixelRegion(bbox, 14)
    expect(region.x1).toBeGreaterThan(region.x0)
    expect(region.y1).toBeGreaterThan(region.y0)
    const tiles = tilesForRegion(region)
    expect(tiles.length).toBeGreaterThanOrEqual(1)
    expect(tiles.length).toBeLessThan(30)
    for (const t of tiles) {
      expect(t.z).toBe(14)
      expect(t.x * TILE_SIZE).toBeLessThanOrEqual(region.x1)
      expect((t.x + 1) * TILE_SIZE).toBeGreaterThanOrEqual(region.x0)
    }
  })
})
