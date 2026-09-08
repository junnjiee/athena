import { describe, expect, test } from 'bun:test'
import { decodeGraph, encodeGraph } from '../src/services/graphWire'
import { ingestOperationalArea } from '../src/services/operationalArea'
import type { BBox, OverpassWay, RoadGraph } from '../src/types'

const AREA: BBox = { west: 0, south: 0, east: 0.1, north: 0.1 }

const GRAPH: RoadGraph = {
  nodes: [
    { id: 1, lon: 0, lat: 0, elevation: 12.5 },
    { id: 3, lon: 0.002, lat: 0, elevation: 30 },
  ],
  edges: [
    {
      id: '1:0',
      wayId: 1,
      from: 1,
      to: 3,
      roadClass: 'residential',
      nodes: [1, 2, 3],
      points: [
        [0, 0],
        [0.001, 0],
        [0.002, 0],
      ],
      lengthMeters: 222.64,
    },
  ],
}

function road(id: number, nodes: number[], coords: [number, number][]): OverpassWay {
  return {
    id,
    nodes,
    geometry: coords.map(([lon, lat]) => ({ lon, lat })),
    tags: { highway: 'secondary' },
  }
}

describe('graph wire format', () => {
  test('survives a round trip unchanged', () => {
    expect(decodeGraph(encodeGraph(GRAPH))).toEqual(GRAPH)
  })

  test('compresses — a road network is mostly repeated structure', () => {
    const raw = Buffer.byteLength(JSON.stringify(GRAPH))
    expect(encodeGraph(GRAPH).length).toBeLessThan(raw)
  })

  test('encoding is deterministic', () => {
    expect(encodeGraph(GRAPH).equals(encodeGraph(GRAPH))).toBe(true)
  })
})

describe('ingestOperationalArea', () => {
  const ways = [
    road(
      1,
      [1, 2, 3],
      [
        [0, 0],
        [0.001, 0],
        [0.002, 0],
      ],
    ),
  ]

  test('builds a graph with elevations sampled at its nodes', async () => {
    const result = await ingestOperationalArea(AREA, 'Test Area', {
      fetchRoads: async () => ways,
      buildSampler: async () => (lon) => lon * 1000,
    })

    expect(result.graph.edges).toHaveLength(1)
    expect(result.graph.nodes.map((n) => n.id)).toEqual([1, 3])
    expect(result.graph.nodes.map((n) => n.elevation)).toEqual([0, 2])
  })

  test('meta counts what the graph actually holds', async () => {
    const result = await ingestOperationalArea(AREA, 'Test Area', {
      fetchRoads: async () => ways,
      buildSampler: async () => () => 0,
    })

    expect(result.meta.name).toBe('Test Area')
    expect(result.meta.bbox).toEqual(AREA)
    expect(result.meta.nodeCount).toBe(2)
    expect(result.meta.edgeCount).toBe(1)
    expect(result.meta.id).toBeTruthy()
  })

  test('reports progress for each stage', async () => {
    const steps: string[] = []
    await ingestOperationalArea(AREA, 'Test Area', {
      fetchRoads: async () => ways,
      buildSampler: async () => () => 0,
      emit: (step, status) => steps.push(`${step}:${status}`),
    })

    expect(steps).toEqual([
      'roads:start',
      'roads:done',
      'elevation:start',
      'elevation:done',
      'graph:start',
      'graph:done',
    ])
  })

  test('an Overpass failure aborts the ingest rather than yielding a partial graph', async () => {
    // The tactical pipeline degrades here; this one must not. A graph missing
    // roads is a corridor absent from the analysis but present on the ground.
    await expect(
      ingestOperationalArea(AREA, 'Test Area', {
        fetchRoads: async () => {
          throw new Error('all Overpass endpoints failed')
        },
        buildSampler: async () => () => 0,
      }),
    ).rejects.toThrow(/overpass/i)
  })

  test('a DEM failure aborts too', async () => {
    await expect(
      ingestOperationalArea(AREA, 'Test Area', {
        fetchRoads: async () => ways,
        buildSampler: async () => {
          throw new Error('DEM tile 12/1/1 failed: HTTP 500')
        },
      }),
    ).rejects.toThrow(/DEM/i)
  })

  test('refuses ground with no drivable road at all', async () => {
    // An empty graph routes nothing, and silently returning one would surface
    // as "no reinforcement routes exist" rather than "we found no roads".
    await expect(
      ingestOperationalArea(AREA, 'Test Area', {
        fetchRoads: async () => [],
        buildSampler: async () => () => 0,
      }),
    ).rejects.toThrow(/no drivable roads/i)
  })
})
