import { PNG } from 'pngjs'
import { config } from '../config'
import { LruCache } from '../lib/lru'
import {
  TILE_SIZE,
  bboxPixelRegion,
  latToPixelY,
  lonToPixelX,
  terrariumToMeters,
  tilesForRegion,
  zoomForResolution,
  type TileCoord,
} from '../lib/tiles'
import type { BBox } from '../types'

/** Decoded elevation tile: TILE_SIZE² heights in meters. */
type DemTile = Float32Array

const tileCache = new LruCache<DemTile>(config.demTileCacheSize)

async function fetchDemTile(tile: TileCoord): Promise<DemTile> {
  const key = `${tile.z}/${tile.x}/${tile.y}`
  const cached = tileCache.get(key)
  if (cached) return cached

  const res = await fetch(config.demTileUrl(tile.z, tile.x, tile.y), {
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`DEM tile ${key} failed: HTTP ${res.status}`)

  const png = PNG.sync.read(Buffer.from(await res.arrayBuffer()))
  const heights = new Float32Array(TILE_SIZE * TILE_SIZE)
  for (let i = 0; i < heights.length; i++) {
    const o = i * 4
    heights[i] = terrariumToMeters(png.data[o], png.data[o + 1], png.data[o + 2])
  }
  tileCache.set(key, heights)
  return heights
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  async function worker(): Promise<void> {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

interface Mosaic {
  zoom: number
  x0: number
  y0: number
  width: number
  height: number
  data: Float32Array
}

/** Stitch all tiles covering the bbox into one flat height mosaic in global pixel space. */
async function buildMosaic(bbox: BBox, zoom: number): Promise<Mosaic> {
  const region = bboxPixelRegion(bbox, zoom)
  const tiles = tilesForRegion(region)
  const decoded = await mapWithConcurrency(tiles, config.demFetchConcurrency, fetchDemTile)

  const width = region.x1 - region.x0 + 1
  const height = region.y1 - region.y0 + 1
  const data = new Float32Array(width * height)

  tiles.forEach((tile, i) => {
    const heights = decoded[i]
    const tilePx = tile.x * TILE_SIZE
    const tilePy = tile.y * TILE_SIZE
    const colStart = Math.max(region.x0, tilePx)
    const colEnd = Math.min(region.x1, tilePx + TILE_SIZE - 1)
    const rowStart = Math.max(region.y0, tilePy)
    const rowEnd = Math.min(region.y1, tilePy + TILE_SIZE - 1)
    for (let gy = rowStart; gy <= rowEnd; gy++) {
      const srcRow = (gy - tilePy) * TILE_SIZE
      const dstRow = (gy - region.y0) * width
      for (let gx = colStart; gx <= colEnd; gx++) {
        data[dstRow + (gx - region.x0)] = heights[srcRow + (gx - tilePx)]
      }
    }
  })

  return { zoom, x0: region.x0, y0: region.y0, width, height, data }
}

function sampleBilinear(m: Mosaic, px: number, py: number): number {
  const lx = Math.min(Math.max(px - m.x0, 0), m.width - 1.001)
  const ly = Math.min(Math.max(py - m.y0, 0), m.height - 1.001)
  const x0 = Math.floor(lx)
  const y0 = Math.floor(ly)
  const fx = lx - x0
  const fy = ly - y0
  const i00 = m.data[y0 * m.width + x0]
  const i10 = m.data[y0 * m.width + x0 + 1]
  const i01 = m.data[(y0 + 1) * m.width + x0]
  const i11 = m.data[(y0 + 1) * m.width + x0 + 1]
  return i00 * (1 - fx) * (1 - fy) + i10 * fx * (1 - fy) + i01 * (1 - fx) * fy + i11 * fx * fy
}

/** Row-major (north-to-south) grid of cell-center elevations for the bbox. */
export async function buildHeightGrid(
  bbox: BBox,
  width: number,
  height: number,
  cellMeters: number,
): Promise<Float32Array> {
  const midLat = (bbox.south + bbox.north) / 2
  const zoom = zoomForResolution(cellMeters, midLat, config.demMinZoom, config.demMaxZoom)
  const mosaic = await buildMosaic(bbox, zoom)

  const heights = new Float32Array(width * height)
  const dLon = (bbox.east - bbox.west) / width
  const dLat = (bbox.north - bbox.south) / height
  for (let row = 0; row < height; row++) {
    const lat = bbox.north - (row + 0.5) * dLat
    const py = latToPixelY(lat, zoom)
    for (let col = 0; col < width; col++) {
      const lon = bbox.west + (col + 0.5) * dLon
      heights[row * width + col] = sampleBilinear(mosaic, lonToPixelX(lon, zoom), py)
    }
  }
  return heights
}

/** Builds a point sampler over the bbox at the given ground resolution.
 *
 *  `buildHeightGrid` answers "elevation of every cell"; road-graph nodes are
 *  scattered points, so this returns the lookup instead of a grid. The mosaic
 *  is fetched once and closed over, which is what makes sampling tens of
 *  thousands of junctions affordable.
 *
 *  Resolution is the DEM's own, not the road network's: at operational scale a
 *  coarse tile is all that gradient needs, and a finer one would multiply tile
 *  fetches for no routing benefit. */
export async function buildElevationSampler(
  bbox: BBox,
  resolutionMeters: number,
): Promise<(lon: number, lat: number) => number> {
  const midLat = (bbox.south + bbox.north) / 2
  const zoom = zoomForResolution(resolutionMeters, midLat, config.demMinZoom, config.demMaxZoom)
  const mosaic = await buildMosaic(bbox, zoom)

  return (lon: number, lat: number) =>
    sampleBilinear(mosaic, lonToPixelX(lon, zoom), latToPixelY(lat, zoom))
}
