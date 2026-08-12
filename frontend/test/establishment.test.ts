import { describe, expect, test } from 'bun:test'
import { countSoldiers, soldiersBySide, soldiersFor } from '../src/lib/establishment'
import type { PlacedUnit } from '../src/types/entities'

function unit(overrides: Partial<PlacedUnit> = {}): PlacedUnit {
  return {
    id: 'unit-1',
    side: 'blue',
    name: 'Alpha',
    typeLabel: 'Rifle Platoon',
    position: { longitude: 103.8, latitude: 1.35 },
    symbolKind: 'bluePlatoon',
    rotationRadians: 0,
    ...overrides,
  }
}

describe('soldiersFor', () => {
  test('a marker fields its establishment, not itself', () => {
    expect(soldiersFor(unit({ strength: 21 }))).toBe(21)
  })

  test('a marker drawn before templates existed counts as one', () => {
    expect(soldiersFor(unit())).toBe(1)
  })

  test('a fortification is a position, so it fields its single holder', () => {
    expect(soldiersFor(unit({ symbolKind: 'trench', strength: 21 }))).toBe(1)
    expect(soldiersFor(unit({ symbolKind: 'preparedTrench' }))).toBe(1)
  })

  test('never fields less than one soldier, whatever the stored value', () => {
    expect(soldiersFor(unit({ strength: 0 }))).toBe(1)
    expect(soldiersFor(unit({ strength: -4 }))).toBe(1)
  })
})

describe('counting a plan', () => {
  const plan = [
    unit({ id: 'a', strength: 21 }),
    unit({ id: 'b', side: 'red', strength: 7 }),
    unit({ id: 'c', side: 'red', symbolKind: 'trench' }),
  ]

  test('totals the whole force', () => {
    expect(countSoldiers(plan)).toBe(29)
  })

  test('splits by side, which is what decides whether a run can happen at all', () => {
    expect(soldiersBySide(plan)).toEqual({ blue: 21, red: 8 })
  })

  test('an empty plan fields nobody', () => {
    expect(countSoldiers([])).toBe(0)
    expect(soldiersBySide([])).toEqual({ blue: 0, red: 0 })
  })
})
