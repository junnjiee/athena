import type { RoadGraph } from '../types'

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
