import { metersPerDegree } from './geo'
import type { BBox } from '../types'

/** Everything needed to place a lon/lat onto the terrain grid. Mirrors the
 *  header of the packed grid (see services/grid.ts). */
export interface GridGeo {
  bbox: BBox
  width: number
  height: number
  cellMeters: number
}

/** A cell of the terrain grid. `x` is the column (west → east), `y` is the row
 *  (0 = northernmost, matching the grid's row-major layout), and `index` is the
 *  offset into any of the packed channels. */
export interface GridCell {
  x: number
  y: number
  index: number
}

export interface LonLat {
  longitude: number
  latitude: number
}

/** Cell containing (lon, lat), or null when the point falls outside the bbox. */
export function cellAt(geo: GridGeo, longitude: number, latitude: number): GridCell | null {
  const { bbox, width, height } = geo
  const fx = (longitude - bbox.west) / (bbox.east - bbox.west)
  const fy = (bbox.north - latitude) / (bbox.north - bbox.south)
  if (fx < 0 || fx >= 1 || fy < 0 || fy >= 1) return null
  const x = Math.floor(fx * width)
  const y = Math.floor(fy * height)
  return { x, y, index: y * width + x }
}

/** Geographic centre of a cell — the inverse of cellAt, to within half a cell. */
export function cellCenter(geo: GridGeo, x: number, y: number): LonLat {
  const { bbox, width, height } = geo
  return {
    longitude: bbox.west + ((x + 0.5) / width) * (bbox.east - bbox.west),
    latitude: bbox.north - ((y + 0.5) / height) * (bbox.north - bbox.south),
  }
}

/** Great-circle-free distance between two lon/lat points, using the same local
 *  flat projection the rest of the service uses at this ≤6 km scale. */
export function distanceMeters(a: LonLat, b: LonLat): number {
  const mpd = metersPerDegree((a.latitude + b.latitude) / 2)
  const dx = (b.longitude - a.longitude) * mpd.lon
  const dy = (b.latitude - a.latitude) * mpd.lat
  return Math.hypot(dx, dy)
}

export function polylineLengthMeters(points: readonly LonLat[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) total += distanceMeters(points[i - 1], points[i])
  return total
}

/**
 * Ordered, de-duplicated cells a drawn polyline crosses, start → end.
 *
 * Walks each segment in steps of half a cell rather than running a Bresenham
 * line in cell space: grid cells are square in *meters*, not in degrees, so
 * stepping geographically keeps the traversal correct without special-casing
 * the lon/lat aspect ratio. Consecutive duplicates are collapsed, so a route
 * that lingers inside one cell contributes that cell exactly once.
 *
 * Points outside the bbox are skipped rather than clamped — a plan drawn past
 * the battlefield edge yields a path covering only the part over real terrain.
 */
export function rasterizePolyline(geo: GridGeo, points: readonly LonLat[]): GridCell[] {
  if (points.length === 0) return []

  const stepMeters = Math.max(geo.cellMeters / 2, 0.5)
  const path: GridCell[] = []

  const push = (cell: GridCell | null) => {
    if (!cell) return
    const last = path[path.length - 1]
    if (last && last.index === cell.index) return
    path.push(cell)
  }

  push(cellAt(geo, points[0].longitude, points[0].latitude))

  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1]
    const to = points[i]
    const steps = Math.max(1, Math.ceil(distanceMeters(from, to) / stepMeters))
    for (let s = 1; s <= steps; s++) {
      const t = s / steps
      push(
        cellAt(
          geo,
          from.longitude + (to.longitude - from.longitude) * t,
          from.latitude + (to.latitude - from.latitude) * t,
        ),
      )
    }
  }

  return path
}

/** Every in-bounds cell whose centre lies within `radiusMeters` of `center`,
 *  row-major order. Used for an objective's footprint on the ground. */
export function cellsWithinRadius(
  geo: GridGeo,
  center: LonLat,
  radiusMeters: number,
): GridCell[] {
  const { bbox, width, height } = geo
  const mpd = metersPerDegree(center.latitude)
  const lonPad = radiusMeters / mpd.lon
  const latPad = radiusMeters / mpd.lat

  // Cell-space bounding box of the disc, clamped to the grid.
  const colOf = (lon: number) =>
    Math.floor(((lon - bbox.west) / (bbox.east - bbox.west)) * width)
  const rowOf = (lat: number) =>
    Math.floor(((bbox.north - lat) / (bbox.north - bbox.south)) * height)

  const x0 = Math.max(0, colOf(center.longitude - lonPad))
  const x1 = Math.min(width - 1, colOf(center.longitude + lonPad))
  // rows grow southward, so +latPad gives the *low* row index
  const y0 = Math.max(0, rowOf(center.latitude + latPad))
  const y1 = Math.min(height - 1, rowOf(center.latitude - latPad))

  const cells: GridCell[] = []
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (distanceMeters(center, cellCenter(geo, x, y)) <= radiusMeters) {
        cells.push({ x, y, index: y * width + x })
      }
    }
  }
  return cells
}
