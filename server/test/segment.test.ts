import { describe, expect, test } from 'bun:test'
import { classifySpectralPixel, spectralSegment, upsampleNearest, SEG_NONE } from '../src/services/segment'
import { reduceMosaicToCells, spectralCellMeters } from '../src/services/satellite'
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

  test('textured but bright green (e.g. farmland/scrub) → forest below the fusion gate', () => {
    const call = classifySpectralPixel(90, 130, 95, 30)
    expect(call.cls).toBe(C.FOREST)
    expect(call.conf).toBeLessThan(config.segConfidenceMin)
  })

  test('dark but smooth green (e.g. shadowed grass) → forest below the fusion gate', () => {
    const call = classifySpectralPixel(40, 60, 42, 10)
    expect(call.cls).toBe(C.FOREST)
    expect(call.conf).toBeLessThan(config.segConfidenceMin)
  })
})

describe('spectralCellMeters', () => {
  test('coarsens when the output cell is smaller than one real pixel × satellitePixelsPerCell', () => {
    // 1m output cells, ~2.4m/px achieved (roughly zoom-16 at mid-latitudes) ->
    // should widen to 2.4 * satellitePixelsPerCell, not stay at the fine 1m.
    const result = spectralCellMeters(1, 2.4)
    expect(result).toBeCloseTo(2.4 * config.satellitePixelsPerCell, 5)
  })

  test('leaves the cell size unchanged when it already fits comfortably', () => {
    // 10m output cells already comfortably exceed one real pixel -- no need to coarsen.
    const result = spectralCellMeters(10, 2.4)
    expect(result).toBe(10)
  })
})

describe('upsampleNearest', () => {
  test('stretches a coarse grid to a finer one, each destination cell mapping to its source cell', () => {
    // 2x2 source: [[1,2],[3,4]] -> upsampled 4x4 should tile each source cell 2x2.
    const src = Uint8Array.from([1, 2, 3, 4])
    const dst = upsampleNearest(src, 2, 2, 4, 4)
    expect(Array.from(dst)).toEqual([
      1, 1, 2, 2,
      1, 1, 2, 2,
      3, 3, 4, 4,
      3, 3, 4, 4,
    ])
  })

  test('returns the same array unchanged when source and destination sizes match', () => {
    const src = Uint8Array.from([5, 6, 7, 8])
    expect(upsampleNearest(src, 2, 2, 2, 2)).toBe(src)
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

  test('a confident raster read corrects an "urban" zoning polygon (not a ground-truth tag)', () => {
    const features: OsmFeatures = {
      ...emptyFeatures,
      areas: [
        {
          kind: 'urban',
          ring: [
            [103.7, 1.3],
            [103.71, 1.3],
            [103.71, 1.31],
            [103.7, 1.31],
          ],
        },
      ],
    }
    const g = buildGridChannels(bbox, W, H, CELL, flat, features, null, segAll(C.FOREST, 90))
    expect(g.cls[55]).toBe(C.FOREST)
  })

  test('an "urban" polygon still wins when neither raster source has an opinion', () => {
    const features: OsmFeatures = {
      ...emptyFeatures,
      areas: [
        {
          kind: 'urban',
          ring: [
            [103.7, 1.3],
            [103.71, 1.3],
            [103.71, 1.31],
            [103.7, 1.31],
          ],
        },
      ],
    }
    const g = buildGridChannels(bbox, W, H, CELL, flat, features, null, segAll(SEG_NONE, 0))
    expect(g.cls[55]).toBe(C.URBAN)
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
