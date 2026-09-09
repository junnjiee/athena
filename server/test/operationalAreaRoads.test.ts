import { describe, expect, test } from 'bun:test'
import { roadSettingsBody, roadStateBody } from '../src/routes/operationalAreas'
import { setRoadDestroyed } from '../src/services/graphMutations'
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

  test('does not invent an unknown road', () => {
    expect(setRoadDestroyed(graph, 999, true)).toMatchObject({ found: false, changed: false })
  })
})
