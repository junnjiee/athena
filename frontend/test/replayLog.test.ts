import { beforeEach, describe, expect, test } from 'bun:test'
import { useReplay } from '../src/state/replay'
import type { ReplayLog, SavedSimulationRun } from '../src/types/replayLog'
import type { BattlegroundMeta, GridData, OsmFeatures } from '../src/types/terrain'

// requestAnimationFrame/cancelAnimationFrame don't exist in bun's test runtime
// (no DOM) -- play()/pause() need them to start/stop the playback loop, so
// stub them the same way mission.test.ts stubs globalThis.fetch.
globalThis.requestAnimationFrame = (() => 0) as typeof requestAnimationFrame
globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame

function replayLog(stepCount: number): ReplayLog {
  return {
    schema_version: 3,
    battlefield: {
      width: 2,
      height: 2,
      surface: [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 0, y: 1, z: 0 },
        { x: 1, y: 1, z: 0 },
      ],
      terrain_classes: [0, 0, 0, 0],
      communication_groups: [],
    },
    steps: Array.from({ length: stepCount }, (_, i) => ({
      step: i,
      soldiers: [{ soldier_index: 0, team: 'blue', position: { x: i, y: 0, z: 0 }, survival_status: 'alive' }],
      shots: [],
      messages: [],
    })),
  }
}

function fakeRun(stepCount: number): SavedSimulationRun {
  return {
    run: { id: 'run-1', name: 'Run 1', createdAt: '2026-01-01T00:00:00.000Z' },
    replay: replayLog(stepCount),
    meta: {} as BattlegroundMeta,
    features: {} as OsmFeatures,
    grid: {} as GridData,
  }
}

beforeEach(() => {
  useReplay.getState().clear()
})

describe('seek', () => {
  test('clamps to [0, lastStep]', () => {
    useReplay.setState({ run: fakeRun(5) })
    useReplay.getState().seek(-3)
    expect(useReplay.getState().currentStep).toBe(0)
    useReplay.getState().seek(99)
    expect(useReplay.getState().currentStep).toBe(4)
  })

  test('resets interpolation progress', () => {
    useReplay.setState({ run: fakeRun(5), interpolatedT: 0.7 })
    useReplay.getState().seek(2)
    expect(useReplay.getState().interpolatedT).toBe(0)
  })
})

describe('advance', () => {
  test('accumulates interpolatedT without crossing a step boundary', () => {
    useReplay.setState({ run: fakeRun(5), playing: true, currentStep: 0 })
    useReplay.getState().advance(0.4)
    expect(useReplay.getState().currentStep).toBe(0)
    expect(useReplay.getState().interpolatedT).toBeCloseTo(0.4)
  })

  test('crosses into the next step once progress reaches 1', () => {
    useReplay.setState({ run: fakeRun(5), playing: true, currentStep: 0, interpolatedT: 0.8 })
    useReplay.getState().advance(0.3)
    expect(useReplay.getState().currentStep).toBe(1)
    expect(useReplay.getState().interpolatedT).toBe(0)
  })

  test('stops playing once it reaches the last step', () => {
    useReplay.setState({ run: fakeRun(3), playing: true, currentStep: 1, interpolatedT: 0.9 })
    useReplay.getState().advance(0.5)
    expect(useReplay.getState().currentStep).toBe(2)
    expect(useReplay.getState().playing).toBe(false)
  })

  test('is a no-op once already at the last step', () => {
    useReplay.setState({ run: fakeRun(3), playing: true, currentStep: 2, interpolatedT: 0 })
    useReplay.getState().advance(0.5)
    expect(useReplay.getState().currentStep).toBe(2)
    expect(useReplay.getState().playing).toBe(false)
  })

  test('is a no-op when not playing', () => {
    useReplay.setState({ run: fakeRun(5), playing: false, currentStep: 0, interpolatedT: 0 })
    useReplay.getState().advance(0.9)
    expect(useReplay.getState().currentStep).toBe(0)
    expect(useReplay.getState().interpolatedT).toBe(0)
  })

  test('is a no-op with no run loaded', () => {
    useReplay.getState().advance(0.9)
    expect(useReplay.getState().currentStep).toBe(0)
  })
})

describe('play/pause', () => {
  test('play restarts from the top once playback has run off the end', () => {
    useReplay.setState({ run: fakeRun(4), currentStep: 3, interpolatedT: 0 })
    useReplay.getState().play()
    expect(useReplay.getState().currentStep).toBe(0)
    expect(useReplay.getState().playing).toBe(true)
  })

  test('play from the middle does not reset progress', () => {
    useReplay.setState({ run: fakeRun(4), currentStep: 1, interpolatedT: 0.5 })
    useReplay.getState().play()
    expect(useReplay.getState().currentStep).toBe(1)
    expect(useReplay.getState().interpolatedT).toBe(0.5)
  })

  test('play does nothing without a loaded run', () => {
    useReplay.getState().play()
    expect(useReplay.getState().playing).toBe(false)
  })

  test('pause stops playback', () => {
    useReplay.setState({ run: fakeRun(4), playing: true })
    useReplay.getState().pause()
    expect(useReplay.getState().playing).toBe(false)
  })
})

describe('setSpeed', () => {
  test('updates the multiplier', () => {
    useReplay.getState().setSpeed(4)
    expect(useReplay.getState().speed).toBe(4)
  })
})

describe('clear', () => {
  test('resets everything to idle', () => {
    useReplay.setState({ run: fakeRun(4), status: 'ready', currentStep: 2, playing: true, speed: 8 })
    useReplay.getState().clear()
    const state = useReplay.getState()
    expect(state.run).toBeNull()
    expect(state.status).toBe('idle')
    expect(state.currentStep).toBe(0)
    expect(state.interpolatedT).toBe(0)
    expect(state.playing).toBe(false)
    expect(state.speed).toBe(1)
  })
})
