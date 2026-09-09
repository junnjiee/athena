import { describe, expect, test } from 'bun:test'
import {
  allocationByCorridor,
  blockCoverage,
  blockSummary,
  chokeMidpoint,
  unblockableByCorridor,
} from '../src/lib/blockForces'
import type { BlockPlan, RoadGraph } from '../src/types/routeStudy'

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
