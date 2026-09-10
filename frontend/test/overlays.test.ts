import { describe, expect, test } from 'bun:test'
import { ASSESSED_HEX, HOSTILE_HEX } from '../src/lib/colors'
import {
  CONDUCT_ECHELON_HEX,
  reserveEchelon,
  reserveMarkColor,
} from '../src/lib/overlays'
import type { StudyMark, TaskOrganizationElement } from '../src/types/routeStudy'

function element(echelon: TaskOrganizationElement['echelon'], order = 1): TaskOrganizationElement {
  return {
    id: `${echelon}-${order}`,
    designation: echelon.toUpperCase(),
    echelon,
    modifier: 'full',
    order_of_move: order,
    platforms: [],
  }
}

function reserve(overrides: Partial<StudyMark> = {}): StudyMark {
  return { id: 'r1', name: 'Reserve', lon: 0, lat: 0, ...overrides }
}

describe('reserveEchelon', () => {
  test('is the largest formation in the task organisation', () => {
    const mark = reserve({ task_organization: [element('company', 1), element('battalion', 2), element('platoon', 3)] })
    expect(reserveEchelon(mark)).toBe('battalion')
  })

  test('is null when nothing is recorded', () => {
    expect(reserveEchelon(reserve())).toBeNull()
    expect(reserveEchelon(reserve({ task_organization: [] }))).toBeNull()
  })
})

describe('reserveMarkColor', () => {
  test('deployment overlay encodes intelligence status, not echelon', () => {
    const confirmed = reserve({ intelligence_status: 'confirmed', task_organization: [element('company')] })
    const assessed = reserve({ intelligence_status: 'assessed', task_organization: [element('battalion')] })
    expect(reserveMarkColor(confirmed, 'deployment')).toBe(HOSTILE_HEX)
    expect(reserveMarkColor(assessed, 'deployment')).toBe(ASSESSED_HEX)
    expect(reserveMarkColor(reserve(), 'deployment')).toBe(ASSESSED_HEX)
  })

  test('conduct of battle overlay encodes echelon: Coy orange, Bn pink, Regt brown', () => {
    expect(reserveMarkColor(reserve({ task_organization: [element('company')] }), 'conduct')).toBe(CONDUCT_ECHELON_HEX.company)
    expect(reserveMarkColor(reserve({ task_organization: [element('battalion')] }), 'conduct')).toBe(CONDUCT_ECHELON_HEX.battalion)
    expect(reserveMarkColor(reserve({ task_organization: [element('regiment')] }), 'conduct')).toBe(CONDUCT_ECHELON_HEX.regiment)
  })

  test('conduct of battle overlay ignores intelligence status', () => {
    const mark = reserve({ intelligence_status: 'confirmed', task_organization: [element('company')] })
    expect(reserveMarkColor(mark, 'conduct')).toBe(CONDUCT_ECHELON_HEX.company)
  })

  test('an echelon doctrine gives no colour for falls back to the hostile default', () => {
    expect(reserveMarkColor(reserve(), 'conduct')).toBe(HOSTILE_HEX)
    expect(reserveMarkColor(reserve({ task_organization: [element('section')] }), 'conduct')).toBe(HOSTILE_HEX)
  })

  test('the two overlays never share a meaning for pink', () => {
    // Deployment pink is "assessed"; conduct pink is "battalion reserve". The
    // doctrine names this as a trap for shared rendering code, so the two
    // constants are deliberately distinct values.
    expect(CONDUCT_ECHELON_HEX.battalion).not.toBe(ASSESSED_HEX)
  })
})
