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
    const oriented = edge.to === fromNode ? [...edge.points].reverse() : edge.points
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
