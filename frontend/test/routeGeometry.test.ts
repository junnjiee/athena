import { describe, expect, test } from 'bun:test'
import { corridorLines, formatRouteDuration, routePoints } from '../src/lib/routeStudy'
import type { Corridor, RoadGraph, StudyRoute } from '../src/types/routeStudy'

const graph: RoadGraph = {
  nodes: [
    { id: 1, lon: 103, lat: 1, elevation: 0 },
    { id: 2, lon: 104, lat: 1, elevation: 0 },
    { id: 3, lon: 105, lat: 1, elevation: 0 },
  ],
  edges: [
    {
      id: 'a', wayId: 1, from: 1, to: 2, roadClass: 'primary', nodes: [1, 2],
      points: [[103, 1], [103.5, 1], [104, 1]], lengthMeters: 100,
    },
    {
      id: 'b', wayId: 1, from: 2, to: 3, roadClass: 'primary', nodes: [2, 3],
      points: [[104, 1], [105, 1]], lengthMeters: 100,
    },
  ],
}

function route(overrides: Partial<StudyRoute> = {}): StudyRoute {
  return {
    reserve_id: 'reserve-1', objective_id: 'objective-1', edge_ids: ['a', 'b'],
    node_ids: [1, 2, 3], seconds: 120, length_meters: 200, ...overrides,
  }
}

describe('route study geometry', () => {
  test('stitches edge geometry without duplicate junctions', () => {
    expect(routePoints(route(), graph)).toEqual([[103, 1], [103.5, 1], [104, 1], [105, 1]])
  })

  test('reverses deterministic graph edges for reverse travel', () => {
    expect(routePoints(route({ edge_ids: ['b', 'a'], node_ids: [3, 2, 1] }), graph)).toEqual([
      [105, 1], [104, 1], [103.5, 1], [103, 1],
    ])
  })

  test('emits a heavier, separately-addressable line for each choke edge', () => {
    const corridor: Corridor = { id: 'c1', routes: [route()], choke_edge_ids: ['b'], fastest_seconds: 120 }
    const lines = corridorLines([corridor], graph)
    expect(lines.map((line) => line.kind)).toEqual(['route', 'choke'])
    expect(lines[1].points).toEqual([[104, 1], [105, 1]])
    expect(lines[0].color).toBe(lines[1].color)
  })
})

describe('route study labels', () => {
  test('formats operational travel times compactly', () => {
    expect(formatRouteDuration(45)).toBe('45 sec')
    expect(formatRouteDuration(600)).toBe('10 min')
    expect(formatRouteDuration(4500)).toBe('1 hr 15 min')
  })
})
