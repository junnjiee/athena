import { create } from 'zustand'
import {
  createBattleground,
  fetchBattlegroundGrid,
  fetchBattlegroundMeta,
  fetchDangerField,
  type DangerObserver,
} from '../lib/api'
import type { ViewshedRequest, ViewshedResponse } from '../workers/los.worker'
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
import type { LonLat } from '../types/entities'

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
  monochrome: boolean
  hoverCell: CellSample | null
  planAnalysis: PlanAnalysis | null
  /** friendly-unit viewshed currently draped on the battlefield */
  viewshed: { unitId: string; mask: Uint8Array } | null
  /** ghost route preview from the A* suggester (cleared on accept/dismiss) */
  suggestedPath: LonLat[] | null

  generate: (bbox: BBoxDeg, name: string) => Promise<void>
  dismissError: () => void
  clear: () => void
  setHeatmap: (metric: HeatmapMetric) => void
  toggleLayer: (layer: keyof BattlefieldLayerToggles) => void
  setNight: (night: boolean) => void
  toggleMonochrome: () => void
  setHoverCell: (cell: CellSample | null) => void
  setPlanAnalysis: (analysis: PlanAnalysis | null) => void
  /** recompute the enemy LOS danger field for the current red-force positions */
  refreshDanger: (observers: DangerObserver[]) => Promise<void>
  requestViewshed: (unitId: string, position: { longitude: number; latitude: number }) => void
  clearViewshed: () => void
  setSuggestedPath: (points: LonLat[] | null) => void
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
  layers: { buildings: true, roads: true, trees: true, water: true },
  night: false,
  monochrome: false,
  hoverCell: null,
  planAnalysis: null,
  viewshed: null,
  suggestedPath: null,

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
      viewshed: null,
      suggestedPath: null,
    })
  },

  setHeatmap: (metric) => set({ heatmap: metric }),
  toggleLayer: (layer) =>
    set((s) => ({ layers: { ...s.layers, [layer]: !s.layers[layer] } })),
  setNight: (night) => set({ night }),
  toggleMonochrome: () => set((s) => ({ monochrome: !s.monochrome })),
  setHoverCell: (cell) => set({ hoverCell: cell }),
  setPlanAnalysis: (analysis) => set({ planAnalysis: analysis }),

  async refreshDanger(observers) {
    const { grid, jobId } = get()
    if (!grid || !jobId) return
    if (observers.length === 0) {
      if (grid.danger) set({ grid: { ...grid, danger: undefined } })
      return
    }
    const requestGen = generation
    try {
      const danger = await fetchDangerField(jobId, observers)
      if (requestGen !== generation) return
      const current = get().grid
      if (!current) return
      set({ grid: { ...current, danger } })
    } catch (error: unknown) {
      console.warn('[danger] refresh failed:', error instanceof Error ? error.message : error)
    }
  },

  requestViewshed(unitId, position) {
    const grid = get().grid
    if (!grid) return
    const col = Math.floor(((position.longitude - grid.bbox.west) / (grid.bbox.east - grid.bbox.west)) * grid.width)
    const row = Math.floor(((grid.bbox.north - position.latitude) / (grid.bbox.north - grid.bbox.south)) * grid.height)
    if (col < 0 || col >= grid.width || row < 0 || row >= grid.height) return

    const requestId = ++viewshedRequestId
    // Copies, not the live grid views — the worker transfer would detach the
    // whole grid buffer otherwise.
    const elevation = grid.elevation.slice()
    const cls = grid.cls.slice()
    const request: ViewshedRequest = {
      requestId,
      width: grid.width,
      height: grid.height,
      cellMeters: grid.cellMeters,
      elevation: elevation.buffer as ArrayBuffer,
      cls: cls.buffer as ArrayBuffer,
      col,
      row,
    }
    getLosWorker(unitId).postMessage(request, [request.elevation, request.cls])
  },

  clearViewshed: () => set({ viewshed: null }),
  setSuggestedPath: (points) => set({ suggestedPath: points }),
}))

let viewshedRequestId = 0
let losWorker: Worker | null = null
let pendingViewshedUnitId: string | null = null

function getLosWorker(unitId: string): Worker {
  pendingViewshedUnitId = unitId
  if (!losWorker) {
    losWorker = new Worker(new URL('../workers/los.worker.ts', import.meta.url), { type: 'module' })
    losWorker.onmessage = (event: MessageEvent<ViewshedResponse>) => {
      // only the latest request wins — stale responses are dropped
      if (event.data.requestId !== viewshedRequestId || !pendingViewshedUnitId) return
      useBattleground.setState({
        viewshed: { unitId: pendingViewshedUnitId, mask: new Uint8Array(event.data.mask) },
      })
    }
  }
  return losWorker
}
