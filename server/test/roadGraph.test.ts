import { describe, expect, test } from 'bun:test'
import { buildRoadGraph, mountedRoadClass } from '../src/services/roadGraph'
import type { OverpassWay } from '../src/types'

/** Fixtures sit at the equator on a 0.001° lattice, so one step is 111.32 m in
 *  either axis and expected lengths are readable by inspection. */
const STEP = 0.001
const STEP_METERS = 111.32

function way(
  id: number,
  nodes: number[],
  coords: [number, number][],
  tags: Record<string, string> = { highway: 'residential' },
): OverpassWay {
  return {
    id,
    nodes,
    geometry: coords.map(([lon, lat]) => ({ lon, lat })),
    tags,
  }
}

/** A west-east road through the origin: nodes 1 - 2 - 3, node 2 at (0, 0). */
function eastWestRoad(id = 1): OverpassWay {
  return way(
    id,
    [1, 2, 3],
    [
      [-STEP, 0],
      [0, 0],
      [STEP, 0],
    ],
  )
}

describe('mountedRoadClass', () => {
  test('maps drivable highway tags to their own class', () => {
    expect(mountedRoadClass({ highway: 'motorway' })).toBe('motorway')
    expect(mountedRoadClass({ highway: 'trunk' })).toBe('trunk')
    expect(mountedRoadClass({ highway: 'residential' })).toBe('residential')
    expect(mountedRoadClass({ highway: 'track' })).toBe('track')
  })

  test('link roads take their parent class', () => {
    expect(mountedRoadClass({ highway: 'motorway_link' })).toBe('motorway')
    expect(mountedRoadClass({ highway: 'primary_link' })).toBe('primary')
  })

  test('rejects everything a vehicle cannot use', () => {
    for (const highway of ['footway', 'path', 'cycleway', 'bridleway', 'steps', 'pedestrian']) {
      expect(mountedRoadClass({ highway })).toBeNull()
    }
  })

  test('rejects a way with no highway tag', () => {
    expect(mountedRoadClass({ building: 'yes' })).toBeNull()
    expect(mountedRoadClass({})).toBeNull()
  })
})

describe('buildRoadGraph', () => {
  test('an isolated way becomes one edge between its endpoints', () => {
    const graph = buildRoadGraph([eastWestRoad()])

    expect(graph.edges).toHaveLength(1)
    expect(graph.edges[0].from).toBe(1)
    expect(graph.edges[0].to).toBe(3)
    // the interior node is not a junction, but its geometry is retained
    expect(graph.edges[0].nodes).toEqual([1, 2, 3])
    expect(graph.edges[0].points).toHaveLength(3)
    expect(graph.nodes.map((n) => n.id)).toEqual([1, 3])
  })

  test('edge length sums its segments rather than measuring end to end', () => {
    const graph = buildRoadGraph([eastWestRoad()])

    expect(graph.edges[0].lengthMeters).toBeCloseTo(2 * STEP_METERS, 1)
  })

  test('a dogleg is longer than the straight line between its ends', () => {
    // 1 -> 2 east, then 2 -> 3 north: two legs, not one hypotenuse
    const dogleg = way(
      1,
      [1, 2, 3],
      [
        [0, 0],
        [STEP, 0],
        [STEP, STEP],
      ],
    )
    const graph = buildRoadGraph([dogleg])

    expect(graph.edges[0].lengthMeters).toBeCloseTo(2 * STEP_METERS, 1)
  })

  test('a crossroads splits both ways at the shared node', () => {
    const northSouth = way(
      2,
      [4, 2, 5],
      [
        [0, -STEP],
        [0, 0],
        [0, STEP],
      ],
    )
    const graph = buildRoadGraph([eastWestRoad(), northSouth])

    expect(graph.edges).toHaveLength(4)
    // node 2 is shared by two ways, so it is a junction; the four tips are endpoints
    expect(graph.nodes.map((n) => n.id)).toEqual([1, 2, 3, 4, 5])
    expect(graph.edges.map((e) => [e.from, e.to])).toEqual([
      [1, 2],
      [2, 3],
      [4, 2],
      [2, 5],
    ])
  })

  test('a T-junction splits only the way that is touched mid-span', () => {
    // way 2 starts at node 2, which sits mid-span of way 1
    const spur = way(
      2,
      [2, 6],
      [
        [0, 0],
        [0, STEP],
      ],
    )
    const graph = buildRoadGraph([eastWestRoad(), spur])

    expect(graph.edges).toHaveLength(3)
    expect(graph.edges.map((e) => [e.from, e.to])).toEqual([
      [1, 2],
      [2, 3],
      [2, 6],
    ])
  })

  test('parallel carriageways sharing no node never connect', () => {
    const northbound = way(
      1,
      [1, 2],
      [
        [0, 0],
        [0, STEP],
      ],
    )
    const southbound = way(
      2,
      [3, 4],
      [
        [0.00001, STEP],
        [0.00001, 0],
      ],
    )
    const graph = buildRoadGraph([northbound, southbound])

    // geometrically metres apart, topologically unrelated — no junction invented
    expect(graph.edges).toHaveLength(2)
    expect(graph.nodes).toHaveLength(4)
  })

  test('a roundabout is a closed edge back to its one junction', () => {
    const ring = way(
      1,
      [7, 8, 9, 7],
      [
        [0, 0],
        [STEP, 0],
        [STEP, STEP],
        [0, 0],
      ],
    )
    const approach = way(
      2,
      [10, 7],
      [
        [-STEP, 0],
        [0, 0],
      ],
    )
    const graph = buildRoadGraph([ring, approach])

    expect(graph.edges).toHaveLength(2)
    const loop = graph.edges.find((e) => e.wayId === 1)!
    expect(loop.from).toBe(7)
    expect(loop.to).toBe(7)
  })

  test('non-mounted ways are excluded entirely', () => {
    const footpath = way(2, [4, 5], [[0, 0], [0, STEP]], { highway: 'footway' })
    const graph = buildRoadGraph([eastWestRoad(), footpath])

    expect(graph.edges).toHaveLength(1)
    expect(graph.edges[0].wayId).toBe(1)
    // the footpath's nodes never enter the graph
    expect(graph.nodes.map((n) => n.id)).toEqual([1, 3])
  })

  test('a way sharing a node with a rejected way is not split by it', () => {
    // a footpath meeting the road mid-span is not a junction for vehicles
    const footpath = way(2, [2, 6], [[0, 0], [0, STEP]], { highway: 'path' })
    const graph = buildRoadGraph([eastWestRoad(), footpath])

    expect(graph.edges).toHaveLength(1)
    expect(graph.edges[0].nodes).toEqual([1, 2, 3])
  })

  test('output is independent of input order', () => {
    const northSouth = way(
      2,
      [4, 2, 5],
      [
        [0, -STEP],
        [0, 0],
        [0, STEP],
      ],
    )
    const forward = buildRoadGraph([eastWestRoad(), northSouth])
    const reversed = buildRoadGraph([northSouth, eastWestRoad()])

    expect(reversed).toEqual(forward)
  })

  test('edge ids are stable across rebuilds', () => {
    const first = buildRoadGraph([eastWestRoad()])
    const second = buildRoadGraph([eastWestRoad()])

    expect(second.edges.map((e) => e.id)).toEqual(first.edges.map((e) => e.id))
  })

  test('a way repeating a node splits there', () => {
    // figure-of-eight: node 2 is visited twice by the same way, so it is a junction
    const lasso = way(
      1,
      [1, 2, 3, 2, 4],
      [
        [0, 0],
        [STEP, 0],
        [STEP, STEP],
        [STEP, 0],
        [2 * STEP, 0],
      ],
    )
    const graph = buildRoadGraph([lasso])

    expect(graph.edges.map((e) => [e.from, e.to])).toEqual([
      [1, 2],
      [2, 2],
      [2, 4],
    ])
  })
})
