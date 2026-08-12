import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { subscribeSimulation } from '../src/lib/simulationStream'
import type { RunResult } from '../src/types/replay'

/**
 * Runs arrive already scored, so this module only dispatches. An earlier
 * version fetched each replay here and treated `batch.completed` as a reason to
 * stop accepting replies, which silently dropped every run still downloading —
 * the aggregate just came back short, with no error anywhere. Scoring moved to
 * the terrain service, which removes the race by construction; these tests pin
 * the dispatch contract that replaced it.
 */

interface Listener {
  (event: { data: string }): void
}

class FakeEventSource {
  static instances: FakeEventSource[] = []
  static readonly CLOSED = 2

  listeners = new Map<string, Listener[]>()
  closed = false
  readyState = 1
  onerror: (() => void) | null = null

  constructor(public url: string) {
    FakeEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }

  close(): void {
    this.closed = true
    this.readyState = FakeEventSource.CLOSED
  }

  emit(type: string, data: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data: JSON.stringify(data) })
    }
  }
}

const originalEventSource = globalThis.EventSource

beforeEach(() => {
  FakeEventSource.instances = []
  globalThis.EventSource = FakeEventSource as unknown as typeof EventSource
})

afterEach(() => {
  globalThis.EventSource = originalEventSource
})

const summary = (outcome: RunResult['outcome']): RunResult => ({
  outcome,
  ticks: 4,
  blueAlive: 2,
  redAlive: 0,
  blueLosses: 1,
  redLosses: 3,
  shotsFired: 6,
  hits: 3,
})

function collect() {
  const results: number[] = []
  const failures: string[] = []
  const errors: string[] = []
  let done: { completed: number } | null = null

  const unsubscribe = subscribeSimulation('/events', {
    onResult: (_r, event) => results.push(event.simulationIndex),
    onFailed: (event) => failures.push(event.error),
    onDone: (event) => {
      done = event as unknown as { completed: number }
    },
    onError: (message) => errors.push(message),
  })

  return { results, failures, errors, done: () => done, unsubscribe }
}

const completed = (simulationIndex: number, outcome: RunResult['outcome'] = 'blue') => ({
  simulationId: `sim-${simulationIndex}`,
  simulationIndex,
  summary: summary(outcome),
  replayPath: `/api/simulations/replay?url=x-${simulationIndex}`,
})

describe('subscribeSimulation', () => {
  test('scores every completed run, including one arriving with the terminal event', () => {
    const sink = collect()
    const source = FakeEventSource.instances[0]

    source.emit('simulation.completed', completed(0))
    source.emit('simulation.completed', completed(1))
    source.emit('batch.completed', { status: 'completed', completed: 2, failed: 0 })

    expect(sink.results).toEqual([0, 1])
    expect(sink.done()).not.toBeNull()
    expect(sink.errors).toEqual([])
    expect(source.closed).toBe(true)
  })

  test('a run that finished but could not be scored is an error, not a silent gap', () => {
    const sink = collect()

    FakeEventSource.instances[0].emit('simulation.completed', {
      simulationId: 'sim-0',
      simulationIndex: 0,
      summary: null,
      summaryError: 'HTTP 404',
      replayPath: '/api/simulations/replay?url=x',
    })

    expect(sink.results).toEqual([])
    expect(sink.errors[0]).toContain('run 1')
    expect(sink.errors[0]).toContain('HTTP 404')
  })

  test('a failed run is reported as a failure', () => {
    const sink = collect()

    FakeEventSource.instances[0].emit('simulation.failed', {
      simulationId: 'sim-0',
      simulationIndex: 0,
      error: 'provider timeout',
    })

    expect(sink.failures).toEqual(['provider timeout'])
  })

  test('unsubscribing stops delivery', () => {
    const sink = collect()
    const source = FakeEventSource.instances[0]

    sink.unsubscribe()
    source.emit('simulation.completed', completed(0))
    source.emit('batch.completed', { status: 'completed', completed: 1, failed: 0 })

    expect(source.closed).toBe(true)
    expect(sink.results).toEqual([])
    expect(sink.done()).toBeNull()
  })

  test('an unparseable event is ignored rather than throwing', () => {
    const sink = collect()
    const source = FakeEventSource.instances[0]
    for (const listener of source.listeners.get('simulation.completed') ?? []) {
      listener({ data: 'not json' })
    }

    expect(sink.results).toEqual([])
    expect(sink.errors).toEqual([])
  })
})
