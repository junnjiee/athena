import { metersPerDegree } from '../lib/geo'
import type {
  GraphEdge,
  GraphNode,
  MountedRoadClass,
  OverpassWay,
  RoadGraph,
} from '../types'

const MOUNTED_CLASSES = new Set<string>([
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'residential',
  'unclassified',
  'service',
  'living_street',
  'track',
])

/** The drivable class of a way, or null if a vehicle has no business on it.
 *  Link roads inherit their parent class: a motorway slip road is a motorway. */
export function mountedRoadClass(
  tags: Record<string, string> | undefined,
): MountedRoadClass | null {
  const highway = tags?.highway
  if (!highway) return null
  const base = highway.endsWith('_link') ? highway.slice(0, -'_link'.length) : highway
  return MOUNTED_CLASSES.has(base) ? (base as MountedRoadClass) : null
}

/** Metres between two [lon, lat] points, projected at the latitude of the
 *  segment itself. Anchoring per segment rather than per area keeps the
 *  equirectangular approximation honest across an operational-scale box. */
function segmentMeters(a: [number, number], b: [number, number]): number {
  const mpd = metersPerDegree((a[1] + b[1]) / 2)
  const dx = (b[0] - a[0]) * mpd.lon
  const dy = (b[1] - a[1]) * mpd.lat
  return Math.sqrt(dx * dx + dy * dy)
}

/** Builds a routable graph from Overpass ways.
 *
 *  A node becomes a graph node when it terminates a way or is visited more than
 *  once across all drivable ways — the second case covering both a shared
 *  junction and a way that crosses itself. Ways then split at those nodes,
 *  and everything between two of them is one edge that retains its shape.
 *
 *  Only drivable ways participate, so a footpath meeting a road mid-span is not
 *  a junction: nothing mounted can turn there. */
export function buildRoadGraph(ways: OverpassWay[]): RoadGraph {
  const drivable: { way: OverpassWay; roadClass: MountedRoadClass }[] = []
  for (const way of ways) {
    const roadClass = mountedRoadClass(way.tags)
    // Overpass returns geometry aligned with node refs; a mismatch means we
    // cannot trust either, so the way is dropped rather than guessed at.
    if (!roadClass || way.nodes.length < 2) continue
    if (way.geometry.length !== way.nodes.length) continue
    drivable.push({ way, roadClass })
  }

  const visits = new Map<number, number>()
  for (const { way } of drivable) {
    for (const nodeId of way.nodes) {
      visits.set(nodeId, (visits.get(nodeId) ?? 0) + 1)
    }
  }

  const nodes = new Map<number, GraphNode>()
  const edges: GraphEdge[] = []

  for (const { way, roadClass } of drivable) {
    const lastIndex = way.nodes.length - 1
    const isSplit = (index: number) =>
      index === 0 || index === lastIndex || (visits.get(way.nodes[index]) ?? 0) > 1

    const splits: number[] = []
    for (let i = 0; i <= lastIndex; i++) if (isSplit(i)) splits.push(i)

    for (let s = 0; s < splits.length - 1; s++) {
      const start = splits[s]
      const end = splits[s + 1]
      const points = way.geometry
        .slice(start, end + 1)
        .map((p): [number, number] => [p.lon, p.lat])

      let lengthMeters = 0
      for (let i = 1; i < points.length; i++) {
        lengthMeters += segmentMeters(points[i - 1], points[i])
      }

      edges.push({
        id: `${way.id}:${start}`,
        wayId: way.id,
        from: way.nodes[start],
        to: way.nodes[end],
        roadClass,
        nodes: way.nodes.slice(start, end + 1),
        points,
        lengthMeters,
      })

      for (const index of [start, end]) {
        const nodeId = way.nodes[index]
        if (!nodes.has(nodeId)) {
          nodes.set(nodeId, {
            id: nodeId,
            lon: way.geometry[index].lon,
            lat: way.geometry[index].lat,
          })
        }
      }
    }
  }

  // Sorted so that rebuilding unchanged ground reproduces the graph exactly,
  // which is what lets corridor ids stay stable across runs.
  return {
    nodes: [...nodes.values()].sort((a, b) => a.id - b.id),
    edges: edges.sort(
      (a, b) => a.wayId - b.wayId || Number(a.id.split(':')[1]) - Number(b.id.split(':')[1]),
    ),
  }
}
