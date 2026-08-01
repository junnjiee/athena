import { PNG } from 'pngjs'
import jpeg from 'jpeg-js'
import { config } from '../config'
import { LruCache } from '../lib/lru'
import {
  TILE_SIZE,
  bboxPixelRegion,
  latToPixelY,
  lonToPixelX,
  metersPerPixel,
  tilesForRegion,
  zoomForResolution,
  type TileCoord,
} from '../lib/tiles'
import type { BBox } from '../types'

/** Per-cell spectral summary of the satellite raster: mean RGB plus local
 *  brightness texture (std-dev of luma inside the cell's pixel block). Texture
 *  is the cheap stand-in for canopy roughness that separates forest from
 *  smooth grass at the same greenness. */
export interface CellSpectral {
  width: number
  height: number
  /** w*h*3, row-major north-to-south, [r,g,b] per cell */
  rgb: Uint8Array
  /** w*h, std-dev of luma 0-255 */
  tex: Uint8Array
}

/** Decoded RGBA tile pixels (RGBA order, TILE_SIZE²·4). */
type RgbaTile = Uint8Array

const tileCache = new LruCache<RgbaTile>(config.satelliteTileCacheSize)

/** Esri serves JPEG for imagery but PNG for some edge tiles — sniff the magic. */
function decodeImage(buffer: Buffer): { width: number; height: number; data: Uint8Array } {
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    return jpeg.decode(buffer, { useTArray: true, maxMemoryUsageInMB: 128 })
  }
  const png = PNG.sync.read(buffer)
  return { width: png.width, height: png.height, data: new Uint8Array(png.data) }
}

async function fetchSatelliteTile(tile: TileCoord): Promise<RgbaTile> {
  const key = `${tile.z}/${tile.x}/${tile.y}`
  const cached = tileCache.get(key)
  if (cached) return cached

  const res = await fetch(config.satelliteTileUrl(tile.z, tile.x, tile.y), {
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`satellite tile ${key} failed: HTTP ${res.status}`)
  const decoded = decodeImage(Buffer.from(await res.arrayBuffer()))
  if (decoded.width !== TILE_SIZE || decoded.height !== TILE_SIZE) {
    throw new Error(`satellite tile ${key}: unexpected size ${decoded.width}x${decoded.height}`)
  }
  tileCache.set(key, decoded.data)
  return decoded.data
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

interface RgbMosaic {
  zoom: number
  x0: number
  y0: number
  width: number
  height: number
  /** width*height*3 RGB */
  data: Uint8Array
}

async function buildRgbMosaic(bbox: BBox, zoom: number): Promise<RgbMosaic> {
  const region = bboxPixelRegion(bbox, zoom)
  const tiles = tilesForRegion(region)
  const decoded = await mapWithConcurrency(tiles, config.satelliteFetchConcurrency, fetchSatelliteTile)

  const width = region.x1 - region.x0 + 1
  const height = region.y1 - region.y0 + 1
  const data = new Uint8Array(width * height * 3)

  tiles.forEach((tile, i) => {
    const pixels = decoded[i]
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
        const src = (srcRow + (gx - tilePx)) * 4
        const dst = (dstRow + (gx - region.x0)) * 3
        data[dst] = pixels[src]
        data[dst + 1] = pixels[src + 1]
        data[dst + 2] = pixels[src + 2]
      }
    }
  })

  return { zoom, x0: region.x0, y0: region.y0, width, height, data }
}

/** Pure block-statistics reduction — exported for tests. Computes each cell's
 *  mean RGB and luma std-dev from its pixel block in the mosaic. */
export function reduceMosaicToCells(
  mosaic: RgbMosaic,
  bbox: BBox,
  width: number,
  height: number,
): CellSpectral {
  const rgb = new Uint8Array(width * height * 3)
  const tex = new Uint8Array(width * height)
  const dLon = (bbox.east - bbox.west) / width
  const dLat = (bbox.north - bbox.south) / height

  for (let row = 0; row < height; row++) {
    const latN = bbox.north - row * dLat
    const latS = bbox.north - (row + 1) * dLat
    const py0 = Math.max(mosaic.y0, Math.floor(latToPixelY(latN, mosaic.zoom)))
    const py1 = Math.min(mosaic.y0 + mosaic.height - 1, Math.ceil(latToPixelY(latS, mosaic.zoom)) - 1)
    for (let col = 0; col < width; col++) {
      const lonW = bbox.west + col * dLon
      const lonE = bbox.west + (col + 1) * dLon
      const px0 = Math.max(mosaic.x0, Math.floor(lonToPixelX(lonW, mosaic.zoom)))
      const px1 = Math.min(mosaic.x0 + mosaic.width - 1, Math.ceil(lonToPixelX(lonE, mosaic.zoom)) - 1)

      let sr = 0
      let sg = 0
      let sb = 0
      let sl = 0
      let sl2 = 0
      let n = 0
      for (let py = py0; py <= py1; py++) {
        const rowBase = (py - mosaic.y0) * mosaic.width
        for (let px = px0; px <= px1; px++) {
          const o = (rowBase + (px - mosaic.x0)) * 3
          const r = mosaic.data[o]
          const g = mosaic.data[o + 1]
          const b = mosaic.data[o + 2]
          const luma = 0.299 * r + 0.587 * g + 0.114 * b
          sr += r
          sg += g
          sb += b
          sl += luma
          sl2 += luma * luma
          n++
        }
      }
      const i = row * width + col
      if (n > 0) {
        rgb[i * 3] = Math.round(sr / n)
        rgb[i * 3 + 1] = Math.round(sg / n)
        rgb[i * 3 + 2] = Math.round(sb / n)
        const variance = Math.max(0, sl2 / n - (sl / n) ** 2)
        tex[i] = Math.min(255, Math.round(Math.sqrt(variance)))
      }
    }
  }
  return { width, height, rgb, tex }
}

/** Coarsest cell size that still gets a genuine (non-sub-pixel-noisy) spectral
 *  reading -- at least one real satellite pixel × satellitePixelsPerCell, but
 *  never coarser than the requested output grid's own cell size. Exported for
 *  tests. */
export function spectralCellMeters(cellMeters: number, achievedMetersPerPixel: number): number {
  return Math.max(cellMeters, achievedMetersPerPixel * config.satellitePixelsPerCell)
}

/** Fetch the RGB satellite raster for a bbox and reduce it to per-cell spectral
 *  stats. Sampled at whatever resolution the imagery can actually back up --
 *  a cell smaller than one real pixel can't produce a meaningful texture
 *  reading, so this deliberately reduces to a coarser grid than the output
 *  simulation grid when necessary (segmentBattlefield upsamples the result
 *  back up afterward). */
export async function buildSpectralGrid(
  bbox: BBox,
  width: number,
  height: number,
  cellMeters: number,
): Promise<CellSpectral> {
  const midLat = (bbox.south + bbox.north) / 2
  const zoom = zoomForResolution(
    cellMeters / config.satellitePixelsPerCell,
    midLat,
    config.satelliteMinZoom,
    config.satelliteMaxZoom,
  )
  const achieved = metersPerPixel(zoom, midLat)
  const segCellMeters = spectralCellMeters(cellMeters, achieved)
  const segWidth = Math.max(1, Math.round((width * cellMeters) / segCellMeters))
  const segHeight = Math.max(1, Math.round((height * cellMeters) / segCellMeters))
  const mosaic = await buildRgbMosaic(bbox, zoom)
  return reduceMosaicToCells(mosaic, bbox, segWidth, segHeight)
}
