import { create } from 'zustand'
import type { ReplayLog } from '../types/replay'
import type { DensityLayer, PathDensity } from '../lib/replayGeo'

/**
 * A replay being watched over the battleground it was fought on.
 *
 * The standalone viewer draws a run on its own small canvas, which answers
 * "what happened" but not "what happened *here*" — the ground a commander drew
 * the plan on is the thing they are trying to reason about, and a separate
 * picture of it is a different picture. This drives playback on the real map
 * instead, alongside the drawn plan.
 *
 * Held outside the battleground store because it is a view over a finished run
 * rather than part of the plan being edited: loading a replay must never look
 * like an unsaved change to the drawing.
 */

interface PlaybackState {
  replay: ReplayLog | null
  /** Which run this is, for the caption. */
  label: string
  step: number
  /** When the current step began, so the renderer can walk soldiers between
   *  ticks instead of teleporting them. A tick is a decision, not a
   *  photograph: without interpolation a soldier covering eight cells jumps
   *  eight metres and you cannot read the ground it crossed. */
  stepStartedAt: number
  playing: boolean
  /** Milliseconds a tick occupies on screen. */
  tickMs: number
  /** Aggregate over every run in the batch: where this plan takes people and
   *  where it gets them killed. A single run is an anecdote; this is the thing
   *  worth correcting a plan against. */
  density: PathDensity | null
  densityLayer: DensityLayer | 'none'
  showReasoning: boolean

  open: (replay: ReplayLog, label: string, density?: PathDensity | null) => void
  close: () => void
  setStep: (step: number) => void
  setPlaying: (playing: boolean) => void
  setTickMs: (tickMs: number) => void
  setDensityLayer: (layer: DensityLayer | 'none') => void
  setShowReasoning: (show: boolean) => void
  advance: () => void
}

export const usePlayback = create<PlaybackState>((set, get) => ({
  replay: null,
  label: '',
  step: 0,
  stepStartedAt: 0,
  playing: true,
  tickMs: 700,
  density: null,
  densityLayer: 'blue',
  showReasoning: true,

  open: (replay, label, density = null) =>
    set({
      replay,
      label,
      step: 0,
      stepStartedAt: performance.now(),
      playing: true,
      density,
    }),
  close: () =>
    set({ replay: null, label: '', step: 0, playing: false, density: null }),
  setStep: (step) => set({ step, stepStartedAt: performance.now(), playing: false }),
  setPlaying: (playing) => set({ playing, stepStartedAt: performance.now() }),
  setTickMs: (tickMs) => set({ tickMs }),
  setDensityLayer: (densityLayer) => set({ densityLayer }),
  setShowReasoning: (showReasoning) => set({ showReasoning }),

  advance: () => {
    const { replay, step } = get()
    if (!replay) return
    const last = replay.steps.length - 1
    set({ step: step >= last ? 0 : step + 1, stepStartedAt: performance.now() })
  },
}))

/** The step currently being shown, or null when nothing is loaded. */
export function currentStep(state: PlaybackState) {
  if (!state.replay) return null
  return state.replay.steps[Math.min(state.step, state.replay.steps.length - 1)] ?? null
}
