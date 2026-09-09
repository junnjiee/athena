import type { MountedRoadClass, RoadGraph } from '../types'
import { metersPerDegree } from '../lib/geo'

export interface GraphMutation {
  graph: RoadGraph
  changed: boolean
  found: boolean
}

/** Marks every segment of one road identity destroyed or restored.
 *
 * The edges remain in the snapshot: destruction is a terrain state, not
 * deletion, and names/codes hang off the road identity across revisions. */
export function setRoadDestroyed(
  graph: RoadGraph,
  wayId: number,
  destroyed: boolean,
): GraphMutation {
  let found = false
  let changed = false
  const edges = graph.edges.map((edge) => {
    if (edge.wayId !== wayId) return edge
    found = true
    if ((edge.destroyed ?? false) === destroyed) return edge
    changed = true
    return { ...edge, destroyed }
  })

  return {
    graph: changed ? { ...graph, edges } : graph,
    changed,
    found,
  }
}

export type AddRoadResult =
  | { ok: true; graph: RoadGraph; wayId: number }
  | { ok: false; reason: string }

function distanceMeters(a: [number, number], b: [number, number]): number {
  const mpd = metersPerDegree((a[1] + b[1]) / 2)
  return Math.hypot((b[0] - a[0]) * mpd.lon, (b[1] - a[1]) * mpd.lat)
}

/** Adds one operator-observed road, snapped to live junctions at both ends.
 * Negative road and interior-node ids cannot collide with positive OSM ids;
 * the `added:` edge prefix also keeps segment ids out of OSM's way:index space. */
export function addRoad(
  graph: RoadGraph,
  points: [number, number][],
  roadClass: MountedRoadClass = 'unclassified',
  maxSnapMeters = 500,
): AddRoadResult {
  if (points.length < 2) return { ok: false, reason: 'a road needs at least two points' }

  const liveNodeIds = new Set<number>()
  for (const edge of graph.edges) {
    if (edge.destroyed) continue
    liveNodeIds.add(edge.from)
    liveNodeIds.add(edge.to)
  }
  const liveNodes = graph.nodes.filter((node) => liveNodeIds.has(node.id))
  if (liveNodes.length === 0) return { ok: false, reason: 'the graph has no live junctions' }

  const nearest = (point: [number, number]) =>
    liveNodes
      .map((node) => ({ node, distance: distanceMeters(point, [node.lon, node.lat]) }))
      .sort((a, b) => a.distance - b.distance || a.node.id - b.node.id)[0]

  const start = nearest(points[0])
  const end = nearest(points.at(-1)!)
  if (start.distance > maxSnapMeters || end.distance > maxSnapMeters) {
    return { ok: false, reason: `road endpoints must be within ${maxSnapMeters} m of a junction` }
  }
  if (start.node.id === end.node.id) {
    return { ok: false, reason: 'road endpoints must connect two different junctions' }
  }

  const snapped: [number, number][] = points.map((point) => [...point])
  snapped[0] = [start.node.lon, start.node.lat]
  snapped[snapped.length - 1] = [end.node.lon, end.node.lat]
  let lengthMeters = 0
  for (let index = 1; index < snapped.length; index++) {
    lengthMeters += distanceMeters(snapped[index - 1], snapped[index])
  }
  if (lengthMeters < 1) return { ok: false, reason: 'road is too short' }

  // Scan rather than spreading a theater-scale array into Math.min: tens of
  // thousands of edges can exceed the JavaScript engine's argument stack.
  let lowestWayId = 0
  let lowestNodeId = 0
  for (const edge of graph.edges) {
    lowestWayId = Math.min(lowestWayId, edge.wayId)
    for (const nodeId of edge.nodes) lowestNodeId = Math.min(lowestNodeId, nodeId)
  }
  for (const node of graph.nodes) lowestNodeId = Math.min(lowestNodeId, node.id)
  const wayId = lowestWayId - 1
  let nextNodeId = lowestNodeId - 1
  const nodeIds = snapped.map((_, index) => {
    if (index === 0) return start.node.id
    if (index === snapped.length - 1) return end.node.id
    return nextNodeId--
  })

  return {
    ok: true,
    wayId,
    graph: {
      ...graph,
      edges: [
        ...graph.edges,
        {
          id: `added:${Math.abs(wayId)}:0`,
          wayId,
          from: start.node.id,
          to: end.node.id,
          roadClass,
          name: null,
          lanes: null,
          nodes: nodeIds,
          points: snapped,
          lengthMeters,
        },
      ].sort((a, b) => a.wayId - b.wayId || a.id.localeCompare(b.id)),
    },
  }
}
