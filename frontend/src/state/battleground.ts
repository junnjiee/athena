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
  ['weather', 'Sensing weather conditions'],
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
  hoverCell: CellSample | null
  planAnalysis: PlanAnalysis | null

  generate: (bbox: BBoxDeg, name: string) => Promise<void>
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
  layers: { buildings: true, roads: true, trees: true, water: true },
  night: false,
  hoverCell: null,
  planAnalysis: null,

  async generate(bbox, name) {
    const gen = ++generation
    unsubscribe?.()
    unsubscribe = null
    set({ phase: 'generating', steps: freshSteps(), error: null, jobId: null })

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
          set((s) => ({ steps: applyProgress(s.steps, event) }))
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
