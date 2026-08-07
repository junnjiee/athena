import { create } from 'zustand'
import { createBattleground, fetchBattlegroundGrid, fetchBattlegroundMeta } from '../lib/api'
import { subscribeBattleground } from '../lib/socket'
import type {
  BattlegroundMeta,
  BBoxDeg,
  CellSample,
  GridData,
  HeatmapMetric,
  OsmFeatures,
  ProgressEvent,
  ReasoningStep,
} from '../types/terrain'
import type { PlanAnalysis } from '../lib/validate'

export type BattlegroundPhase = 'idle' | 'generating' | 'ready'

const STEP_LABELS: [ReasoningStep['id'], string][] = [
  ['elevation', 'Downloading elevation model'],
  ['features', 'Detecting roads, buildings & vegetation'],
  ['landcover', 'Sampling satellite land cover'],
  ['weather', 'Sensing weather conditions'],
  ['segment', 'Segmenting satellite imagery'],
  ['classify', 'Classifying terrain cover'],
  ['military', 'Computing military properties'],
  ['grid', 'Building simulation grid'],
]

function freshSteps(): ReasoningStep[] {
  return STEP_LABELS.map(([id, label]) => ({ id, label, status: 'pending' }))
}

function applyProgress(steps: ReasoningStep[], event: ProgressEvent): ReasoningStep[] {
  return steps.map((step) => {
    if (step.id !== event.step) return step
    const status = event.status === 'start' ? 'active' : event.status === 'done' ? 'done' : 'error'
    return { ...step, status, detail: event.detail ?? step.detail }
  })
}

/** Some pipeline steps (classify/military, and any step replayed from a late-joining
 *  subscriber's snapshot burst) emit 'start' and 'done' with no real gap between them,
 *  so the 'active'/spinning state gets set and immediately overwritten in the same
 *  render -- the spinner never actually paints. Enforce a minimum visible duration:
 *  'start' applies immediately, but a 'done'/'error' arriving before MIN_ACTIVE_MS has
 *  elapsed since that step went active is deferred until the remainder has passed. */
const MIN_ACTIVE_MS = 400

export interface BattlefieldLayerToggles {
  buildings: boolean
  roads: boolean
  trees: boolean
  water: boolean
  /** simulation grid cell boundaries, draped over the terrain */
  gridLines: boolean
}

interface BattlegroundState {
  phase: BattlegroundPhase
  jobId: string | null
  steps: ReasoningStep[]
  error: string | null
  meta: BattlegroundMeta | null
  features: OsmFeatures | null
  grid: GridData | null
  /** bumped when a battlefield finishes loading — drives the cinematic reveal */
  revealToken: number
  heatmap: HeatmapMetric
  layers: BattlefieldLayerToggles
  night: boolean
  hoverCell: CellSample | null
  planAnalysis: PlanAnalysis | null

  generate: (bbox: BBoxDeg, name: string) => Promise<void>
  /** Restores a previously-saved battleground snapshot without re-running the
   *  DEM/OSM/weather pipeline -- used when loading a plan from the Plans page. */
  loadSaved: (meta: BattlegroundMeta, grid: GridData, features: OsmFeatures) => void
  dismissError: () => void
  clear: () => void
  setHeatmap: (metric: HeatmapMetric) => void
  toggleLayer: (layer: keyof BattlefieldLayerToggles) => void
  setNight: (night: boolean) => void
  setHoverCell: (cell: CellSample | null) => void
  setPlanAnalysis: (analysis: PlanAnalysis | null) => void
}

let generation = 0
let unsubscribe: (() => void) | null = null

export const useBattleground = create<BattlegroundState>((set, get) => ({
  phase: 'idle',
  jobId: null,
  steps: freshSteps(),
  error: null,
  meta: null,
  features: null,
  grid: null,
  revealToken: 0,
  heatmap: 'none',
  layers: { buildings: true, roads: true, trees: true, water: true, gridLines: false },
  night: false,
  hoverCell: null,
  planAnalysis: null,

  async generate(bbox, name) {
    const gen = ++generation
    unsubscribe?.()
    unsubscribe = null
    set({ phase: 'generating', steps: freshSteps(), error: null, jobId: null })

    const activeSince = new Map<ReasoningStep['id'], number>()
    function applyEventWithMinDwell(event: ProgressEvent) {
      if (event.status === 'start') {
        activeSince.set(event.step, Date.now())
        set((s) => ({ steps: applyProgress(s.steps, event) }))
        return
      }
      const startedAt = activeSince.get(event.step)
      const elapsed = startedAt != null ? Date.now() - startedAt : MIN_ACTIVE_MS
      const remaining = Math.max(0, MIN_ACTIVE_MS - elapsed)
      if (remaining === 0) {
        set((s) => ({ steps: applyProgress(s.steps, event) }))
      } else {
        setTimeout(() => {
          if (gen !== generation) return
          set((s) => ({ steps: applyProgress(s.steps, event) }))
        }, remaining)
      }
    }

    const fail = (message: string) => {
      if (gen !== generation) return
      set({ error: message })
    }

    const loadResults = async (jobId: string) => {
      try {
        const [{ meta, features }, grid] = await Promise.all([
          fetchBattlegroundMeta(jobId),
          fetchBattlegroundGrid(jobId, bbox),
        ])
        if (gen !== generation) return
        set((s) => ({
          phase: 'ready',
          meta,
          features,
          grid,
          revealToken: s.revealToken + 1,
          hoverCell: null,
        }))
      } catch (error: unknown) {
        fail(error instanceof Error ? error.message : 'failed to load battlefield data')
      }
    }

    try {
      const jobId = await createBattleground(bbox, name)
      if (gen !== generation) return
      set({ jobId })
      unsubscribe = subscribeBattleground(jobId, {
        onProgress(event) {
          if (gen !== generation) return
          applyEventWithMinDwell(event)
        },
        onDone(status, error) {
          if (gen !== generation) return
          unsubscribe?.()
          unsubscribe = null
          if (status === 'ready') void loadResults(jobId)
          else fail(error ?? 'terrain pipeline failed')
        },
        onError: fail,
      })
    } catch (error: unknown) {
      fail(error instanceof Error ? error.message : 'failed to reach terrain service')
    }
  },

  loadSaved(meta, grid, features) {
    // Bump generation/unsubscribe exactly like clear() does, so a stale
    // in-flight generate() from a session this is replacing can't resurrect
    // itself and stomp the restored state right after it's set.
    generation++
    unsubscribe?.()
    unsubscribe = null
    set((s) => ({
      phase: 'ready',
      jobId: meta.id,
      error: null,
      meta,
      grid,
      features,
      revealToken: s.revealToken + 1,
      hoverCell: null,
    }))
  },

  dismissError() {
    set({ error: null, phase: get().grid ? 'ready' : 'idle' })
  },

  clear() {
    // Bump generation so any in-flight callback tied to the abandoned session (a
    // pending loadResults() fetch, or a deferred min-dwell-time setTimeout from
    // applyEventWithMinDwell) becomes a no-op instead of resurrecting stale state
    // after the reset below.
    generation++
    unsubscribe?.()
    unsubscribe = null
    set({
      phase: 'idle',
      jobId: null,
      steps: freshSteps(),
      error: null,
      meta: null,
      features: null,
      grid: null,
      heatmap: 'none',
      hoverCell: null,
      planAnalysis: null,
    })
  },

  setHeatmap: (metric) => set({ heatmap: metric }),

  toggleLayer: (layer) =>
    set((s) => ({ layers: { ...s.layers, [layer]: !s.layers[layer] } })),
  setNight: (night) => set({ night }),
  setHoverCell: (cell) => set({ hoverCell: cell }),
  setPlanAnalysis: (analysis) => set({ planAnalysis: analysis }),
}))

/** How long the terrain pipeline may take before a caller gives up waiting.
 *  Generous: DEM + Overpass + WorldCover are all third-party and occasionally
 *  slow, and the UI already streams progress the whole time. */
const GENERATE_TIMEOUT_MS = 180_000

/**
 * Resolves once the pipeline finishes, rejects if it fails or stalls.
 *
 * `generate()` returns as soon as the job is *accepted* — readiness arrives
 * later over Socket.IO. Callers that need to act on the finished battlefield
 * (the voice assistant, which has to speak once terrain exists) await this.
 */
export function waitForBattlefield(timeoutMs = GENERATE_TIMEOUT_MS): Promise<void> {
  return new Promise((resolve, reject) => {
    const settle = (finish: () => void) => {
      clearTimeout(timer)
      unsubscribe()
      finish()
    }

    const check = (state: BattlegroundState): boolean => {
      if (state.error) {
        settle(() => reject(new Error(state.error ?? 'terrain generation failed')))
        return true
      }
      if (state.phase === 'ready' && state.grid) {
        settle(resolve)
        return true
      }
      return false
    }

    const timer = setTimeout(() => {
      settle(() => reject(new Error('terrain generation timed out')))
    }, timeoutMs)

    const unsubscribe = useBattleground.subscribe(check)

    // The pipeline may already have finished before we subscribed.
    check(useBattleground.getState())
  })
}
