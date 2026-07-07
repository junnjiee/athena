import { describe, expect, test } from 'bun:test'
import { classifySpectralPixel, spectralSegment, SEG_NONE } from '../src/services/segment'
import { reduceMosaicToCells } from '../src/services/satellite'
import { buildGridChannels } from '../src/services/classify'
import { config } from '../src/config'
import { TERRAIN_CLASS as C, type BBox, type OsmFeatures, type SegmentationResult } from '../src/types'

describe('spectral pixel classifier', () => {
  test('dark rough green canopy → forest, high confidence', () => {
    const call = classifySpectralPixel(30, 70, 35, 30)
    expect(call.cls).toBe(C.FOREST)
    expect(call.conf).toBeGreaterThanOrEqual(config.segConfidenceMin)
  })

  test('bright smooth green → grass', () => {
    const call = classifySpectralPixel(120, 190, 90, 6)
    expect(call.cls).toBe(C.GRASS)
    expect(call.conf).toBeGreaterThan(50)
  })

  test('blue-dominant pixel → water', () => {
    const call = classifySpectralPixel(20, 60, 120, 4)
    expect(call.cls).toBe(C.WATER)
    expect(call.conf).toBeGreaterThan(80)
  })

  test('very dark smooth pixel → water at low confidence (below fusion gate)', () => {
    const call = classifySpectralPixel(40, 45, 42, 5)
    expect(call.cls).toBe(C.WATER)
    expect(call.conf).toBeLessThan(config.segConfidenceMin)
  })

  test('warm bright low-green → barren', () => {
    const call = classifySpectralPixel(200, 170, 120, 10)
    expect(call.cls).toBe(C.BARREN)
  })

  test('heavily textured neutral gray → urban above the fusion gate', () => {
    const call = classifySpectralPixel(120, 120, 125, 40)
    expect(call.cls).toBe(C.URBAN)
    expect(call.conf).toBeGreaterThanOrEqual(config.segConfidenceMin)
    expect(call.conf).toBeLessThanOrEqual(65)
  })

  test('mildly textured gray (dirt track) stays below the fusion gate', () => {
    const call = classifySpectralPixel(120, 120, 125, 25)
    expect(call.cls).toBe(C.URBAN)
    expect(call.conf).toBeLessThan(config.segConfidenceMin)
  })

  test('saturated red (e.g. roof) → no call', () => {
    const call = classifySpectralPixel(180, 60, 50, 20)
    expect(call.cls).toBe(SEG_NONE)
    expect(call.conf).toBe(0)
  })
})

describe('mosaic block statistics', () => {
  test('uniform mosaic → cell mean equals pixel color, zero texture', () => {
    // 2°×2° bbox at zoom 0 keeps the whole mosaic tiny and easy to reason about
    const bbox: BBox = { west: 0, south: 0, east: 2, north: 2 }
    const width = 2
    const height = 2
    const px = 8
    const data = new Uint8Array(px * px * 3)
    for (let i = 0; i < px * px; i++) {
      data[i * 3] = 40
      data[i * 3 + 1] = 90
      data[i * 3 + 2] = 50
    }
    const mosaic = { zoom: 0, x0: 128, y0: 120, width: px, height: px, data }
    const cells = reduceMosaicToCells(mosaic, bbox, width, height)
    expect(cells.rgb[0]).toBe(40)
    expect(cells.rgb[1]).toBe(90)
    expect(cells.rgb[2]).toBe(50)
    expect(cells.tex[0]).toBe(0)
  })
})

describe('segmentation fusion in the classifier', () => {
  const bbox: BBox = { west: 103.7, south: 1.3, east: 103.71, north: 1.31 }
  const W = 10
  const H = 10
  const CELL = 111
  const flat = new Float32Array(W * H).fill(10)
  const emptyFeatures: OsmFeatures = { roads: [], buildings: [], areas: [], waterLines: [] }

  function segAll(cls: number, conf: number): SegmentationResult {
    return {
      cls: new Uint8Array(W * H).fill(cls),
      confidence: new Uint8Array(W * H).fill(conf),
    }
  }

  test('confident segmentation fills cells OSM leaves open', () => {
    const g = buildGridChannels(bbox, W, H, CELL, flat, emptyFeatures, null, segAll(C.FOREST, 90))
    expect(g.cls[0]).toBe(C.FOREST)
    expect(g.concealment[0]).toBeGreaterThan(70)
  })

  test('below the confidence gate, segmentation defers to the WorldCover prior', () => {
    const worldCover = new Uint8Array(W * H).fill(C.GRASS)
    const g = buildGridChannels(bbox, W, H, CELL, flat, emptyFeatures, worldCover, segAll(C.FOREST, 40))
    expect(g.cls[0]).toBe(C.GRASS)
  })

  test('confident segmentation outranks the WorldCover prior', () => {
    const worldCover = new Uint8Array(W * H).fill(C.GRASS)
    const g = buildGridChannels(bbox, W, H, CELL, flat, emptyFeatures, worldCover, segAll(C.FOREST, 90))
    expect(g.cls[0]).toBe(C.FOREST)
  })

  test('OSM area polygons always beat segmentation', () => {
    const features: OsmFeatures = {
      ...emptyFeatures,
      areas: [
        {
          kind: 'grass',
          ring: [
            [103.7, 1.3],
            [103.71, 1.3],
            [103.71, 1.31],
            [103.7, 1.31],
          ],
        },
      ],
    }
    const g = buildGridChannels(bbox, W, H, CELL, flat, features, null, segAll(C.FOREST, 95))
    expect(g.cls[55]).toBe(C.GRASS)
  })

  test('SEG_NONE cells fall through to OPEN', () => {
    const g = buildGridChannels(bbox, W, H, CELL, flat, emptyFeatures, null, segAll(SEG_NONE, 99))
    expect(g.cls[0]).toBe(C.OPEN)
  })

  test('spectralSegment maps a whole grid', () => {
    const n = 4
    const rgb = new Uint8Array(n * 3)
    const tex = new Uint8Array(n)
    // two forest cells, one water, one no-call red
    const pixels = [
      [30, 70, 35, 30],
      [25, 65, 30, 28],
      [20, 60, 120, 4],
      [180, 60, 50, 20],
    ]
    pixels.forEach(([r, g, b, t], i) => {
      rgb[i * 3] = r
      rgb[i * 3 + 1] = g
      rgb[i * 3 + 2] = b
      tex[i] = t
    })
    const out = spectralSegment({ width: 2, height: 2, rgb, tex })
    expect(out.cls[0]).toBe(C.FOREST)
    expect(out.cls[1]).toBe(C.FOREST)
    expect(out.cls[2]).toBe(C.WATER)
    expect(out.cls[3]).toBe(SEG_NONE)
  })
})
