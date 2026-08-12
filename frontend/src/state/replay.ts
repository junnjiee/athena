import { create } from 'zustand'
import { fetchReplay } from '../lib/api'
import { useBattleground } from './battleground'
import type { ReplayLog, SavedSimulationRun } from '../types/replayLog'

export type PlaybackSpeed = 1 | 2 | 4 | 8

/**
 * Playback state for a loaded simulation replay -- orthogonal to
 * useBattleground's terrain-generation lifecycle (this store is only mounted
 * while replay-viewer mode is active), so it stays a standalone store rather
 * than an extension of it. Terrain itself is restored through
 * useBattleground's own `loadSaved`, the same path PlansPage's load already
 * uses, so a replay's soldiers animate over real classified terrain.
 */
interface ReplayState {
  run: SavedSimulationRun | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null

  currentStep: number
  /** 0..1 progress toward currentStep+1, advanced by the playback RAF loop. */
  interpolatedT: number
  playing: boolean
  speed: PlaybackSpeed

  load: (id: string) => Promise<void>
  /** Loads a live simulation run's replay for viewing -- unlike `load`, reuses
   *  the battleground already on screen instead of fetching/restoring terrain
   *  from `/api/replays`, and never persists the replay there either. */
  loadEphemeral: (replay: ReplayLog, label: string) => void
  play: () => void
  pause: () => void
  seek: (step: number) => void
  advance: (deltaT: number) => void
  setSpeed: (speed: PlaybackSpeed) => void
  clear: () => void
}

let loadGeneration = 0

/** One simulation step advances per real second at speed=1x -- module-level
 *  RAF loop (not React state) driving `advance()`, mirroring the module-level
 *  `generation`/`unsubscribe` control-flow variables in state/battleground.ts.
 *  Kept here rather than in a component so play()/pause() alone are enough to
 *  start/stop it -- no mounted component is required to keep it running. */
const BASE_STEPS_PER_SECOND = 1
let rafId: number | null = null
let lastFrameTime: number | null = null

function tick(ts: number) {
  if (lastFrameTime !== null) {
    const dtSeconds = (ts - lastFrameTime) / 1000
    useReplay.getState().advance(dtSeconds * BASE_STEPS_PER_SECOND * useReplay.getState().speed)
  }
  lastFrameTime = ts
  if (useReplay.getState().playing) {
    rafId = requestAnimationFrame(tick)
  } else {
    rafId = null
    lastFrameTime = null
  }
}

function startLoop() {
  if (rafId !== null) return
  lastFrameTime = null
  rafId = requestAnimationFrame(tick)
}

function stopLoop() {
  if (rafId !== null) cancelAnimationFrame(rafId)
  rafId = null
  lastFrameTime = null
}

export const useReplay = create<ReplayState>((set, get) => ({
  run: null,
  status: 'idle',
  error: null,
  currentStep: 0,
  interpolatedT: 0,
  playing: false,
  speed: 1,

  async load(id) {
    const generation = ++loadGeneration
    set({ status: 'loading', error: null, run: null, currentStep: 0, interpolatedT: 0, playing: false })
    try {
      const run = await fetchReplay(id)
      if (generation !== loadGeneration) return
      useBattleground.getState().loadSaved(run.meta, run.grid, run.features)
      set({ run, status: 'ready' })
    } catch (error: unknown) {
      if (generation !== loadGeneration) return
      set({ status: 'error', error: error instanceof Error ? error.message : 'failed to load replay' })
    }
  },

  loadEphemeral(replay, label) {
    // Invalidates any in-flight async `load(id)` so it can't overwrite this
    // once its fetch resolves.
    loadGeneration++
    const { meta, grid, features } = useBattleground.getState()
    // A live run always simulates the currently-loaded plan's stored terrain,
    // so the battleground behind it is already on screen -- this only runs
    // from a context (SimulationModal) where that's guaranteed to be true.
    if (!meta || !grid || !features) {
      set({ status: 'error', error: 'no battleground is loaded to play this replay over' })
      return
    }
    set({
      run: { run: { id: '', name: label, createdAt: new Date().toISOString() }, replay, meta, features, grid },
      status: 'ready',
      error: null,
      currentStep: 0,
      interpolatedT: 0,
      playing: false,
    })
  },

  play() {
    const { run, currentStep } = get()
    if (!run) return
    // Restarts from the top once playback has run off the end of the log.
    if (currentStep >= run.replay.steps.length - 1) set({ currentStep: 0, interpolatedT: 0 })
    set({ playing: true })
    startLoop()
  },

  pause: () => {
    set({ playing: false })
    stopLoop()
  },

  seek: (step) => {
    const total = get().run?.replay.steps.length ?? 1
    set({ currentStep: Math.max(0, Math.min(total - 1, step)), interpolatedT: 0 })
  },

  /** Called once per animation frame while playing; steps `currentStep`
   *  forward whenever accumulated progress crosses a full tick. */
  advance(deltaT) {
    const { run, currentStep, interpolatedT, playing } = get()
    if (!run || !playing) return
    const lastStep = run.replay.steps.length - 1
    if (currentStep >= lastStep) {
      set({ playing: false, interpolatedT: 0 })
      stopLoop()
      return
    }
    const t = interpolatedT + deltaT
    if (t >= 1) {
      const nextStep = Math.min(lastStep, currentStep + 1)
      const stillPlaying = nextStep < lastStep
      set({ currentStep: nextStep, interpolatedT: 0, playing: stillPlaying })
      if (!stillPlaying) stopLoop()
    } else {
      set({ interpolatedT: t })
    }
  },

  setSpeed: (speed) => set({ speed }),

  clear() {
    loadGeneration++
    stopLoop()
    set({ run: null, status: 'idle', error: null, currentStep: 0, interpolatedT: 0, playing: false, speed: 1 })
  },
}))
