import { describe, expect, test } from 'bun:test'
import { filterPlans, sortPlans } from '../src/lib/planSort'
import type { PlanSummary } from '../src/types/plan'

const plan = (
  id: string,
  name: string,
  battlegroundName: string,
  createdAt: string,
  updatedAt: string,
): PlanSummary => ({ id, name, battlegroundName, createdAt, updatedAt })

/** Deliberately ordered so no single key reproduces another key's order. */
const PLANS: PlanSummary[] = [
  plan('a', 'Zulu Probe', 'Hill 265', '2026-01-01T00:00:00Z', '2026-03-01T00:00:00Z'),
  plan('b', 'Alpha Push', 'Bukit Timah', '2026-02-01T00:00:00Z', '2026-01-15T00:00:00Z'),
  plan('c', 'Mike Feint', 'Hill 265', '2026-03-01T00:00:00Z', '2026-02-01T00:00:00Z'),
]

describe('sortPlans', () => {
  test('updated is newest-edited first', () => {
    expect(sortPlans(PLANS, 'updated').map((p) => p.id)).toEqual(['a', 'c', 'b'])
  })

  test('created is newest-created first, which differs from updated here', () => {
    expect(sortPlans(PLANS, 'created').map((p) => p.id)).toEqual(['c', 'b', 'a'])
  })

  test('name is alphabetical', () => {
    expect(sortPlans(PLANS, 'name').map((p) => p.name)).toEqual([
      'Alpha Push',
      'Mike Feint',
      'Zulu Probe',
    ])
  })

  test('ground groups by battleground, then by plan name inside it', () => {
    expect(sortPlans(PLANS, 'ground').map((p) => p.id)).toEqual(['b', 'c', 'a'])
  })

  test('never sorts the caller list in place', () => {
    const original = [...PLANS]
    sortPlans(PLANS, 'name')
    expect(PLANS).toEqual(original)
  })

  test('an empty list stays empty', () => {
    expect(sortPlans([], 'name')).toEqual([])
  })
})

describe('filterPlans', () => {
  test('matches a plan name, case-insensitively', () => {
    expect(filterPlans(PLANS, 'alpha').map((p) => p.id)).toEqual(['b'])
    expect(filterPlans(PLANS, 'ALPHA').map((p) => p.id)).toEqual(['b'])
  })

  test('matches the ground name too', () => {
    expect(filterPlans(PLANS, 'hill 265').map((p) => p.id)).toEqual(['a', 'c'])
  })

  test('matches on a substring, not just a prefix', () => {
    expect(filterPlans(PLANS, 'feint').map((p) => p.id)).toEqual(['c'])
  })

  test('an empty or whitespace query returns everything', () => {
    expect(filterPlans(PLANS, '')).toHaveLength(3)
    expect(filterPlans(PLANS, '   ')).toHaveLength(3)
  })

  test('no match returns nothing rather than everything', () => {
    expect(filterPlans(PLANS, 'nonexistent')).toEqual([])
  })
})
