import { describe, expect, test } from 'bun:test'
import { summarizeBatch, type RunResult } from '../src/types/replay'

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
