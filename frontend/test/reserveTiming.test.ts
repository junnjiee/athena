import { describe, expect, test } from 'bun:test'
import {
  formatOperationalOffset,
  reserveCommencementMinutes,
  reserveTaskCompleteMinutes,
} from '../src/lib/reserveTiming'

describe('reserve timing', () => {
  test('does not turn an unknown stage into zero', () => {
    expect(reserveCommencementMinutes({ decision_minutes: 10 })).toBeNull()
    expect(reserveTaskCompleteMinutes({
      decision_minutes: 10,
      readiness_minutes: 20,
    }, 600)).toBeNull()
  })

  test('combines decision, readiness, routed movement and deployment', () => {
    const timing = { decision_minutes: 10, readiness_minutes: 20, deployment_minutes: 15 }
    expect(reserveCommencementMinutes(timing)).toBe(30)
    expect(reserveTaskCompleteMinutes(timing, 900)).toBe(60)
  })

  test('formats operational offsets at minute and hour scales', () => {
    expect(formatOperationalOffset(30)).toBe('+30 min')
    expect(formatOperationalOffset(75)).toBe('+1 hr 15 min')
  })
})
