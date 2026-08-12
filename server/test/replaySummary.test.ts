import { describe, expect, test } from 'bun:test'
import {
  summarizeRun,
  type ReplayLog,
  type ReplaySoldier,
  type ReplayStep,
} from '../src/services/replaySummary'

function soldier(
  index: number,
  team: ReplaySoldier['team'],
  status: ReplaySoldier['survival_status'] = 'alive',
): ReplaySoldier {
  return { soldier_index: index, team, survival_status: status }
}

function step(index: number, soldiers: ReplaySoldier[], shots: { hit: boolean }[] = []): ReplayStep {
  return { step: index, soldiers, shots }
}

function replay(steps: ReplayStep[]): ReplayLog {
  return { schema_version: 3, steps }
}

const laydown = [soldier(0, 'blue'), soldier(1, 'blue'), soldier(2, 'red')]

describe('summarizeRun', () => {
  test('blue takes it when no red soldier is left alive', () => {
    const result = summarizeRun(
      replay([
        step(0, laydown),
        step(1, [soldier(0, 'blue'), soldier(1, 'blue'), soldier(2, 'red', 'casualty')]),
      ]),
    )

    expect(result.outcome).toBe('blue')
    expect(result.redLosses).toBe(1)
    expect(result.blueLosses).toBe(0)
    expect(result.blueAlive).toBe(2)
  })

  test('red takes it when no blue soldier is left alive', () => {
    const result = summarizeRun(
      replay([
        step(0, laydown),
        step(1, [soldier(0, 'blue', 'casualty'), soldier(1, 'blue', 'dead'), soldier(2, 'red')]),
      ]),
    )

    expect(result.outcome).toBe('red')
    expect(result.blueLosses).toBe(2)
  })

  test('both sides still standing is inconclusive, not a loss', () => {
    // The engine stops at its tick limit, so this is the clock running out --
    // the commonest result on ground wider than the tick budget can cross.
    expect(summarizeRun(replay([step(0, laydown), step(1, laydown)])).outcome).toBe('inconclusive')
  })

  test('mutual destruction is inconclusive -- nobody took the ground', () => {
    const result = summarizeRun(
      replay([
        step(0, laydown),
        step(1, [
          soldier(0, 'blue', 'casualty'),
          soldier(1, 'blue', 'casualty'),
          soldier(2, 'red', 'casualty'),
        ]),
      ]),
    )

    expect(result.outcome).toBe('inconclusive')
  })

  test('counts ticks excluding the initial laydown, and tallies fire', () => {
    const result = summarizeRun(
      replay([
        step(0, laydown),
        step(1, laydown, [{ hit: true }, { hit: false }]),
        step(2, laydown, [{ hit: false }]),
      ]),
    )

    expect(result.ticks).toBe(2)
    expect(result.shotsFired).toBe(3)
    expect(result.hits).toBe(1)
  })

  test('a replay with no steps does not throw', () => {
    // Defensive because this parses whatever the engine wrote to the bucket, and
    // a summariser that throws would take down the whole event stream.
    const result = summarizeRun(replay([]))

    expect(result.outcome).toBe('inconclusive')
    expect(result.ticks).toBe(0)
  })
})
