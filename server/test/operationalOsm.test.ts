import { afterEach, describe, expect, test } from 'bun:test'
import {
  buildMountedRoadQuery,
  fetchOperationalRoads,
  parseOverpassWays,
} from '../src/services/operationalOsm'
import type { BBox } from '../src/types'

/** ~11 km a side at the equator — a plausible operational box. */
const AREA: BBox = { west: 0, south: 0, east: 0.1, north: 0.1 }
/** ~67 km a side, past the cap. */
const TOO_WIDE: BBox = { west: 0, south: 0, east: 0.6, north: 0.6 }

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

function respondWith(elements: unknown[]): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ elements }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })) as unknown as typeof fetch
}

describe('buildMountedRoadQuery', () => {
  const query = buildMountedRoadQuery(AREA)

  test('asks for every drivable class', () => {
    for (const highway of [
      'motorway',
      'trunk',
      'primary',
      'secondary',
      'tertiary',
      'residential',
      'unclassified',
      'service',
      'living_street',
      'track',
    ]) {
      expect(query).toContain(highway)
    }
  })

  test('never asks for ways a vehicle cannot use', () => {
    for (const highway of ['footway', 'cycleway', 'bridleway', 'steps', 'pedestrian']) {
      expect(query).not.toContain(highway)
    }
  })

  test('requests node refs as well as geometry', () => {
    // `out geom` alone omits node ids, leaving junctions inferable only by
    // matching floats -- the whole reason this query is separate.
    expect(query).toContain('out body geom')
  })

  test('asks for nothing but roads', () => {
    for (const unwanted of ['building', 'landuse', 'natural', 'waterway', 'leisure']) {
      expect(query).not.toContain(unwanted)
    }
  })

  test('states the bbox in Overpass order: south, west, north, east', () => {
    expect(buildMountedRoadQuery({ west: 1, south: 2, east: 3, north: 4 })).toContain('(2,1,4,3)')
  })
})

describe('parseOverpassWays', () => {
  const way = {
    type: 'way',
    id: 10,
    nodes: [1, 2],
    geometry: [
      { lat: 0, lon: 0 },
      { lat: 0.001, lon: 0 },
    ],
    tags: { highway: 'residential' },
  }

  test('keeps a way carrying both node refs and geometry', () => {
    expect(parseOverpassWays([way])).toEqual([
      {
        id: 10,
        nodes: [1, 2],
        geometry: [
          { lon: 0, lat: 0 },
          { lon: 0, lat: 0.001 },
        ],
        tags: { highway: 'residential' },
      },
    ])
  })

  test('drops nodes and relations', () => {
    const others = [
      { type: 'node', id: 1, lat: 0, lon: 0 },
      { type: 'relation', id: 2, members: [] },
    ]
    expect(parseOverpassWays(others)).toEqual([])
  })

  test('drops a way with no node refs', () => {
    // `out geom` output: usable for drawing, useless for topology
    const { nodes: _nodes, ...geometryOnly } = way
    expect(parseOverpassWays([geometryOnly])).toEqual([])
  })

  test('drops a way whose geometry does not align with its node refs', () => {
    expect(parseOverpassWays([{ ...way, nodes: [1, 2, 3] }])).toEqual([])
  })

  test('drops a way too short to be an edge', () => {
    expect(
      parseOverpassWays([{ ...way, nodes: [1], geometry: [{ lat: 0, lon: 0 }] }]),
    ).toEqual([])
  })
})

describe('fetchOperationalRoads', () => {
  test('refuses a box past the operational cap before touching the network', async () => {
    globalThis.fetch = (() => {
      throw new Error('should not be called')
    }) as unknown as typeof fetch

    await expect(fetchOperationalRoads(TOO_WIDE)).rejects.toThrow(/too large/i)
  })

  test('returns parsed ways', async () => {
    respondWith([
      {
        type: 'way',
        id: 7,
        nodes: [1, 2],
        geometry: [
          { lat: 0, lon: 0 },
          { lat: 0, lon: 0.001 },
        ],
        tags: { highway: 'track' },
      },
    ])

    const ways = await fetchOperationalRoads(AREA)

    expect(ways).toHaveLength(1)
    expect(ways[0].id).toBe(7)
    expect(ways[0].nodes).toEqual([1, 2])
  })

  test('throws rather than degrading when every mirror fails', async () => {
    // The tactical pipeline treats an Overpass outage as "limited data". Here a
    // missing road is a corridor absent from the analysis but present on the
    // ground, so a partial answer is worse than none.
    globalThis.fetch = (async () =>
      new Response('nope', { status: 503 })) as unknown as typeof fetch

    await expect(fetchOperationalRoads(AREA)).rejects.toThrow(/overpass/i)
  })
})
