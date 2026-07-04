import type { BBox } from '../types'

export const TILE_SIZE = 256
const EARTH_CIRCUMFERENCE = 40_075_016.686

/** Meters per pixel of a web-mercator tile pyramid at a given latitude/zoom. */
export function metersPerPixel(zoom: number, latitudeDeg: number): number {
  return (EARTH_CIRCUMFERENCE * Math.cos((latitudeDeg * Math.PI) / 180)) / (TILE_SIZE * 2 ** zoom)
}

/** Smallest zoom whose resolution is at least as fine as `cellMeters`, clamped to [min, max]. */
export function zoomForResolution(
  cellMeters: number,
  latitudeDeg: number,
  minZoom: number,
  maxZoom: number,
): number {
  for (let z = minZoom; z <= maxZoom; z++) {
    if (metersPerPixel(z, latitudeDeg) <= cellMeters) return z
  }
  return maxZoom
}

/** Continuous (fractional) global pixel X at zoom for a longitude. */
export function lonToPixelX(lonDeg: number, zoom: number): number {
  return ((lonDeg + 180) / 360) * TILE_SIZE * 2 ** zoom
}

/** Continuous (fractional) global pixel Y at zoom for a latitude. */
export function latToPixelY(latDeg: number, zoom: number): number {
  const latRad = (latDeg * Math.PI) / 180
  const mercN = Math.log(Math.tan(Math.PI / 4 + latRad / 2))
  return ((1 - mercN / Math.PI) / 2) * TILE_SIZE * 2 ** zoom
}

export interface PixelRegion {
  zoom: number
  /** inclusive global-pixel bounds, padded for bilinear sampling */
  x0: number
  y0: number
  x1: number
  y1: number
}

/** Global-pixel region covering a bbox at `zoom`, padded by 1px for bilinear reads. */
export function bboxPixelRegion(bbox: BBox, zoom: number): PixelRegion {
  const worldMax = TILE_SIZE * 2 ** zoom - 1
  const clamp = (v: number) => Math.min(worldMax, Math.max(0, v))
  return {
    zoom,
    x0: clamp(Math.floor(lonToPixelX(bbox.west, zoom)) - 1),
    y0: clamp(Math.floor(latToPixelY(bbox.north, zoom)) - 1),
    x1: clamp(Math.ceil(lonToPixelX(bbox.east, zoom)) + 1),
    y1: clamp(Math.ceil(latToPixelY(bbox.south, zoom)) + 1),
  }
}

export interface TileCoord {
  z: number
  x: number
  y: number
}

/** All tiles intersecting a pixel region. */
export function tilesForRegion(region: PixelRegion): TileCoord[] {
  const tx0 = Math.floor(region.x0 / TILE_SIZE)
  const tx1 = Math.floor(region.x1 / TILE_SIZE)
  const ty0 = Math.floor(region.y0 / TILE_SIZE)
  const ty1 = Math.floor(region.y1 / TILE_SIZE)
  const tiles: TileCoord[] = []
  for (let x = tx0; x <= tx1; x++) {
    for (let y = ty0; y <= ty1; y++) {
      tiles.push({ z: region.zoom, x, y })
    }
  }
  return tiles
}

/** Decode one terrarium-encoded pixel (r,g,b) to meters above sea level. */
export function terrariumToMeters(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768
}
