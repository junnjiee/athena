import { describe, expect, test } from 'bun:test'
import { LANDCOVER_NONE, matchLegendColor, rasterToLandCoverGrid } from '../src/services/landcover'
import { TERRAIN_CLASS as C } from '../src/types'

describe('WorldCover legend matching', () => {
  test('matches exact and near-tolerance legend colors, rejects out-of-tolerance/unmatched colors', () => {
    expect(matchLegendColor(0, 100, 0)).toBe(C.FOREST) // Tree cover, exact
    expect(matchLegendColor(8, 95, 5)).toBe(C.FOREST) // within tolerance
    expect(matchLegendColor(250, 0, 0)).toBe(C.URBAN) // Built-up
    expect(matchLegendColor(0, 100, 200)).toBe(C.WATER) // Permanent water
    expect(matchLegendColor(240, 150, 255)).toBe(C.GRASS) // Cropland -> GRASS
    expect(matchLegendColor(255, 255, 76)).toBe(C.GRASS) // Grassland -> GRASS
    expect(matchLegendColor(0, 207, 117)).toBe(C.WETLAND) // Mangroves -> WETLAND
    expect(matchLegendColor(0, 100, 40)).toBeNull() // 40 off on blue, out of tolerance
    expect(matchLegendColor(10, 10, 10)).toBeNull() // arbitrary unmatched color
  })
})

describe('raster to land-cover grid reduction', () => {
  test('majority-votes supersampled blocks down to one class per cell', () => {
    // 2x2 image, supersample=2 -> a single output cell; 3 of 4 sub-pixels are Tree
    // cover, 1 is noise, so the majority (Tree cover -> FOREST) should win.
    const width = 1
    const height = 1
    const supersample = 2
    const data = new Uint8Array(width * supersample * height * supersample * 4)
    const setPixel = (i: number, r: number, g: number, b: number) => {
      data[i * 4] = r
      data[i * 4 + 1] = g
      data[i * 4 + 2] = b
      data[i * 4 + 3] = 255
    }
    setPixel(0, 0, 100, 0)
    setPixel(1, 0, 100, 0)
    setPixel(2, 0, 100, 0)
    setPixel(3, 5, 5, 5)

    const grid = rasterToLandCoverGrid(
      { width: width * supersample, height: height * supersample, data },
      width,
      height,
      supersample,
    )
    expect(grid[0]).toBe(C.FOREST)
  })

  test('marks a cell LANDCOVER_NONE when no sub-pixel matches the legend', () => {
    const width = 1
    const height = 1
    const supersample = 2
    const noise = new Uint8Array(width * supersample * height * supersample * 4).fill(5)
    const grid = rasterToLandCoverGrid({ width: width * supersample, height: height * supersample, data: noise }, width, height, supersample)
    expect(grid[0]).toBe(LANDCOVER_NONE)
  })
})
