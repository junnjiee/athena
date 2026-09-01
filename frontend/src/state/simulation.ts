import { create } from 'zustand'
import { startSimulation, type ImportDiagnostics } from '../lib/api'
import { subscribeSimulation, type SimulationProgress } from '../lib/simulationStream'
import { summarizeBatch, type BatchOutcome, type RunResult } from '../types/replay'

/**
 * A Monte Carlo batch in flight, and what it has told us so far.
 *
 * Results stream in over minutes, so the store keeps a running aggregate rather
 * than waiting for the batch to finish — the win rate is visible converging,
 * which is the whole point of running a hundred of them.
 *
 * Runs arrive already scored by the terrain service, so no replay is downloaded
 * here at all; nothing renders a replay yet, and each one repeats the whole
 * battlefield surface.
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
  /** ground problems the engine found while validating the payload */
  diagnostics: ImportDiagnostics | null
  /** Proxied path to a finished run, so the operator can go straight from
   *  "done" to watching it without navigating anywhere. */
  replayPath: string | null
  results: RunResult[]
  failures: string[]
  /** Where each run in flight has got to, keyed by its index. This is what
   *  makes a multi-minute wait legible rather than a bar that sits at zero. */
  progress: Record<number, SimulationProgress>
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
  diagnostics: null as ImportDiagnostics | null,
  replayPath: null as string | null,
  results: [] as RunResult[],
  failures: [] as string[],
  progress: {} as Record<number, SimulationProgress>,
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
        diagnostics: batch.diagnostics,
      })

      unsubscribe = subscribeSimulation(batch.eventsUrl, {
        onResult(result, event) {
          if (gen !== generation) return
          set((s) => {
            // A finished run stops being "in flight"; leaving its last progress
            // behind would keep it in the live panel for the whole batch.
            const progress = { ...s.progress }
            delete progress[event.simulationIndex]
            return {
              results: [...s.results, result],
              progress,
              replayPath: s.replayPath ?? event.replayPath,
            }
          })
        },
        onProgress(event) {
          if (gen !== generation) return
          set((s) => ({
            progress: { ...s.progress, [event.simulationIndex]: event },
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
