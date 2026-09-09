import type { Corridor, GraphEdge, RoadGraph, StudyRoute } from '../types/routeStudy'
import { corridorColor } from './corridors'
import { simplifyPolyline } from './simplify'

export interface CorridorLine {
  id: string
  corridorId: string
  points: [number, number][]
  color: string
  kind: 'route' | 'choke'
}
function appendPoints(target: [number, number][], points: [number, number][]): void {
  for (const point of points) {
    const previous = target[target.length - 1]
    if (!previous || previous[0] !== point[0] || previous[1] !== point[1]) target.push(point)
  }
}

function segmentLength(start: [number, number], end: [number, number]): number {
  const latitude = (start[1] + end[1]) / 2
  let deltaLongitude = end[0] - start[0]
  if (deltaLongitude > 180) deltaLongitude -= 360
  if (deltaLongitude < -180) deltaLongitude += 360
  return Math.hypot(deltaLongitude * Math.cos(latitude * Math.PI / 180), end[1] - start[1])
}

function clipPoints(
  points: [number, number][],
  fraction: number,
  endpoint: [number, number],
): [number, number][] {
  if (points.length < 2) return points
  const lengths = points.slice(1).map((end, index) => segmentLength(points[index], end))
  const target = lengths.reduce((total, length) => total + length, 0) * fraction
  const clipped: [number, number][] = [points[0]]
  let covered = 0
  for (let index = 0; index < lengths.length; index += 1) {
    if (covered + lengths[index] >= target - 1e-12) {
      clipped.push(endpoint)
      return clipped
    }
    clipped.push(points[index + 1])
    covered += lengths[index]
  }
  clipped[clipped.length - 1] = endpoint
  return clipped
}

/** Resolves the engine's compact edge-id route back into display geometry. Each
 *  edge follows the route's corresponding junction pair; this is important for
 *  westbound/southbound routes because graph edge points are stored in one
 *  deterministic direction, not necessarily the direction of travel. */
export function routePoints(route: StudyRoute, graph: RoadGraph): [number, number][] {
  const edges = new Map(graph.edges.map((edge) => [edge.id, edge]))
  const points: [number, number][] = []

  route.edge_ids.forEach((edgeId, index) => {
    const edge = edges.get(edgeId)
    if (!edge) return
    const fromNode = route.node_ids[index]
    const reverse = edge.to === fromNode
    let oriented = reverse ? [...edge.points].reverse() : edge.points
    if (
      route.terminal
      && index === route.edge_ids.length - 1
      && route.terminal.edge_id === edgeId
    ) {
      oriented = clipPoints(
        oriented,
        reverse ? 1 - route.terminal.edge_fraction : route.terminal.edge_fraction,
        [route.terminal.lon, route.terminal.lat],
      )
    }
    appendPoints(points, oriented)
  })
  return points
}

export function corridorLines(corridors: Corridor[], graph: RoadGraph): CorridorLine[] {
  const edges = new Map(graph.edges.map((edge) => [edge.id, edge]))
  const lines: CorridorLine[] = []

  corridors.forEach((corridor, corridorIndex) => {
    const color = corridorColor(corridorIndex)
    corridor.routes.forEach((route, routeIndex) => {
      // Roughly one-metre tolerance in geographic degrees. This strips dense
      // OSM shape-point runs while retaining bends at operational map scale.
      const points = simplifyPolyline(routePoints(route, graph), 0.00001)
      if (points.length >= 2) {
        lines.push({
          id: `corridor:${corridor.id}:route:${routeIndex}`,
          corridorId: corridor.id,
          points,
          color,
          kind: 'route',
        })
      }
    })
    corridor.choke_edge_ids.forEach((edgeId) => {
      const edge = edges.get(edgeId)
      if (edge && edge.points.length >= 2) {
        lines.push({
          id: `corridor:${corridor.id}:choke:${edgeId}`,
          corridorId: corridor.id,
          points: edge.points,
          color,
          kind: 'choke',
        })
      }
    })
  })
  return lines
}

export function edgePoints(edgeIds: string[], graph: RoadGraph): [number, number][] {
  const wanted = new Set(edgeIds)
  return graph.edges.filter((edge) => wanted.has(edge.id)).flatMap((edge) => edge.points)
}

export function formatRouteDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} sec`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const remainder = minutes % 60
  return remainder === 0 ? `${hours} hr` : `${hours} hr ${remainder} min`
}

export function formatRouteDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`
}

export function corridorDistance(corridor: Corridor): number {
  return Math.max(0, ...corridor.routes.map((route) => route.length_meters))
}

export function findEdge(graph: RoadGraph, id: string): GraphEdge | undefined {
  return graph.edges.find((edge) => edge.id === id)
}
