import { describe, expect, test } from 'bun:test'
import { addRoadBody, roadBreakBody, roadSettingsBody, roadStateBody } from '../src/routes/operationalAreas'
import { addRoad, breakRoadStretch, removeAddedRoad, setRoadDestroyed } from '../src/services/graphMutations'
import type { RoadGraph } from '../src/types'

const graph: RoadGraph = {
  nodes: [],
  edges: [
    {
      id: '123:0', wayId: 123, from: 1, to: 2, roadClass: 'secondary',
      nodes: [1, 2], points: [[103, 1], [103.01, 1]], lengthMeters: 1000,
    },
    {
      id: '123:1', wayId: 123, from: 2, to: 3, roadClass: 'secondary',
      nodes: [2, 3], points: [[103.01, 1], [103.02, 1]], lengthMeters: 1000,
    },
    {
      id: '456:0', wayId: 456, from: 4, to: 5, roadClass: 'track',
      nodes: [4, 5], points: [[103, 1.01], [103.01, 1.01]], lengthMeters: 1000,
    },
  ],
}

describe('operational road settings', () => {
  test('accepts an AO theme and sparse edits keyed by road identity', () => {
    expect(
      roadSettingsBody.parse({
        roadTheme: 'weather',
        roadEdits: {
          '123': { name: 'THUNDER', width: 6, dual: true, type: 'X' },
        },
      }),
    ).toEqual({
      roadTheme: 'weather',
      roadEdits: {
        '123': { name: 'THUNDER', width: 6, dual: true, type: 'X' },
      },
    })
  })

  test('rejects values outside the confirmed road grammar', () => {
    expect(roadSettingsBody.safeParse({ roadTheme: 'rivers' }).success).toBe(false)
    expect(
      roadSettingsBody.safeParse({
        roadEdits: { '123': { name: 'FALCON', width: 8, dual: false, type: 'Q' } },
      }).success,
    ).toBe(false)
  })

  test('requires at least one setting to change', () => {
    expect(roadSettingsBody.safeParse({}).success).toBe(false)
  })
})

describe('road destruction', () => {
  test('accepts only an explicit terrain state', () => {
    expect(roadStateBody.parse({ destroyed: true })).toEqual({ destroyed: true })
    expect(roadStateBody.safeParse({}).success).toBe(false)
    expect(roadStateBody.safeParse({ destroyed: 'yes' }).success).toBe(false)
  })

  test('marks every segment of the road without deleting it', () => {
    const mutation = setRoadDestroyed(graph, 123, true)

    expect(mutation).toMatchObject({ found: true, changed: true })
    expect(mutation.graph.edges).toHaveLength(3)
    expect(mutation.graph.edges.filter((edge) => edge.wayId === 123).every((edge) => edge.destroyed)).toBe(true)
    expect(mutation.graph.edges.find((edge) => edge.wayId === 456)?.destroyed).toBeUndefined()
  })

  test('restores the same road identity and reports no-op repeats', () => {
    const destroyed = setRoadDestroyed(graph, 123, true).graph
    expect(setRoadDestroyed(destroyed, 123, true).changed).toBe(false)
    expect(setRoadDestroyed(destroyed, 123, false).graph.edges[0].destroyed).toBe(false)
  })

  test('validates two geographic cut points', () => {
    expect(roadBreakBody.safeParse({ start: [103.002, 1], end: [103.008, 1] }).success).toBe(true)
    expect(roadBreakBody.safeParse({ start: [103.002, 1] }).success).toBe(false)
  })

  test('splits one edge into intact, broken, intact stretches', () => {
    const named: RoadGraph = {
      ...graph,
      nodes: [
        { id: 1, lon: 103, lat: 1, elevation: 10 },
        { id: 2, lon: 103.01, lat: 1, elevation: 20 },
        { id: 3, lon: 103.02, lat: 1, elevation: 30 },
      ],
      edges: graph.edges.map((edge) => edge.wayId === 123
        ? { ...edge, name: 'Mandai Road', lanes: '4' }
        : edge),
    }

    const mutation = breakRoadStretch(named, 123, [103.002, 1], [103.008, 1])
    if (!mutation.ok) throw new Error(mutation.reason)

    const children = mutation.graph.edges.filter((edge) => edge.id.startsWith('split:123:0:'))
    expect(children).toHaveLength(3)
    expect(children.map((edge) => Boolean(edge.destroyed))).toEqual([false, true, false])
    expect(children.every((edge) => edge.wayId === 123)).toBe(true)
    expect(children.every((edge) => edge.name === 'Mandai Road' && edge.lanes === '4')).toBe(true)
    expect(mutation.graph.edges.some((edge) => edge.id === '123:0')).toBe(false)
    expect(mutation.graph.edges.some((edge) => edge.id === '123:1')).toBe(true)
    expect(mutation.graph.nodes).toHaveLength(named.nodes.length + 2)
  })

  test('requires both cuts to land on the same intact edge', () => {
    const mutation = breakRoadStretch(graph, 123, [103.002, 1], [103.018, 1])
    expect(mutation.ok).toBe(false)
  })

  test('rejects a zero-length or endpoint cut instead of creating degenerate edges', () => {
    expect(breakRoadStretch(graph, 123, [103.005, 1], [103.005, 1]).ok).toBe(false)
    expect(breakRoadStretch(graph, 123, [103, 1], [103.005, 1]).ok).toBe(false)
  })

  test('accepts cut points in either order', () => {
    const mutation = breakRoadStretch(graph, 123, [103.008, 1], [103.002, 1])
    if (!mutation.ok) throw new Error(mutation.reason)

    const broken = mutation.graph.edges.find((edge) => edge.destroyed)
    expect(broken?.points).toEqual([[103.002, 1], [103.008, 1]])
  })

  test('does not invent an unknown road', () => {
    expect(setRoadDestroyed(graph, 999, true)).toMatchObject({ found: false, changed: false })
  })
})

describe('operator-added roads', () => {
  const connected: RoadGraph = {
    nodes: [
      { id: 1, lon: 103, lat: 1, elevation: 0 },
      { id: 2, lon: 103.01, lat: 1, elevation: 0 },
      { id: 3, lon: 103.02, lat: 1, elevation: 0 },
    ],
    edges: [
      {
        id: '10:0', wayId: 10, from: 1, to: 2, roadClass: 'secondary',
        nodes: [1, 2], points: [[103, 1], [103.01, 1]], lengthMeters: 1113,
      },
      {
        id: '20:0', wayId: 20, from: 2, to: 3, roadClass: 'secondary',
        nodes: [2, 3], points: [[103.01, 1], [103.02, 1]], lengthMeters: 1113,
      },
    ],
  }

  test('validates a drawn road and optional operator code', () => {
    expect(addRoadBody.safeParse({ points: [[103, 1], [103.02, 1.001]] }).success).toBe(true)
    expect(addRoadBody.safeParse({ points: [[103, 1]] }).success).toBe(false)
  })

  test('snaps endpoints and assigns collision-proof synthetic ids', () => {
    const result = addRoad(
      connected,
      [[103.0001, 1], [103.01, 1.005], [103.0199, 1]],
      'track',
    )
    if (!result.ok) throw new Error(result.reason)

    const added = result.graph.edges.find((edge) => edge.wayId === result.wayId)!
    expect(result.wayId).toBe(-1)
    expect(added).toMatchObject({
      id: 'added:1:0', wayId: -1, from: 1, to: 3, roadClass: 'track',
      points: [[103, 1], [103.01, 1.005], [103.02, 1]],
    })
    expect(added.nodes[1]).toBeLessThan(0)
  })

  test('allocates a new negative identity after an earlier added road', () => {
    const first = addRoad(connected, [[103, 1], [103.02, 1]])
    if (!first.ok) throw new Error(first.reason)
    const second = addRoad(first.graph, [[103, 1], [103.02, 1]])
    expect(second.ok && second.wayId).toBe(-2)
  })

  test('refuses endpoints too far from the live network', () => {
    expect(addRoad(connected, [[104, 2], [104.01, 2]])).toEqual({
      ok: false,
      reason: 'road endpoints must be within 500 m of a junction',
    })
  })

  test('an added road can be removed outright, leaving the network it joined intact', () => {
    const added = addRoad(connected, [[103, 1], [103.01, 1.005], [103.02, 1]])
    if (!added.ok) throw new Error(added.reason)

    const removed = removeAddedRoad(added.graph, added.wayId)
    if (!removed.ok) throw new Error(removed.reason)

    expect(removed.graph.edges.map((edge) => edge.id)).toEqual(['10:0', '20:0'])
    expect(removed.graph.nodes).toEqual(connected.nodes)
  })

  test('removing an added road also drops the cut junctions a break left on it', () => {
    const added = addRoad(connected, [[103, 1], [103.02, 1]])
    if (!added.ok) throw new Error(added.reason)
    const broken = breakRoadStretch(added.graph, added.wayId, [103.005, 1], [103.015, 1])
    if (!broken.ok) throw new Error(broken.reason)
    expect(broken.graph.nodes.length).toBe(connected.nodes.length + 2)

    const removed = removeAddedRoad(broken.graph, added.wayId)
    if (!removed.ok) throw new Error(removed.reason)

    expect(removed.graph.nodes).toEqual(connected.nodes)
    expect(removed.graph.edges.some((edge) => edge.wayId === added.wayId)).toBe(false)
  })

  test('an extracted road cannot be removed -- destruction is the only state change', () => {
    expect(removeAddedRoad(connected, 10)).toEqual({
      ok: false,
      reason: 'only operator-added roads can be removed; mark an extracted road destroyed instead',
    })
    expect(removeAddedRoad(connected, -7)).toEqual({ ok: false, reason: 'unknown road' })
  })
})
