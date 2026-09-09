import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_STRENGTH,
  ECHELON_ORDER,
  availabilitySummary,
  commitsWith,
  orbatIssues,
  orbatRows,
  validParents,
  weaponSummary,
} from '../src/lib/orbatTree'
import type { Echelon, OrbatUnit } from '../src/types/routeStudy'

function unit(
  unit_id: string,
  echelon: Echelon,
  parent_id: string | null = null,
  overrides: Partial<OrbatUnit> = {},
): OrbatUnit {
  return {
    unit_id,
    name: unit_id.toUpperCase(),
    echelon,
    parent_id,
    lon: 103.8,
    lat: 1.35,
    strength: DEFAULT_STRENGTH[echelon],
    availability: 'uncommitted',
    ...overrides,
  }
}

const COMPANY = [
  unit('a-coy', 'company'),
  unit('1-pl', 'platoon', 'a-coy'),
  unit('1-sec', 'section', '1-pl'),
  unit('2-sec', 'section', '1-pl'),
  unit('2-pl', 'platoon', 'a-coy'),
]

describe('echelons', () => {
  test('run largest first', () => {
    expect(ECHELON_ORDER).toEqual(['company', 'platoon', 'section', 'group'])
  })

})

describe('orbatIssues', () => {
  test('a well-formed tree has none', () => {
    expect(orbatIssues(COMPANY)).toEqual([])
  })

  test('an unknown parent is reported', () => {
    const issues = orbatIssues([unit('1-pl', 'platoon', 'ghost')])
    expect(issues).toHaveLength(1)
    expect(issues[0]).toContain('unknown')
  })

  test('a parent must be a higher echelon than its child', () => {
    const issues = orbatIssues([unit('1-sec', 'section'), unit('2-sec', 'section', '1-sec')])
    expect(issues).toHaveLength(1)
    expect(issues[0]).toContain('higher echelon')
  })

  test('a blank name is reported, because the engine rejects it', () => {
    expect(orbatIssues([unit('1-sec', 'section', null, { name: '  ' })])).toHaveLength(1)
  })

  test('strength must be at least one soldier', () => {
    expect(orbatIssues([unit('1-sec', 'section', null, { strength: 0 })])).toHaveLength(1)
  })

  test('weapon holdings require unique systems and positive whole counts', () => {
    expect(orbatIssues([
      unit('1-sec', 'section', null, {
        weapons: [
          { id: 'one', weapon: 'LAW', count: 1 },
          { id: 'two', weapon: 'LAW', count: 0 },
        ],
      }),
    ])).toEqual([
      '1-SEC: combine duplicate LAW holdings',
      '1-SEC: LAW count must be a positive whole number',
    ])
  })
})

describe('weaponSummary', () => {
  test('uses count-times-system notation without collapsing capabilities', () => {
    expect(weaponSummary([
      { weapon: 'ATGM', count: 2 },
      { weapon: 'LAW', count: 3 },
    ])).toBe('2× ATGM · 3× LAW')
    expect(weaponSummary([])).toBe('No weapons recorded')
  })
})

describe('orbatRows', () => {
  test('nests children under their parent with a depth for indentation', () => {
    const rows = orbatRows(COMPANY)
    expect(rows.map((row) => [row.unit.unit_id, row.depth])).toEqual([
      ['a-coy', 0],
      ['1-pl', 1],
      ['1-sec', 2],
      ['2-sec', 2],
      ['2-pl', 1],
    ])
    expect(rows.map((row) => [row.unit.unit_id, row.isLast, row.ancestorHasNext, row.hasChildren])).toEqual([
      ['a-coy', true, [], true],
      ['1-pl', false, [], true],
      ['1-sec', false, [true], false],
      ['2-sec', true, [true], false],
      ['2-pl', true, [], false],
    ])
  })

  test('a unit whose parent is missing still shows, at the root', () => {
    const rows = orbatRows([unit('orphan', 'section', 'ghost')])
    expect(rows.map((row) => row.unit.unit_id)).toEqual(['orphan'])
    expect(rows[0].depth).toBe(0)
  })

  test('a parent cycle cannot hide a unit', () => {
    const rows = orbatRows([unit('x', 'platoon', 'y'), unit('y', 'platoon', 'x')])
    expect(rows.map((row) => row.unit.unit_id).sort()).toEqual(['x', 'y'])
  })
})

describe('validParents', () => {
  test('offers only strictly higher echelons', () => {
    const ids = validParents(COMPANY, COMPANY[2]).map((u) => u.unit_id)
    expect(ids).toEqual(['a-coy', '1-pl', '2-pl'])
  })

  test('never offers the unit itself or anything under it', () => {
    const ids = validParents(COMPANY, COMPANY[0]).map((u) => u.unit_id)
    expect(ids).toEqual([])
  })
})

describe('commitsWith', () => {
  test('spends the tree in both directions', () => {
    expect(commitsWith(COMPANY, '1-pl')).toEqual(new Set(['1-pl', '1-sec', '2-sec', 'a-coy']))
  })

  test('a lone unit spends only itself', () => {
    expect(commitsWith(COMPANY, '2-pl')).toEqual(new Set(['2-pl', 'a-coy']))
  })
})

describe('availabilitySummary', () => {
  test('counts what is actually free to be given a task', () => {
    const units = [
      unit('a-coy', 'company'),
      unit('1-pl', 'platoon', 'a-coy', { availability: 'committed' }),
      unit('2-pl', 'platoon', 'a-coy', { availability: 'reserve' }),
    ]
    expect(availabilitySummary(units)).toEqual({
      total: 3,
      uncommitted: 1,
      committed: 1,
      reserve: 1,
    })
  })
})
