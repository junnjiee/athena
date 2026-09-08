import { describe, expect, test } from 'bun:test'
import {
  chokeToggle,
  corridorColor,
  corridorEdgeIds,
  corridorLabel,
  corridorMinutes,
  isChokeBlocked,
  unreachableSummary,
} from '../src/lib/corridors'
import type { Corridor, StudyResult } from '../src/types/routeStudy'

function corridor(id: string, edgeSets: string[][], choke: string[], seconds = 600): Corridor {
  return {
    id,
    fastest_seconds: seconds,
    choke_edge_ids: choke,
    routes: edgeSets.map((edge_ids) => ({
      reserve_id: 'res1',
      objective_id: 'obj1',
      edge_ids,
      node_ids: [],
      seconds,
      length_meters: 1000,
    })),
  }
}

const VALLEY = corridor('cor_a', [['e1', 'e2'], ['e1', 'e3']], ['e1'])

describe('corridorLabel', () => {
  test('falls back to a rank, never the raw id', () => {
    // a hash identifies ground; it does not name an approach
    expect(corridorLabel(VALLEY, 0, {})).toBe('Corridor 1')
    expect(corridorLabel(VALLEY, 0, {})).not.toContain('cor_')
  })

  test("prefers the operator's name", () => {
    expect(corridorLabel(VALLEY, 0, { cor_a: { name: 'Northern valley' } })).toBe('Northern valley')
  })

  test('ignores a blank name', () => {
    expect(corridorLabel(VALLEY, 2, { cor_a: { name: '   ' } })).toBe('Corridor 3')
  })
})

describe('corridorEdgeIds', () => {
  test('is the union across routes, without repeats', () => {
    expect(corridorEdgeIds(VALLEY).sort()).toEqual(['e1', 'e2', 'e3'])
  })
})

describe('corridorMinutes', () => {
  test('reports the fastest route in whole minutes', () => {
    expect(corridorMinutes(VALLEY)).toBe(10)
  })
})

describe('corridorColor', () => {
  test('wraps rather than running out', () => {
    expect(corridorColor(0)).toBe(corridorColor(8))
  })

  test('adjacent corridors differ', () => {
    expect(corridorColor(0)).not.toBe(corridorColor(1))
  })
})

describe('blocking a corridor', () => {
  test('is blocked only when the whole choke point is', () => {
    const wide = corridor('cor_b', [['e1', 'e2']], ['e1', 'e2'])

    expect(isChokeBlocked(wide, ['e1'])).toBe(false)
    expect(isChokeBlocked(wide, ['e1', 'e2'])).toBe(true)
  })

  test('blocking adds exactly the choke edges', () => {
    const { canBlock, next } = chokeToggle(VALLEY, [])

    expect(canBlock).toBe(true)
    expect(next).toEqual(['e1'])
  })

  test('blocking again unblocks it', () => {
    expect(chokeToggle(VALLEY, ['e1']).next).toEqual([])
  })

  test('never disturbs ground blocked for another reason', () => {
    expect(chokeToggle(VALLEY, ['e9']).next).toEqual(['e1', 'e9'])
  })

  test('a corridor with no common edge cannot be blocked at one point', () => {
    // saying so beats offering a button that does nothing
    const diffuse = corridor('cor_c', [['e1'], ['e2']], [])
    const { canBlock, next } = chokeToggle(diffuse, ['e9'])

    expect(canBlock).toBe(false)
    expect(next).toEqual(['e9'])
    expect(isChokeBlocked(diffuse, [])).toBe(false)
  })
})

describe('unreachableSummary', () => {
  test('names the marks rather than echoing ids', () => {
    const result: StudyResult = {
      corridors: [],
      unreachable: [
        { reserve_id: 'res1', objective_id: 'obj1', reason: 'no drivable route between these marks' },
      ],
    }
    const marks = {
      reserves: [{ id: 'res1', name: 'Depot' }],
      objectives: [{ id: 'obj1', name: 'Bridge' }],
    }

    expect(unreachableSummary(result, marks)).toEqual([
      'Depot → Bridge: no drivable route between these marks',
    ])
  })

  test('falls back to the id when a mark has since been removed', () => {
    const result: StudyResult = {
      corridors: [],
      unreachable: [{ reserve_id: 'gone', objective_id: 'obj1', reason: 'no road network near this mark' }],
    }

    expect(
      unreachableSummary(result, { reserves: [], objectives: [{ id: 'obj1', name: 'Bridge' }] })[0],
    ).toContain('gone')
  })
})
