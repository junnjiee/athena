import type { RoadGraph } from '../types/routeStudy'

export interface RoadIdentity {
  /** OSM way id today; deliberately separate from segment ids. */
  id: string
  wayId: number
  osmName: string | null
  lanes: string | null
  roadClass: string
  edgeIds: string[]
  points: [number, number][]
  lengthMeters: number
  destroyed: boolean
  partiallyDestroyed: boolean
}

const CLASS_ORDER: Record<string, number> = {
  motorway: 0,
  trunk: 1,
  primary: 2,
  secondary: 3,
  tertiary: 4,
  unclassified: 5,
  residential: 6,
  service: 7,
  living_street: 8,
  track: 9,
}

/** Collapses graph segments back onto the road identity they came from. A
 *  junction can split one OSM way into many edges; it must still receive one
 *  name and one code. */
export function roadIdentities(graph: RoadGraph): RoadIdentity[] {
  const byWay = new Map<number, RoadIdentity>()

  for (const edge of graph.edges) {
    const current = byWay.get(edge.wayId)
    if (current) {
      current.edgeIds.push(edge.id)
      current.lengthMeters += edge.lengthMeters
      current.points.push(...edge.points)
      if (!current.osmName && edge.name) current.osmName = edge.name
      if (!current.lanes && edge.lanes) current.lanes = edge.lanes
      current.partiallyDestroyed ||= Boolean(edge.destroyed)
      current.destroyed &&= Boolean(edge.destroyed)
      continue
    }

    byWay.set(edge.wayId, {
      id: String(edge.wayId),
      wayId: edge.wayId,
      osmName: edge.name?.trim() || null,
      lanes: edge.lanes?.trim() || null,
      roadClass: edge.roadClass,
      edgeIds: [edge.id],
      points: [...edge.points],
      lengthMeters: edge.lengthMeters,
      destroyed: Boolean(edge.destroyed),
      partiallyDestroyed: Boolean(edge.destroyed),
    })
  }

  return [...byWay.values()].sort(
    (a, b) =>
      (CLASS_ORDER[a.roadClass] ?? 99) - (CLASS_ORDER[b.roadClass] ?? 99) ||
      b.lengthMeters - a.lengthMeters ||
      a.wayId - b.wayId,
  )
}

export function roadLabelPoint(road: RoadIdentity): [number, number] | null {
  if (road.points.length === 0) return null
  return road.points[Math.floor((road.points.length - 1) / 2)]
}
