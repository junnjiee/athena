import { describe, expect, test } from 'bun:test'
import { buildRoadIndex, nearestRoad } from '../src/lib/roadIndex'
import type { RoadGraph } from '../src/types/routeStudy'

const graph: RoadGraph = {
  nodes: [],
  edges: [
    // East-west along the equator, 0 -> 0.02 deg (~2.2 km).
    { id: '1:0', wayId: 1, from: 1, to: 2, roadClass: 'secondary', nodes: [1, 2], points: [[0, 0], [0.01, 0]], lengthMeters: 1113 },
    { id: '1:1', wayId: 1, from: 2, to: 3, roadClass: 'secondary', nodes: [2, 3], points: [[0.01, 0], [0.02, 0]], lengthMeters: 1113 },
    // Parallel road 500 m north.
    { id: '2:0', wayId: 2, from: 4, to: 5, roadClass: 'track', nodes: [4, 5], points: [[0, 0.0045], [0.02, 0.0045]], lengthMeters: 2226 },
    // Far away, in another cell entirely.
    { id: '3:0', wayId: 3, from: 6, to: 7, roadClass: 'track', nodes: [6, 7], points: [[1, 1], [1.01, 1]], lengthMeters: 1113 },
  ],
}

describe('nearestRoad', () => {
  const index = buildRoadIndex(graph)

  test('finds the closest road across edges of the same identity', () => {
    const hit = nearestRoad(index, 0.015, 0.0002, 200)
    expect(hit?.wayId).toBe(1)
    expect(hit?.edgeId).toBe('1:1')
    expect(hit?.distanceMeters).toBeCloseTo(22.3, 0)
  })

  test('prefers the nearer of two parallel roads', () => {
    expect(nearestRoad(index, 0.01, 0.003, 500)?.wayId).toBe(2)
    expect(nearestRoad(index, 0.01, 0.001, 500)?.wayId).toBe(1)
  })

  test('returns nothing beyond the tolerance', () => {
    expect(nearestRoad(index, 0.01, 0.002, 100)).toBeNull()
  })

  test('measures to the segment, not to its vertices', () => {
    // Midway along a 1.1 km edge, 10 m off it: vertex distance would be ~560 m.
    const hit = nearestRoad(index, 0.005, 0.00009, 50)
    expect(hit?.wayId).toBe(1)
    expect(hit?.distanceMeters).toBeLessThan(15)
  })

  test('reaches across cell boundaries when the tolerance demands it', () => {
    // A point just outside the far road's cell but within a wide tolerance.
    expect(nearestRoad(index, 0.995, 1, 1000)?.wayId).toBe(3)
  })

  test('reports the projected point on the road', () => {
    const hit = nearestRoad(index, 0.005, 0.0001, 50)!
    expect(hit.point[0]).toBeCloseTo(0.005, 6)
    expect(hit.point[1]).toBeCloseTo(0, 6)
  })
})
