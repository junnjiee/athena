import { describe, expect, test } from 'bun:test'
import {
  allocationByCorridor,
  blockForceOrbat,
  blockCoverage,
  blockSummary,
  chokeMidpoint,
  unblockableByCorridor,
} from '../src/lib/blockForces'
import type { BlockPlan, OrbatUnit, RoadGraph } from '../src/types/routeStudy'

const PLAN: BlockPlan = {
  corridors: [
    { corridor_id: 'cor_a', choke_edge_ids: ['e1'], candidates: [] },
    { corridor_id: 'cor_b', choke_edge_ids: [], candidates: [] },
    { corridor_id: 'cor_c', choke_edge_ids: ['e2'], candidates: [] },
  ],
  allocation: [
    { corridor_id: 'cor_a', unit_id: '1-pl', unit_name: '1 Platoon', distance_meters: 1200 },
  ],
  unblockable: [{ corridor_id: 'cor_b', reason: 'no common choke point' }],
  uncovered: [{ corridor_id: 'cor_c' }],
}

describe('allocationByCorridor', () => {
  test('indexes the allocation the engine returned', () => {
    expect(allocationByCorridor(PLAN).get('cor_a')?.unit_name).toBe('1 Platoon')
    expect(allocationByCorridor(PLAN).has('cor_c')).toBe(false)
  })
})

describe('blockCoverage', () => {
  test('an allocated corridor reads as blocked', () => {
    expect(blockCoverage(PLAN, 'cor_a')).toBe('allocated')
  })

  test('unblockable and uncovered stay apart', () => {
    expect(blockCoverage(PLAN, 'cor_b')).toBe('unblockable')
    expect(blockCoverage(PLAN, 'cor_c')).toBe('uncovered')
  })

  test('a corridor the plan never saw is unknown, not covered', () => {
    expect(blockCoverage(PLAN, 'cor_z')).toBe('unknown')
  })

  test('no plan at all is unknown for every corridor', () => {
    expect(blockCoverage(null, 'cor_a')).toBe('unknown')
  })
})

describe('unblockableByCorridor', () => {
  test('keeps the engine reason, which is the whole point of the finding', () => {
    expect(unblockableByCorridor(PLAN).get('cor_b')).toBe('no common choke point')
  })
})

describe('blockSummary', () => {
  test('counts each outcome once', () => {
    expect(blockSummary(PLAN)).toEqual({ allocated: 1, uncovered: 1, unblockable: 1 })
  })
})

describe('blockForceOrbat', () => {
  const units: OrbatUnit[] = [
    {
      unit_id: 'coy', name: 'A Company', echelon: 'company', parent_id: null,
      lon: 103.8, lat: 1.35, strength: 90, availability: 'uncommitted',
    },
    {
      unit_id: '1-pl', name: '1 Platoon', echelon: 'platoon', parent_id: 'coy',
      lon: 103.8, lat: 1.35, strength: 24, availability: 'uncommitted', redcon: 2,
    },
    {
      unit_id: '1-sec', name: '1 Section', echelon: 'section', parent_id: '1-pl',
      lon: 103.8, lat: 1.35, strength: 7, availability: 'uncommitted', redcon: 3,
    },
    {
      unit_id: '2-pl', name: '2 Platoon', echelon: 'platoon', parent_id: 'coy',
      lon: 103.8, lat: 1.35, strength: 24, availability: 'uncommitted',
    },
  ]

  test('roots the task organisation at the allocated unit and includes its descendants', () => {
    expect(blockForceOrbat(units, '1-pl').map(({ unit, depth }) => [unit.unit_id, depth])).toEqual([
      ['1-pl', 0],
      ['1-sec', 1],
    ])
  })

  test('does not treat ancestors or sibling formations as part of the block force', () => {
    expect(blockForceOrbat(units, '1-sec').map(({ unit }) => unit.unit_id)).toEqual(['1-sec'])
    expect(blockForceOrbat(units, 'missing')).toEqual([])
  })
})

const GRAPH: RoadGraph = {
  nodes: [],
  edges: [
    {
      id: 'e1',
      wayId: 1,
      from: 1,
      to: 2,
      roadClass: 'primary',
      nodes: [1, 2],
      points: [
        [10, 0],
        [12, 0],
      ],
      lengthMeters: 100,
    },
  ],
}

describe('chokeMidpoint', () => {
  test('is a point on the choke edge, for drawing a block link to', () => {
    expect(chokeMidpoint(GRAPH, ['e1'])).toEqual([12, 0])
  })

  test('a corridor with no choke edge has no point', () => {
    expect(chokeMidpoint(GRAPH, [])).toBeNull()
    expect(chokeMidpoint(GRAPH, ['missing'])).toBeNull()
  })
})
