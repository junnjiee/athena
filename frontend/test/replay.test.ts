import { describe, expect, test } from 'bun:test'
import { summarizeBatch, wilsonInterval, type RunResult } from '../src/types/replay'

/** Per-run scoring lives in server/src/services/replaySummary.ts — the browser
 *  never sees a replay. Only the aggregate across runs is computed here. */
const run = (outcome: RunResult['outcome'], blueLosses = 0, redLosses = 0): RunResult => ({
  outcome,
  ticks: 10,
  blueAlive: 0,
  redAlive: 0,
  blueLosses,
  redLosses,
  shotsFired: 0,
  hits: 0,
})

describe('summarizeBatch', () => {
  test('reports the blue win rate over every scored run', () => {
    const outcome = summarizeBatch([run('blue'), run('blue'), run('red'), run('inconclusive')])

    expect(outcome.runs).toBe(4)
    expect(outcome.blueWins).toBe(2)
    expect(outcome.redWins).toBe(1)
    expect(outcome.inconclusive).toBe(1)
    expect(outcome.blueWinRate).toBe(0.5)
  })

  test('averages losses across runs', () => {
    const outcome = summarizeBatch([run('blue', 2, 6), run('blue', 4, 4)])

    expect(outcome.meanBlueLosses).toBe(3)
    expect(outcome.meanRedLosses).toBe(5)
  })

  test('an empty batch reports a zero rate rather than dividing by nothing', () => {
    const outcome = summarizeBatch([])

    expect(outcome.runs).toBe(0)
    expect(outcome.blueWinRate).toBe(0)
    expect(outcome.meanTicks).toBe(0)
  })
})

describe('confidence in a win rate', () => {
  test('a single run tells you almost nothing', () => {
    // The point of reporting an interval: one win is not a 100% plan.
    const { low, high } = wilsonInterval(1, 1)

    expect(low).toBeLessThan(0.3)
    expect(high).toBe(1)
  })

  test('the interval narrows as runs accumulate', () => {
    const few = wilsonInterval(6, 10)
    const many = wilsonInterval(60, 100)

    expect(high(few) - low(few)).toBeGreaterThan(high(many) - low(many))
  })

  test('bounds stay inside 0 and 1 even at the extremes', () => {
    // Where the normal approximation would put them outside.
    const none = wilsonInterval(0, 20)
    const all = wilsonInterval(20, 20)

    expect(none.low).toBe(0)
    expect(all.high).toBeCloseTo(1, 10)
    expect(none.high).toBeGreaterThan(0)
    expect(all.low).toBeLessThan(1)
  })

  test('no runs means no information, not zero percent', () => {
    expect(wilsonInterval(0, 0)).toEqual({ low: 0, high: 1 })
  })
})

const low = (i: { low: number; high: number }) => i.low
const high = (i: { low: number; high: number }) => i.high
