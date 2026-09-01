import { describe, expect, test } from 'bun:test'
import { buildRecommendations } from '../src/lib/recommendations'
import { summarizeBatch, type ReplayLog, type RunResult } from '../src/types/replay'

/** Recommendations are deterministic and quote their evidence, so they are
 *  testable in a way an LLM suggestion would not be. */

const run = (
  outcome: RunResult['outcome'],
  blueLosses = 0,
  redLosses = 0,
): RunResult => ({
  outcome,
  ticks: 10,
  blueAlive: 7 - blueLosses,
  redAlive: 7 - redLosses,
  blueLosses,
  redLosses,
  shotsFired: 10,
  hits: 5,
})

function replayWithGap(gap: number, aliveAtEnd = 10): ReplayLog {
  const soldiers = (alive: number) => [
    ...Array.from({ length: 5 }, (_, i) => ({
      soldier_index: i,
      team: 'blue' as const,
      position: { x: 10, y: 100, z: 0 },
      survival_status: (i < alive / 2 ? 'alive' : 'dead') as 'alive' | 'dead',
    })),
    ...Array.from({ length: 5 }, (_, i) => ({
      soldier_index: 5 + i,
      team: 'red' as const,
      position: { x: 10, y: 100 - gap, z: 0 },
      survival_status: (i < alive / 2 ? 'alive' : 'dead') as 'alive' | 'dead',
    })),
  ]
  return {
    schema_version: 4,
    battlefield: { width: 200, height: 200, terrain_classes: [] },
    steps: [
      { step: 0, soldiers: soldiers(10), shots: [] },
      { step: 1, soldiers: soldiers(aliveAtEnd), shots: [] },
    ],
  }
}

describe('what to change about a plan', () => {
  test('a mostly inconclusive batch is blamed on the clock, with the arithmetic', () => {
    const outcome = summarizeBatch([run('inconclusive'), run('inconclusive'), run('blue')])
    const [first] = buildRecommendations({
      outcome,
      ticks: 15,
      replay: replayWithGap(60),
    })

    expect(first.id).toBe('inconclusive')
    expect(first.severity).toBe('critical')
    expect(first.evidence).toContain('60 m apart')
    expect(first.fix).toEqual({ kind: 'ticks', ticks: 30 })
  })

  test('a single run is flagged as carrying no confidence', () => {
    const found = buildRecommendations({
      outcome: summarizeBatch([run('blue')]),
      ticks: 60,
      replay: null,
    })

    const confidence = found.find((r) => r.id === 'low-confidence')
    expect(confidence).toBeDefined()
    expect(confidence!.fix).toEqual({ kind: 'runs', runs: 50 })
    expect(confidence!.evidence).toContain('1 run')
  })

  test('a hundred consistent runs need no confidence warning', () => {
    const found = buildRecommendations({
      outcome: summarizeBatch(Array.from({ length: 100 }, () => run('blue'))),
      ticks: 60,
      replay: null,
    })

    expect(found.find((r) => r.id === 'low-confidence')).toBeUndefined()
  })

  test('a win bought with more casualties than it inflicts is called out', () => {
    const found = buildRecommendations({
      outcome: summarizeBatch(Array.from({ length: 100 }, () => run('blue', 6, 2))),
      ticks: 60,
      replay: null,
    })

    const costly = found.find((r) => r.id === 'costly-win')
    expect(costly).toBeDefined()
    expect(costly!.evidence).toContain('6.0')
  })

  test('a losing plan is told to change its approach, not its numbers', () => {
    const found = buildRecommendations({
      outcome: summarizeBatch(Array.from({ length: 100 }, () => run('red', 7, 1))),
      ticks: 60,
      replay: null,
    })

    const losing = found.find((r) => r.id === 'losing')
    expect(losing).toBeDefined()
    expect(losing!.severity).toBe('critical')
  })

  test('mutual destruction is attributed to the model, not to the plan', () => {
    const found = buildRecommendations({
      outcome: summarizeBatch(Array.from({ length: 100 }, () => run('red', 7, 6))),
      ticks: 60,
      replay: replayWithGap(20, 2),
    })

    const attrition = found.find((r) => r.id === 'attrition')
    expect(attrition).toBeDefined()
    expect(attrition!.action).toContain('under fire')
  })

  test('critical findings sort above warnings and notes', () => {
    const found = buildRecommendations({
      outcome: summarizeBatch([run('inconclusive'), run('inconclusive')]),
      ticks: 15,
      replay: replayWithGap(60),
    })

    const severities = found.map((r) => r.severity)
    expect(severities).toEqual([...severities].sort())
    expect(severities[0]).toBe('critical')
  })

  test('an empty batch produces no advice at all', () => {
    expect(
      buildRecommendations({ outcome: summarizeBatch([]), ticks: 60, replay: null }),
    ).toEqual([])
  })
})

describe('a plan that could never have worked', () => {
  test('an unreachable objective replaces every other finding', () => {
    // Nothing else is worth saying: the result says nothing about the plan.
    const found = buildRecommendations({
      outcome: summarizeBatch([run('inconclusive'), run('inconclusive')]),
      ticks: 15,
      replay: null,
      objectiveReachable: false,
    })

    expect(found).toHaveLength(1)
    expect(found[0].id).toBe('unreachable')
    expect(found[0].severity).toBe('critical')
    expect(found[0].action).toContain('cannot succeed')
  })

  test('a reachable objective leaves the normal findings alone', () => {
    const found = buildRecommendations({
      outcome: summarizeBatch([run('inconclusive'), run('inconclusive')]),
      ticks: 15,
      replay: null,
      objectiveReachable: true,
    })

    expect(found.find((r) => r.id === 'unreachable')).toBeUndefined()
    expect(found.length).toBeGreaterThan(0)
  })
})
