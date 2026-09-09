import { describe, expect, test } from 'bun:test'
import {
  allocationByInlet,
  blockInlets,
  blockForceOrbat,
  blockCoverage,
  blockSummary,
  inletMidpoint,
  unblockableByInlet,
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

describe('legacy block plans', () => {
  test('are exposed as one synthetic inlet per corridor', () => {
    expect(blockInlets(PLAN).map((entry) => entry.inlet_id)).toEqual([
      'legacy:cor_a',
      'legacy:cor_b',
      'legacy:cor_c',
    ])
  })

  test('indexes the allocation the engine returned', () => {
    expect(allocationByInlet(PLAN).get('legacy:cor_a')?.unit_name).toBe('1 Platoon')
    expect(allocationByInlet(PLAN).has('legacy:cor_c')).toBe(false)
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

describe('unblockableByInlet', () => {
  test('keeps the engine reason, which is the whole point of the finding', () => {
    expect(unblockableByInlet(PLAN).get('legacy:cor_b')).toBe('no common choke point')
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

describe('inletMidpoint', () => {
  test('is a point on the route, for drawing a block link to', () => {
    expect(inletMidpoint(GRAPH, ['e1'])).toEqual([12, 0])
  })

  test('an inlet with no graph edge has no point', () => {
    expect(inletMidpoint(GRAPH, [])).toBeNull()
    expect(inletMidpoint(GRAPH, ['missing'])).toBeNull()
  })
})

describe('inlet coverage', () => {
  const inletPlan: BlockPlan = {
    inlets: [
      { inlet_id: 'i1', corridor_id: 'cor_a', inlet_number: 1, reserve_id: 'r', objective_id: 'o', edge_ids: ['e1'], candidates: [] },
      { inlet_id: 'i2', corridor_id: 'cor_a', inlet_number: 2, reserve_id: 'r', objective_id: 'o', edge_ids: ['e1'], candidates: [] },
    ],
    allocation: [
      { inlet_id: 'i1', corridor_id: 'cor_a', unit_id: 'u1', unit_name: 'One', distance_meters: 1 },
    ],
    unblockable: [],
    uncovered: [{ inlet_id: 'i2', corridor_id: 'cor_a' }],
  }

  test('a corridor is open when even one of its inlets is uncovered', () => {
    expect(blockCoverage(inletPlan, 'cor_a')).toBe('uncovered')
  })
})
