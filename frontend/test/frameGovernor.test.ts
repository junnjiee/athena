import { describe, expect, test } from 'bun:test'
import {
  DEGRADE_FRAMES,
  ENTRY_TIER,
  QUALITY_TIERS,
  RECOVER_FRAMES,
  initialGovernor,
  stepGovernor,
  type GovernorState,
} from '../src/lib/frameGovernor'

function run(state: GovernorState, frameMs: number, frames: number): GovernorState {
  let s = state
  for (let i = 0; i < frames; i++) s = stepGovernor(s, frameMs)
  return s
}

describe('quality tiers', () => {
  test('degrade monotonically: coarser tiles, lower resolution', () => {
    for (let i = 1; i < QUALITY_TIERS.length; i++) {
      expect(QUALITY_TIERS[i].sse).toBeGreaterThan(QUALITY_TIERS[i - 1].sse)
      expect(QUALITY_TIERS[i].resolutionScale).toBeLessThanOrEqual(QUALITY_TIERS[i - 1].resolutionScale)
    }
  })

  test('splats survive every tier except the last', () => {
    expect(QUALITY_TIERS.slice(0, -1).every((t) => t.splats)).toBe(true)
    expect(QUALITY_TIERS[QUALITY_TIERS.length - 1].splats).toBe(false)
  })
})

describe('stepGovernor', () => {
  test('sustained slow frames degrade one tier at a time', () => {
    const start = initialGovernor()
    // EMA needs time to cross the threshold, then DEGRADE_FRAMES to act
    const degraded = run(start, 100, DEGRADE_FRAMES + 60)
    expect(degraded.tier).toBe(ENTRY_TIER + 1)
  })

  test('sustained fast frames sharpen back toward T0', () => {
    const recovered = run(initialGovernor(), 8, RECOVER_FRAMES * QUALITY_TIERS.length + 200)
    expect(recovered.tier).toBe(0)
  })

  test('borderline frame times hold the current tier (hysteresis)', () => {
    const held = run(initialGovernor(), 30, 1000)
    expect(held.tier).toBe(ENTRY_TIER)
  })

  test('never leaves the tier ladder', () => {
    expect(run(initialGovernor(QUALITY_TIERS.length - 1), 200, 2000).tier).toBe(QUALITY_TIERS.length - 1)
    expect(run(initialGovernor(0), 4, 2000).tier).toBe(0)
  })

  test('a single spike cannot trigger a degrade', () => {
    let s = run(initialGovernor(), 16, 50)
    s = stepGovernor(s, 5000) // clamped spike
    s = run(s, 16, DEGRADE_FRAMES)
    expect(s.tier).toBe(ENTRY_TIER)
  })

  test('does not mutate its input state', () => {
    const s = initialGovernor()
    const copy = { ...s }
    stepGovernor(s, 100)
    expect(s).toEqual(copy)
  })
})
