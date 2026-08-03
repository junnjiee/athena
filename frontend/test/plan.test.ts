import { beforeEach, describe, expect, test } from 'bun:test'
import { findElementByName, usePlan } from '../src/state/plan'
import { DEFAULT_LOADOUT } from '../src/types/movement'
import type { LonLat } from '../src/types/entities'

const AT: LonLat = { longitude: 103.8, latitude: 1.35 }
const ELSEWHERE: LonLat = { longitude: 103.81, latitude: 1.36 }

beforeEach(() => {
  usePlan.getState().clearPlan()
})

function addRouteFrom(unitId: string) {
  return usePlan.getState().addRoute({
    side: 'blue',
    startUnitId: unitId,
    points: [AT, ELSEWHERE],
    endRef: null,
    movementType: 'patrol',
    loadout: DEFAULT_LOADOUT,
  })
}

describe('placing elements', () => {
  test('units are named by NATO sequence, counted per side', () => {
    usePlan.getState().place('place-blue-section', AT)
    usePlan.getState().place('place-blue-platoon', AT)
    usePlan.getState().place('place-red-section', AT)

    const { units } = usePlan.getState()
    expect(units.map((u) => u.name)).toEqual(['Alpha', 'Bravo', 'Alpha'])
    expect(units.map((u) => u.side)).toEqual(['blue', 'blue', 'red'])
  })

  test('each placement tool stamps its own symbol and side', () => {
    usePlan.getState().place('place-red-platoon', AT)
    usePlan.getState().place('place-prepared-trench', AT)

    const { units } = usePlan.getState()
    expect(units[0]).toMatchObject({ side: 'red', symbolKind: 'redPlatoon' })
    expect(units[1]).toMatchObject({ side: 'red', symbolKind: 'preparedTrench' })
  })

  test('objectives are named OBJ <callsign> and carry a default radius', () => {
    usePlan.getState().place('place-objective', AT)
    const [objective] = usePlan.getState().objectives
    expect(objective.name).toBe('OBJ ALPHA')
    expect(objective.radiusMeters).toBeGreaterThan(0)
  })

  test('place returns the new element id', () => {
    const id = usePlan.getState().place('place-blue-section', AT)
    expect(usePlan.getState().units.find((u) => u.id === id)).toBeDefined()
  })

  test('placing never mutates the previous array', () => {
    usePlan.getState().place('place-blue-section', AT)
    const before = usePlan.getState().units
    usePlan.getState().place('place-blue-section', AT)
    expect(usePlan.getState().units).not.toBe(before)
    expect(before).toHaveLength(1)
  })
})

describe('editing elements', () => {
  test('moving and rotating a unit leaves the others alone', () => {
    const first = usePlan.getState().place('place-blue-section', AT)
    usePlan.getState().place('place-blue-section', AT)

    usePlan.getState().moveUnit(first, ELSEWHERE)
    usePlan.getState().rotateUnit(first, 1.5)

    const units = usePlan.getState().units
    expect(units[0]).toMatchObject({ position: ELSEWHERE, rotationRadians: 1.5 })
    expect(units[1]).toMatchObject({ position: AT, rotationRadians: 0 })
  })

  test('objectives move independently of units', () => {
    const id = usePlan.getState().place('place-objective', AT)
    usePlan.getState().moveObjective(id, ELSEWHERE)
    expect(usePlan.getState().objectives[0].position).toEqual(ELSEWHERE)
  })
})

describe('deleting elements cascades to attached routes', () => {
  test('deleting a unit removes routes that start from it', () => {
    const unit = usePlan.getState().place('place-blue-section', AT)
    addRouteFrom(unit)

    usePlan.getState().deleteUnit(unit)
    expect(usePlan.getState().units).toHaveLength(0)
    expect(usePlan.getState().routes).toHaveLength(0)
  })

  test('deleting a unit removes routes that end on it', () => {
    const from = usePlan.getState().place('place-blue-section', AT)
    const to = usePlan.getState().place('place-blue-section', ELSEWHERE)
    usePlan.getState().addRoute({
      side: 'blue',
      startUnitId: from,
      points: [AT, ELSEWHERE],
      endRef: { kind: 'unit', id: to },
      movementType: 'patrol',
      loadout: DEFAULT_LOADOUT,
    })

    usePlan.getState().deleteUnit(to)
    expect(usePlan.getState().routes).toHaveLength(0)
  })

  test('deleting an objective removes routes that ended on it', () => {
    const unit = usePlan.getState().place('place-blue-section', AT)
    const objective = usePlan.getState().place('place-objective', ELSEWHERE)
    usePlan.getState().addRoute({
      side: 'blue',
      startUnitId: unit,
      points: [AT, ELSEWHERE],
      endRef: { kind: 'objective', id: objective },
      movementType: 'patrol',
      loadout: DEFAULT_LOADOUT,
    })

    usePlan.getState().deleteObjective(objective)
    expect(usePlan.getState().objectives).toHaveLength(0)
    expect(usePlan.getState().routes).toHaveLength(0)
    // the unit itself is untouched
    expect(usePlan.getState().units).toHaveLength(1)
  })

  test('deleting a route leaves its unit standing', () => {
    const unit = usePlan.getState().place('place-blue-section', AT)
    const route = addRouteFrom(unit)

    usePlan.getState().deleteRoute(route)
    expect(usePlan.getState().routes).toHaveLength(0)
    expect(usePlan.getState().units).toHaveLength(1)
  })

  test('deleteElement dispatches on whatever kind the id belongs to', () => {
    const unit = usePlan.getState().place('place-blue-section', AT)
    const objective = usePlan.getState().place('place-objective', ELSEWHERE)
    const route = addRouteFrom(unit)

    usePlan.getState().deleteElement(route)
    expect(usePlan.getState().routes).toHaveLength(0)

    usePlan.getState().deleteElement(objective)
    expect(usePlan.getState().objectives).toHaveLength(0)

    usePlan.getState().deleteElement(unit)
    expect(usePlan.getState().units).toHaveLength(0)
  })

  test('deleteElement on an unknown id is a no-op', () => {
    usePlan.getState().place('place-blue-section', AT)
    usePlan.getState().deleteElement('not-a-real-id')
    expect(usePlan.getState().units).toHaveLength(1)
  })
})

describe('loading and clearing', () => {
  test('seedFromSaved replaces the whole drawing', () => {
    usePlan.getState().place('place-blue-section', AT)
    usePlan.getState().seedFromSaved({
      name: 'Ridge Probe',
      units: [],
      objectives: [],
      routes: [],
    })

    expect(usePlan.getState().planName).toBe('Ridge Probe')
    expect(usePlan.getState().units).toHaveLength(0)
  })

  test('clearPlan empties everything including the name', () => {
    usePlan.getState().setPlanName('Something')
    const unit = usePlan.getState().place('place-blue-section', AT)
    addRouteFrom(unit)

    usePlan.getState().clearPlan()
    const state = usePlan.getState()
    expect(state.planName).toBe('')
    expect(state.units).toHaveLength(0)
    expect(state.routes).toHaveLength(0)
  })
})

describe('findElementByName', () => {
  test('finds a unit by callsign, case-insensitively', () => {
    const id = usePlan.getState().place('place-blue-section', AT)
    expect(findElementByName(usePlan.getState(), 'alpha')).toMatchObject({ id, kind: 'unit' })
    expect(findElementByName(usePlan.getState(), '  ALPHA ')).toMatchObject({ id })
  })

  test('finds an objective with or without its OBJ prefix', () => {
    const id = usePlan.getState().place('place-objective', AT)
    expect(findElementByName(usePlan.getState(), 'alpha')).toMatchObject({ id, kind: 'objective' })
    expect(findElementByName(usePlan.getState(), 'OBJ ALPHA')).toMatchObject({ id })
  })

  test('a unit wins over an objective sharing its callsign', () => {
    const unit = usePlan.getState().place('place-blue-section', AT)
    usePlan.getState().place('place-objective', ELSEWHERE)
    expect(findElementByName(usePlan.getState(), 'Alpha')).toMatchObject({ id: unit, kind: 'unit' })
  })

  test('unknown and empty names find nothing', () => {
    usePlan.getState().place('place-blue-section', AT)
    expect(findElementByName(usePlan.getState(), 'Zulu')).toBeNull()
    expect(findElementByName(usePlan.getState(), '   ')).toBeNull()
  })
})
