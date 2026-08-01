import { describe, expect, test } from 'bun:test'
import { bboxHalfExtentsM, expandBBox, photoTilesetOptions } from '../src/lib/photoTiles'
import { ENTRY_TIER, QUALITY_TIERS } from '../src/lib/frameGovernor'

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
  })

  test('zero margin is the identity', () => {
    expect(expandBBox(BBOX, 0)).toEqual(BBOX)
  })
})

describe('bboxHalfExtentsM', () => {
  test('half extents match the bbox metric size plus margin', () => {
    const { halfWidthM, halfDepthM } = bboxHalfExtentsM(BBOX, 300)
    const centerLatRad = ((BBOX.south + BBOX.north) / 2) * (Math.PI / 180)
    const expectedHalfWidth = ((BBOX.east - BBOX.west) * 111_320 * Math.cos(centerLatRad)) / 2 + 300
    const expectedHalfDepth = ((BBOX.north - BBOX.south) * 111_320) / 2 + 300
    expect(halfWidthM).toBeCloseTo(expectedHalfWidth, 6)
    expect(halfDepthM).toBeCloseTo(expectedHalfDepth, 6)
  })

  test('zero margin gives exactly half the bbox size', () => {
    const { halfDepthM } = bboxHalfExtentsM(BBOX, 0)
    expect(halfDepthM).toBeCloseTo(((BBOX.north - BBOX.south) * 111_320) / 2, 6)
  })
})

describe('photoTilesetOptions', () => {
  test('creates idle: hidden with NO standing background preload', () => {
    const options = photoTilesetOptions()
    expect(options.show).toBe(false)
    expect(options.preloadWhenHidden).toBe(false)
  })

  test('entry detail comes from the governor entry tier (coarse-first)', () => {
    expect(photoTilesetOptions().maximumScreenSpaceError).toBe(QUALITY_TIERS[ENTRY_TIER].sse)
    expect(QUALITY_TIERS[ENTRY_TIER].sse).toBeGreaterThan(QUALITY_TIERS[0].sse)
  })

  test('laptop-sized session cache (256 MiB + 128 MiB overflow)', () => {
    const options = photoTilesetOptions()
    expect(options.cacheBytes).toBe(256 * 1024 * 1024)
    expect(options.maximumCacheOverflowBytes).toBe(128 * 1024 * 1024)
    expect(options.dynamicScreenSpaceError).toBe(true)
  })
})
