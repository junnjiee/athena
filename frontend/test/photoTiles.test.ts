import { describe, expect, test } from 'bun:test'
import { COARSE_SSE, SHARP_SSE, expandBBox, photoTilesetOptions } from '../src/lib/photoTiles'

const BBOX = { west: 103.7, south: 1.3, east: 103.74, north: 1.33 }

describe('expandBBox', () => {
  test('grows all four edges outward', () => {
    const grown = expandBBox(BBOX, 300)
    expect(grown.west).toBeLessThan(BBOX.west)
    expect(grown.east).toBeGreaterThan(BBOX.east)
    expect(grown.south).toBeLessThan(BBOX.south)
    expect(grown.north).toBeGreaterThan(BBOX.north)
  })

  test('margin converts to roughly the right metric size near the equator', () => {
    const grown = expandBBox(BBOX, 300)
    const dLatMeters = (BBOX.south - grown.south) * 111_320
    expect(dLatMeters).toBeCloseTo(300, 0)
    const centerLatRad = ((BBOX.south + BBOX.north) / 2) * (Math.PI / 180)
    const dLonMeters = (BBOX.west - grown.west) * 111_320 * Math.cos(centerLatRad)
    expect(dLonMeters).toBeCloseTo(300, 0)
  })

  test('zero margin is the identity', () => {
    expect(expandBBox(BBOX, 0)).toEqual(BBOX)
  })
})

describe('photoTilesetOptions', () => {
  test('warms hidden with a coarse-first streaming profile', () => {
    const options = photoTilesetOptions()
    expect(options.show).toBe(false)
    expect(options.preloadWhenHidden).toBe(true)
    expect(options.maximumScreenSpaceError).toBe(COARSE_SSE)
    expect(options.dynamicScreenSpaceError).toBe(true)
    expect(COARSE_SSE).toBeGreaterThan(SHARP_SSE)
  })

  test('raises the session tile cache to 1 GiB', () => {
    expect(photoTilesetOptions().cacheBytes).toBe(1024 * 1024 * 1024)
  })
})
