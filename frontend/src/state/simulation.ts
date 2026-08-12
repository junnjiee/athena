import { create } from 'zustand'
import { startSimulation } from '../lib/api'
import { subscribeSimulation } from '../lib/simulationStream'
import { summarizeBatch, type BatchOutcome, type RunResult } from '../types/replay'

/**
 * A Monte Carlo batch in flight, and what it has told us so far.
 *
 * Results stream in over minutes, so the store keeps a running aggregate rather
 * than waiting for the batch to finish — the win rate is visible converging,
 * which is the whole point of running a hundred of them.
 *
 * Runs arrive already scored by the terrain service, so no replay is downloaded
 * here at all -- each one repeats the whole battlefield surface. `replayPaths`
 * keeps only the proxied on-demand fetch path per run (see
 * `SimulationModal`'s "View Replay"), index-aligned with `results`, not the
 * replay itself.
 */

export type SimulationPhase = 'idle' | 'submitting' | 'running' | 'done' | 'error'

export interface SimulationSettings {
  simulationCount: number
  ticks: number
}

export const DEFAULT_SIMULATION_SETTINGS: SimulationSettings = {
  simulationCount: 100,
  ticks: 60,
}

interface SimulationState {
  phase: SimulationPhase
  batchId: string | null
  /** runs requested; results arrive out of order */
  requested: number
  /** soldiers the engine fields, after establishment expansion */
  soldiers: number
  results: RunResult[]
  /** Index-aligned with `results` -- proxied path to fetch run i's full replay. */
  replayPaths: string[]
  failures: string[]
  error: string | null

  run: (planId: string, settings: SimulationSettings) => Promise<void>
  cancel: () => void
  reset: () => void
}

let unsubscribe: (() => void) | null = null
/** Bumped on every run/cancel/reset so a stream from an abandoned batch cannot
 *  write results into the one that replaced it. */
let generation = 0

const IDLE = {
  phase: 'idle' as SimulationPhase,
  batchId: null,
  requested: 0,
  soldiers: 0,
  results: [] as RunResult[],
  replayPaths: [] as string[],
  failures: [] as string[],
  error: null,
}

export const useSimulation = create<SimulationState>((set, get) => ({
  ...IDLE,

  async run(planId, settings) {
    const gen = ++generation
    unsubscribe?.()
    unsubscribe = null
    set({ ...IDLE, phase: 'submitting' })

    try {
      const batch = await startSimulation(planId, settings)
      if (gen !== generation) return

      set({
        phase: 'running',
        batchId: batch.batchId,
        requested: batch.simulationCount,
        soldiers: batch.soldiers,
      })

      unsubscribe = subscribeSimulation(batch.eventsUrl, {
        onResult(result, event) {
          if (gen !== generation) return
          set((s) => ({
            results: [...s.results, result],
            replayPaths: [...s.replayPaths, event.replayPath],
          }))
        },
        onFailed(event) {
          if (gen !== generation) return
          set((s) => ({
            failures: [...s.failures, `run ${event.simulationIndex + 1}: ${event.error}`],
          }))
        },
        onDone() {
          if (gen !== generation) return
          unsubscribe = null
          set({ phase: 'done' })
        },
        onError(message) {
          if (gen !== generation) return
          // A batch that produced results before dropping is still worth
          // showing, so a late failure downgrades to done rather than error.
          set((s) =>
            s.results.length > 0
              ? { phase: 'done', error: message }
              : { phase: 'error', error: message },
          )
        },
      })
    } catch (error: unknown) {
      if (gen !== generation) return
      set({
        phase: 'error',
        error: error instanceof Error ? error.message : 'could not start the simulation',
      })
    }
  },

  cancel() {
    // Only stops listening. The engine has already queued the batch and keeps
    // running it; there is no cancel on that side.
    generation++
    unsubscribe?.()
    unsubscribe = null
    set({ phase: get().results.length > 0 ? 'done' : 'idle' })
  },

  reset() {
    generation++
    unsubscribe?.()
    unsubscribe = null
    set({ ...IDLE })
  },
}))

/** The aggregate the bottom bar and the modal both read. Null until a run has
 *  actually produced something, so callers can show a dash rather than 0 %. */
export function batchOutcome(results: readonly RunResult[]): BatchOutcome | null {
  return results.length === 0 ? null : summarizeBatch(results)
}
