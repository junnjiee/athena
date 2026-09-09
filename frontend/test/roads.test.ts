import { describe, expect, test } from 'bun:test'
import { roadIdentities, roadLabelPoint } from '../src/lib/roads'
import type { RoadGraph } from '../src/types/routeStudy'

const graph: RoadGraph = {
  nodes: [],
  edges: [
    {
      id: '10:0', wayId: 10, from: 1, to: 2, roadClass: 'primary', name: 'Mandai Road', lanes: '4',
      nodes: [1, 2], points: [[103, 1], [103.01, 1]], lengthMeters: 1000,
    },
    {
      id: '10:1', wayId: 10, from: 2, to: 3, roadClass: 'primary', name: 'Mandai Road', lanes: '4',
      nodes: [2, 3], points: [[103.01, 1], [103.02, 1]], lengthMeters: 800,
    },
    {
      id: '20:0', wayId: 20, from: 4, to: 5, roadClass: 'track', name: null, lanes: null,
      nodes: [4, 5], points: [[103, 1.01], [103.01, 1.01]], lengthMeters: 400,
    },
  ],
}

describe('road identities', () => {
  test('groups graph segments by road identity', () => {
    const roads = roadIdentities(graph)

    expect(roads).toHaveLength(2)
    expect(roads[0]).toMatchObject({
      id: '10',
      wayId: 10,
      osmName: 'Mandai Road',
      lanes: '4',
      roadClass: 'primary',
      edgeIds: ['10:0', '10:1'],
      lengthMeters: 1800,
    })
  })

  test('orders important, longer roads before tracks', () => {
    expect(roadIdentities(graph).map((road) => road.id)).toEqual(['10', '20'])
  })

  test('places a map label on the middle of the road identity', () => {
    expect(roadLabelPoint(roadIdentities(graph)[0])).toEqual([103.01, 1])
  })

  test('keeps a destroyed road identity visible and reports its state', () => {
    const destroyed: RoadGraph = {
      ...graph,
      edges: graph.edges.map((edge) => edge.wayId === 10 ? { ...edge, destroyed: true } : edge),
    }

    const road = roadIdentities(destroyed)[0]
    expect(road).toMatchObject({ id: '10', destroyed: true, partiallyDestroyed: true })
    expect(road.edgeIds).toEqual(['10:0', '10:1'])
  })

  test('distinguishes a partially destroyed road for future segment cuts', () => {
    const partial: RoadGraph = {
      ...graph,
      edges: graph.edges.map((edge) => edge.id === '10:0' ? { ...edge, destroyed: true } : edge),
    }

    expect(roadIdentities(partial)[0]).toMatchObject({ destroyed: false, partiallyDestroyed: true })
  })

  test('keeps split children under the original road identity and code', () => {
    const split: RoadGraph = {
      ...graph,
      edges: [
        ...graph.edges.filter((edge) => edge.id !== '10:0'),
        ...[0, 1, 2].map((part) => ({
          ...graph.edges[0],
          id: `split:10:0:1:${part}`,
          destroyed: part === 1,
          lengthMeters: 300,
        })),
      ],
    }

    const road = roadIdentities(split)[0]
    expect(road).toMatchObject({
      id: '10', wayId: 10, osmName: 'Mandai Road', lanes: '4',
      destroyed: false, partiallyDestroyed: true,
    })
    expect(road.edgeIds).toContain('split:10:0:1:1')
  })
})
