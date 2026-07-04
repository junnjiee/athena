import type { BBox } from '../types'

const METERS_PER_DEGREE_LAT = 111_320

/** Local equirectangular projection around a reference latitude — accurate well
 *  under 0.1% at the ≤6 km scale this service accepts. */
export function metersPerDegree(latitudeDeg: number): { lat: number; lon: number } {
  return {
    lat: METERS_PER_DEGREE_LAT,
    lon: METERS_PER_DEGREE_LAT * Math.cos((latitudeDeg * Math.PI) / 180),
  }
}

export function bboxExtentMeters(bbox: BBox): { widthM: number; heightM: number } {
  const midLat = (bbox.south + bbox.north) / 2
  const mpd = metersPerDegree(midLat)
  return {
    widthM: (bbox.east - bbox.west) * mpd.lon,
    heightM: (bbox.north - bbox.south) * mpd.lat,
  }
}

/** Squared distance in meters² from point p to segment [a, b], all in [lon, lat],
 *  using a local flat projection anchored at p's latitude. */
export function pointToSegmentDistSqMeters(
  p: [number, number],
  a: [number, number],
  b: [number, number],
): number {
  const mpd = metersPerDegree(p[1])
  const ax = (a[0] - p[0]) * mpd.lon
  const ay = (a[1] - p[1]) * mpd.lat
  const bx = (b[0] - p[0]) * mpd.lon
  const by = (b[1] - p[1]) * mpd.lat
  const abx = bx - ax
  const aby = by - ay
  const lenSq = abx * abx + aby * aby
  let t = 0
  if (lenSq > 0) t = Math.max(0, Math.min(1, (-ax * abx - ay * aby) / lenSq))
  const cx = ax + t * abx
  const cy = ay + t * aby
  return cx * cx + cy * cy
}

/** Ring bbox in degrees ([lon, lat] ring). */
export function ringBBox(ring: [number, number][]): BBox {
  let west = Infinity
  let east = -Infinity
  let south = Infinity
  let north = -Infinity
  for (const [lon, lat] of ring) {
    if (lon < west) west = lon
    if (lon > east) east = lon
    if (lat < south) south = lat
    if (lat > north) north = lat
  }
  return { west, south, east, north }
}
