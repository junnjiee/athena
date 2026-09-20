import type { RoadGraph } from '../types/routeStudy'

/** Grid cell side in degrees (~1.1 km at the equator). Coarse enough that a
 *  theater-scale graph fits a few thousand cells; fine enough that a hover
 *  query touches a handful of segments rather than the whole network. */
const CELL_DEGREES = 0.01

interface Segment {
  wayId: number
  edgeId: string
  a: [number, number]
  b: [number, number]
}

export interface RoadIndex {
  cells: Map<string, Segment[]>
}

export interface RoadHit {
  wayId: number
  edgeId: string
  distanceMeters: number
  /** Nearest point on the road, lon/lat. */
  point: [number, number]
}

const cellKey = (x: number, y: number) => `${x}:${y}`
const cellOf = (value: number) => Math.floor(value / CELL_DEGREES)

/** Buckets every road segment by the grid cells its bounding box touches, so a
 *  nearest-road query only measures segments near the cursor. The road
 *  primitive itself is deliberately unpickable -- picking tens of thousands of
 *  ground polylines is what made the layer affordable to draw at all -- so
 *  this is how a click on the map finds a road. */
export function buildRoadIndex(graph: RoadGraph): RoadIndex {
  const cells = new Map<string, Segment[]>()
  for (const edge of graph.edges) {
    for (let i = 1; i < edge.points.length; i++) {
      const a = edge.points[i - 1]
      const b = edge.points[i]
      const segment: Segment = { wayId: edge.wayId, edgeId: edge.id, a, b }
      const x0 = cellOf(Math.min(a[0], b[0]))
      const x1 = cellOf(Math.max(a[0], b[0]))
      const y0 = cellOf(Math.min(a[1], b[1]))
      const y1 = cellOf(Math.max(a[1], b[1]))
      for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
          const key = cellKey(x, y)
          const bucket = cells.get(key)
          if (bucket) bucket.push(segment)
          else cells.set(key, [segment])
        }
      }
    }
  }
  return { cells }
}

function metersPerDegree(latitude: number) {
  return { lon: 111_320 * Math.cos((latitude * Math.PI) / 180), lat: 111_320 }
}

/** Closest point on segment ab to p, in a local metres frame at p's latitude. */
function project(p: [number, number], a: [number, number], b: [number, number], mpd: { lon: number; lat: number }) {
  const ax = (a[0] - p[0]) * mpd.lon
  const ay = (a[1] - p[1]) * mpd.lat
  const bx = (b[0] - p[0]) * mpd.lon
  const by = (b[1] - p[1]) * mpd.lat
  const dx = bx - ax
  const dy = by - ay
  const lengthSq = dx * dx + dy * dy
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / lengthSq))
  const x = ax + t * dx
  const y = ay + t * dy
  return {
    distanceMeters: Math.hypot(x, y),
    point: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])] as [number, number],
  }
}

export function nearestRoad(
  index: RoadIndex,
  lon: number,
  lat: number,
  toleranceMeters: number,
): RoadHit | null {
  const mpd = metersPerDegree(lat)
  const ringX = Math.ceil(toleranceMeters / mpd.lon / CELL_DEGREES)
  const ringY = Math.ceil(toleranceMeters / mpd.lat / CELL_DEGREES)
  const cx = cellOf(lon)
  const cy = cellOf(lat)
  let best: RoadHit | null = null
  const seen = new Set<Segment>()
  for (let x = cx - ringX; x <= cx + ringX; x++) {
    for (let y = cy - ringY; y <= cy + ringY; y++) {
      const bucket = index.cells.get(cellKey(x, y))
      if (!bucket) continue
      for (const segment of bucket) {
        if (seen.has(segment)) continue
        seen.add(segment)
        const { distanceMeters, point } = project([lon, lat], segment.a, segment.b, mpd)
        if (distanceMeters > toleranceMeters) continue
        if (
          !best ||
          distanceMeters < best.distanceMeters ||
          (distanceMeters === best.distanceMeters && segment.edgeId < best.edgeId)
        ) {
          best = { wayId: segment.wayId, edgeId: segment.edgeId, distanceMeters, point }
        }
      }
    }
  }
  return best
}
