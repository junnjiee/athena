import type { GraphEdge, GraphNode, MountedRoadClass, RoadGraph } from '../types'
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

export type RemoveRoadResult =
  | { ok: true; graph: RoadGraph }
  | { ok: false; reason: string }

/** Drops an operator-added road from the graph outright.
 *
 * Extracted roads are never removed -- their loss is a terrain state, recorded
 * with `setRoadDestroyed` so the axis keeps its identity. An added road is the
 * operator's own observation, so withdrawing it is a correction rather than an
 * event on the ground. Cut junctions a break left on the road go with it; the
 * live junctions it was snapped to stay, since other roads still meet there. */
export function removeAddedRoad(graph: RoadGraph, wayId: number): RemoveRoadResult {
  if (!graph.edges.some((edge) => edge.wayId === wayId)) return { ok: false, reason: 'unknown road' }
  if (wayId >= 0) {
    return {
      ok: false,
      reason: 'only operator-added roads can be removed; mark an extracted road destroyed instead',
    }
  }
  const edges = graph.edges.filter((edge) => edge.wayId !== wayId)
  const referenced = new Set<number>()
  for (const edge of edges) {
    referenced.add(edge.from)
    referenced.add(edge.to)
  }
  return {
    ok: true,
    graph: {
      ...graph,
      nodes: graph.nodes.filter((node) => node.id >= 0 || referenced.has(node.id)),
      edges,
    },
  }
}

function distanceMeters(a: [number, number], b: [number, number]): number {
  const mpd = metersPerDegree((a[1] + b[1]) / 2)
  return Math.hypot((b[0] - a[0]) * mpd.lon, (b[1] - a[1]) * mpd.lat)
}

interface Projection {
  point: [number, number]
  segmentIndex: number
  fraction: number
  alongMeters: number
  distanceMeters: number
}

function projectOntoEdge(edge: GraphEdge, target: [number, number]): Projection | null {
  if (edge.points.length < 2) return null
  let best: Projection | null = null
  let traversed = 0
  for (let index = 0; index < edge.points.length - 1; index++) {
    const start = edge.points[index]
    const end = edge.points[index + 1]
    const mpd = metersPerDegree((start[1] + end[1] + target[1]) / 3)
    const vx = (end[0] - start[0]) * mpd.lon
    const vy = (end[1] - start[1]) * mpd.lat
    const tx = (target[0] - start[0]) * mpd.lon
    const ty = (target[1] - start[1]) * mpd.lat
    const squared = vx * vx + vy * vy
    const fraction = squared === 0 ? 0 : Math.max(0, Math.min(1, (tx * vx + ty * vy) / squared))
    const point: [number, number] = [
      start[0] + (end[0] - start[0]) * fraction,
      start[1] + (end[1] - start[1]) * fraction,
    ]
    const projection: Projection = {
      point,
      segmentIndex: index,
      fraction,
      alongMeters: traversed + Math.sqrt(squared) * fraction,
      distanceMeters: distanceMeters(point, target),
    }
    if (!best || projection.distanceMeters < best.distanceMeters) best = projection
    traversed += Math.sqrt(squared)
  }
  return best
}

function appendPoint(points: [number, number][], point: [number, number]): void {
  const previous = points.at(-1)
  if (!previous || previous[0] !== point[0] || previous[1] !== point[1]) points.push(point)
}

function segmentLength(points: [number, number][]): number {
  let total = 0
  for (let index = 1; index < points.length; index++) {
    total += distanceMeters(points[index - 1], points[index])
  }
  return total
}

function nextNegativeNodeIds(graph: RoadGraph): [number, number] {
  let lowest = 0
  for (const node of graph.nodes) lowest = Math.min(lowest, node.id)
  for (const edge of graph.edges) {
    for (const id of edge.nodes) lowest = Math.min(lowest, id)
  }
  return [lowest - 1, lowest - 2]
}

function splitId(graph: RoadGraph, edgeId: string): string {
  const used = new Set(graph.edges.map((edge) => edge.id))
  let serial = 1
  while (used.has(`split:${edgeId}:${serial}:0`)) serial += 1
  return `split:${edgeId}:${serial}`
}

export type BreakRoadResult =
  | { ok: true; graph: RoadGraph; edgeId: string }
  | { ok: false; reason: string }

/** Breaks only the selected stretch of one graph edge.
 *
 * Both operator picks must resolve to the same edge of the named road. The
 * original edge is replaced by before/broken/after children, while every child
 * keeps the road's wayId, name, lanes, and class. New negative node ids and a
 * `split:` edge namespace cannot collide with OSM or operator-added identity.
 */
export function breakRoadStretch(
  graph: RoadGraph,
  wayId: number,
  start: [number, number],
  end: [number, number],
  maxSnapMeters = 100,
): BreakRoadResult {
  const candidates = graph.edges
    .filter((edge) => edge.wayId === wayId && !edge.destroyed)
    .flatMap((edge) => {
      const first = projectOntoEdge(edge, start)
      const second = projectOntoEdge(edge, end)
      return first && second ? [{ edge, first, second }] : []
    })
    .filter(({ first, second }) =>
      first.distanceMeters <= maxSnapMeters && second.distanceMeters <= maxSnapMeters)
    .sort((a, b) =>
      a.first.distanceMeters + a.second.distanceMeters -
      b.first.distanceMeters - b.second.distanceMeters || a.edge.id.localeCompare(b.edge.id))

  if (candidates.length === 0) {
    const hasIntactRoad = graph.edges.some((edge) => edge.wayId === wayId && !edge.destroyed)
    return {
      ok: false,
      reason: hasIntactRoad
        ? `both cut points must be within ${maxSnapMeters} m of one road segment`
        : 'road has no intact stretch to break',
    }
  }
  const selected = candidates[0]

  let first = selected.first
  let second = selected.second
  if (first.alongMeters > second.alongMeters) [first, second] = [second, first]
  const edgeLength = segmentLength(selected.edge.points)
  if (first.alongMeters < 1 || edgeLength - second.alongMeters < 1) {
    return { ok: false, reason: 'cut points must lie inside the road segment' }
  }
  if (second.alongMeters - first.alongMeters < 1) {
    return { ok: false, reason: 'broken stretch must be at least 1 m long' }
  }

  const before: [number, number][] = []
  const broken: [number, number][] = []
  const after: [number, number][] = []
  for (let index = 0; index <= first.segmentIndex; index++) appendPoint(before, selected.edge.points[index])
  appendPoint(before, first.point)
  appendPoint(broken, first.point)
  for (let index = first.segmentIndex + 1; index <= second.segmentIndex; index++) {
    appendPoint(broken, selected.edge.points[index])
  }
  appendPoint(broken, second.point)
  appendPoint(after, second.point)
  for (let index = second.segmentIndex + 1; index < selected.edge.points.length; index++) {
    appendPoint(after, selected.edge.points[index])
  }

  const [firstNodeId, secondNodeId] = nextNegativeNodeIds(graph)
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]))
  const from = nodesById.get(selected.edge.from)
  const to = nodesById.get(selected.edge.to)
  const elevationAt = (along: number) => {
    if (!from || !to || edgeLength === 0) return 0
    return from.elevation + (to.elevation - from.elevation) * (along / edgeLength)
  }
  const cutNodes: GraphNode[] = [
    { id: firstNodeId, lon: first.point[0], lat: first.point[1], elevation: elevationAt(first.alongMeters) },
    { id: secondNodeId, lon: second.point[0], lat: second.point[1], elevation: elevationAt(second.alongMeters) },
  ]
  const prefix = splitId(graph, selected.edge.id)
  const child = (
    id: string,
    fromNode: number,
    toNode: number,
    points: [number, number][],
    destroyed: boolean,
  ): GraphEdge => ({
    ...selected.edge,
    id,
    from: fromNode,
    to: toNode,
    nodes: [fromNode, toNode],
    points,
    lengthMeters: segmentLength(points),
    destroyed,
  })
  const children = [
    child(`${prefix}:0`, selected.edge.from, firstNodeId, before, false),
    child(`${prefix}:1`, firstNodeId, secondNodeId, broken, true),
    child(`${prefix}:2`, secondNodeId, selected.edge.to, after, false),
  ]

  return {
    ok: true,
    edgeId: selected.edge.id,
    graph: {
      nodes: [...graph.nodes, ...cutNodes].sort((a, b) => a.id - b.id),
      edges: graph.edges
        .flatMap((edge) => edge.id === selected.edge.id ? children : [edge])
        .sort((a, b) => a.wayId - b.wayId || a.id.localeCompare(b.id)),
    },
  }
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
