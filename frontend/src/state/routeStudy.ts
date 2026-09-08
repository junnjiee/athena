import { create } from 'zustand'
import { createRouteStudy, fetchRouteStudy, updateRouteStudy } from '../lib/api'
import { chokeToggle } from '../lib/corridors'
import type { Corridor, Mark, MarkKind, RouteStudy, StudyMarks } from '../types/routeStudy'

/**
 * The route study on screen: its marks, its corridors, and the operator's
 * edits to them.
 *
 * Marks are held locally while being placed and only reach the server when the
 * study is run, so dropping a pin costs nothing. Renaming a corridor saves
 * immediately, because the server knows a rename does not re-run the search.
 */

type Phase = 'idle' | 'running' | 'ready' | 'error'

interface RouteStudyState {
  phase: Phase
  error: string | null
  study: RouteStudy | null
  /** Marks being assembled before the first run. */
  draftMarks: StudyMarks
  selectedCorridorId: string | null

  addMark: (kind: MarkKind, lon: number, lat: number, name?: string) => void
  removeMark: (kind: MarkKind, id: string) => void
  renameMark: (kind: MarkKind, id: string, name: string) => void
  clearDraft: () => void

  selectCorridor: (id: string | null) => void
  run: (areaId: string, name: string) => Promise<void>
  load: (id: string) => Promise<void>
  renameCorridor: (corridorId: string, name: string) => Promise<void>
  categoriseCorridor: (corridorId: string, category: string) => Promise<void>
  toggleChoke: (corridor: Corridor) => Promise<void>
  dismissError: () => void
  reset: () => void
}

const emptyMarks = (): StudyMarks => ({ reserves: [], objectives: [] })

const listFor = (marks: StudyMarks, kind: MarkKind): Mark[] =>
  kind === 'reserve' ? marks.reserves : marks.objectives

function withList(marks: StudyMarks, kind: MarkKind, next: Mark[]): StudyMarks {
  return kind === 'reserve' ? { ...marks, reserves: next } : { ...marks, objectives: next }
}

const message = (error: unknown) =>
  error instanceof Error ? error.message : 'route study failed'

export const useRouteStudy = create<RouteStudyState>()((set, get) => ({
  phase: 'idle',
  error: null,
  study: null,
  draftMarks: emptyMarks(),
  selectedCorridorId: null,

  addMark: (kind, lon, lat, name) => {
    const marks = get().draftMarks
    const existing = listFor(marks, kind)
    const fallback = kind === 'reserve' ? `Reserve ${existing.length + 1}` : `Objective ${existing.length + 1}`
    const mark: Mark = { id: crypto.randomUUID(), name: name ?? fallback, lon, lat }
    set({ draftMarks: withList(marks, kind, [...existing, mark]) })
  },

  removeMark: (kind, id) => {
    const marks = get().draftMarks
    set({
      draftMarks: withList(
        marks,
        kind,
        listFor(marks, kind).filter((mark) => mark.id !== id),
      ),
    })
  },

  renameMark: (kind, id, name) => {
    const marks = get().draftMarks
    set({
      draftMarks: withList(
        marks,
        kind,
        listFor(marks, kind).map((mark) => (mark.id === id ? { ...mark, name } : mark)),
      ),
    })
  },

  clearDraft: () => set({ draftMarks: emptyMarks() }),

  selectCorridor: (id) => set({ selectedCorridorId: id }),

  run: async (areaId, name) => {
    const marks = get().draftMarks
    const existing = get().study
    set({ phase: 'running', error: null })
    try {
      const study = existing?.areaId === areaId
        ? await updateRouteStudy(existing.id, { name, marks })
        : await createRouteStudy({ areaId, name, marks })
      set({ phase: 'ready', study, draftMarks: study.marks })
    } catch (error: unknown) {
      set({ phase: 'error', error: message(error) })
    }
  },

  load: async (id) => {
    set({ phase: 'running', error: null })
    try {
      const study = await fetchRouteStudy(id)
      set({ phase: 'ready', study, draftMarks: study.marks })
    } catch (error: unknown) {
      set({ phase: 'error', error: message(error) })
    }
  },

  renameCorridor: async (corridorId, name) => {
    const study = get().study
    if (!study) return
    const corridorEdits = {
      ...study.corridorEdits,
      [corridorId]: { ...study.corridorEdits[corridorId], name },
    }
    // Optimistic: a rename never re-runs the search, so the corridors already
    // on screen are the corridors that come back.
    set({ study: { ...study, corridorEdits } })
    try {
      set({ study: await updateRouteStudy(study.id, { corridorEdits }) })
    } catch (error: unknown) {
      set({ study, error: message(error) })
    }
  },

  categoriseCorridor: async (corridorId, category) => {
    const study = get().study
    if (!study) return
    const corridorEdits = {
      ...study.corridorEdits,
      [corridorId]: { ...study.corridorEdits[corridorId], category },
    }
    set({ study: { ...study, corridorEdits } })
    try {
      set({ study: await updateRouteStudy(study.id, { corridorEdits }) })
    } catch (error: unknown) {
      set({ study, error: message(error) })
    }
  },

  toggleChoke: async (corridor) => {
    const study = get().study
    if (!study) return
    const { canBlock, next } = chokeToggle(corridor, study.edgeOverrides)
    if (!canBlock) return
    // Not optimistic: this re-runs the search server-side, so the corridors
    // that come back are genuinely different ground.
    set({ phase: 'running', error: null })
    try {
      const updated = await updateRouteStudy(study.id, { edgeOverrides: next })
      set({ phase: 'ready', study: updated, selectedCorridorId: null })
    } catch (error: unknown) {
      set({ phase: 'ready', error: message(error) })
    }
  },

  dismissError: () => set({ error: null }),

  reset: () =>
    set({
      phase: 'idle',
      error: null,
      study: null,
      draftMarks: emptyMarks(),
      selectedCorridorId: null,
    }),
}))
