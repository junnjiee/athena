import { create } from 'zustand'
import {
  createRouteStudy,
  fetchPreferences,
  fetchRouteStudy,
  resetPreferences,
  runBlockForces,
  runEnemyCourses,
  sendCourseFeedback,
  updateRouteStudy,
} from '../lib/api'
import { chokeToggle } from '../lib/corridors'
import { blockPointInputs, delayAssessmentInputs } from '../lib/blockForces'
import { emptyIntent } from '../lib/courses'
import { DEFAULT_STRENGTH, ECHELON_DEPTH, nextUnitName, orbatIssues } from '../lib/orbatTree'
import type {
  Availability,
  BlockPointInput,
  DelayAssessmentInput,
  Corridor,
  Echelon,
  EnemyIntent,
  Mark,
  MarkKind,
  OrbatUnit,
  Preferences,
  RouteStudy,
  StudyMarks,
  Verdict,
} from '../types/routeStudy'

/**
 * The route study on screen: its marks, its corridors, and the operator's
 * edits to them.
 *
 * Marks are held locally while being placed and only reach the server when the
 * study is run, so dropping a pin costs nothing. Renaming a corridor saves
 * immediately, because the server knows a rename does not re-run the search.
 *
 * The enemy assessment and the block plan hang off the same study but run as
 * separate passes: the intent and the force list are drafts held here, and each
 * pass only reaches the server when the operator asks for it.
 */

type Phase = 'idle' | 'running' | 'ready' | 'error'

/** The two later passes run independently of the route search and of each
 *  other, so each carries its own phase. A commander waiting on the model must
 *  still be able to read the corridors underneath it. */
type PassPhase = 'idle' | 'running'

interface RouteStudyState {
  phase: Phase
  error: string | null
  study: RouteStudy | null
  /** Marks being assembled before the first run. */
  draftMarks: StudyMarks
  /** The mark just dropped, so the panel can point at what appeared on the
   *  globe. Cleared by the panel once it has drawn attention to it. */
  lastMarkId: string | null
  selectedCorridorId: string | null

  addMark: (kind: MarkKind, lon: number, lat: number, options?: Partial<Omit<Mark, 'id' | 'lon' | 'lat'>>) => string
  clearLastMark: () => void
  removeMark: (kind: MarkKind, id: string) => void
  renameMark: (kind: MarkKind, id: string, name: string) => void
  updateMark: (kind: MarkKind, id: string, patch: Partial<Mark>) => void
  clearDraft: () => void

  selectCorridor: (id: string | null) => void
  run: (areaId: string, name: string) => Promise<void>
  load: (id: string) => Promise<void>
  renameCorridor: (corridorId: string, name: string) => Promise<void>
  categoriseCorridor: (corridorId: string, category: string) => Promise<void>
  toggleChoke: (corridor: Corridor) => Promise<void>
  dismissError: () => void
  reset: () => void

  // --- Enemy courses of action (S2) ---
  intent: EnemyIntent
  coursesPhase: PassPhase
  selectedCourseName: string | null
  setIntent: (patch: Partial<EnemyIntent>) => void
  toggleIntentObjective: (objectiveId: string) => void
  selectCourse: (name: string | null) => void
  assessCourses: () => Promise<void>
  judgeCourse: (courseName: string, verdict: Verdict) => Promise<void>

  // --- Order of battle (S3 input) ---
  orbatUnits: OrbatUnit[]
  selectedUnitId: string | null
  addUnit: (echelon: Echelon, lon: number, lat: number) => void
  updateUnit: (unitId: string, patch: Partial<OrbatUnit>) => void
  removeUnit: (unitId: string) => void
  setUnitAvailability: (unitId: string, availability: Availability) => void
  selectUnit: (unitId: string | null) => void

  // --- Block forces (S3) ---
  blockPhase: PassPhase
  planBlocks: (
    blockPoints?: BlockPointInput[],
    delayAssessments?: DelayAssessmentInput[],
  ) => Promise<void>

  // --- Learned ranking ---
  preferences: Preferences | null
  loadPreferences: () => Promise<void>
  forgetPreferences: () => Promise<void>
}

const emptyMarks = (): StudyMarks => ({ reserves: [], objectives: [] })

const listFor = (marks: StudyMarks, kind: MarkKind): Mark[] =>
  kind === 'reserve' ? marks.reserves : marks.objectives

function withList(marks: StudyMarks, kind: MarkKind, next: Mark[]): StudyMarks {
  return kind === 'reserve' ? { ...marks, reserves: next } : { ...marks, objectives: next }
}

const message = (error: unknown) =>
  error instanceof Error ? error.message : 'route study failed'

/** The editable half of a loaded study. Intent and the force list are drafts
 *  the operator keeps working on, so they are adopted into local state rather
 *  than read back out of the stored study on every render. */
function adopt(study: RouteStudy) {
  return {
    intent: study.intent ?? emptyIntent(),
    orbatUnits: study.orbat?.units ?? [],
    selectedCourseName: study.courses?.most_likely?.name ?? study.courses?.courses[0]?.name ?? null,
    selectedUnitId: null,
    coursesPhase: 'idle' as const,
    blockPhase: 'idle' as const,
  }
}

export const useRouteStudy = create<RouteStudyState>()((set, get) => ({
  phase: 'idle',
  error: null,
  study: null,
  draftMarks: emptyMarks(),
  lastMarkId: null,
  selectedCorridorId: null,
  intent: emptyIntent(),
  coursesPhase: 'idle',
  selectedCourseName: null,
  orbatUnits: [],
  selectedUnitId: null,
  blockPhase: 'idle',
  preferences: null,

  addMark: (kind, lon, lat, options) => {
    const marks = get().draftMarks
    const existing = listFor(marks, kind)
    const fallback = kind === 'reserve' ? `Reserve ${existing.length + 1}` : `Objective ${existing.length + 1}`
    const mark: Mark = {
      id: crypto.randomUUID(),
      name: options?.name ?? fallback,
      lon,
      lat,
      ...(kind === 'reserve' ? { intelligence_status: 'assessed' as const } : {}),
      ...options,
      ...(options?.bbox ? { bbox: options.bbox } : {}),
    }
    set({ draftMarks: withList(marks, kind, [...existing, mark]), lastMarkId: mark.id })
    return mark.id
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

  updateMark: (kind, id, patch) => {
    const marks = get().draftMarks
    set({
      draftMarks: withList(
        marks,
        kind,
        listFor(marks, kind).map((mark) => (mark.id === id ? { ...mark, ...patch } : mark)),
      ),
    })
  },

  clearLastMark: () => set({ lastMarkId: null }),

  clearDraft: () => set({ draftMarks: emptyMarks(), lastMarkId: null }),

  selectCorridor: (id) => set({ selectedCorridorId: id }),

  run: async (areaId, name) => {
    const marks = get().draftMarks
    const existing = get().study
    set({ phase: 'running', error: null })
    try {
      const study = existing?.areaId === areaId
        ? await updateRouteStudy(existing.id, { name, marks })
        : await createRouteStudy({ areaId, name, marks })
      set({ phase: 'ready', study, draftMarks: study.marks, ...adopt(study) })
    } catch (error: unknown) {
      set({ phase: 'error', error: message(error) })
    }
  },

  load: async (id) => {
    set({ phase: 'running', error: null, study: null, selectedCorridorId: null })
    try {
      const study = await fetchRouteStudy(id)
      set({ phase: 'ready', study, draftMarks: study.marks, ...adopt(study) })
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
      lastMarkId: null,
      selectedCorridorId: null,
      intent: emptyIntent(),
      coursesPhase: 'idle',
      selectedCourseName: null,
      orbatUnits: [],
      selectedUnitId: null,
      blockPhase: 'idle',
    }),

  // --- Enemy courses of action ------------------------------------------------

  setIntent: (patch) => set({ intent: { ...get().intent, ...patch } }),

  toggleIntentObjective: (objectiveId) => {
    const intent = get().intent
    const chosen = intent.objective_ids.includes(objectiveId)
      ? intent.objective_ids.filter((id) => id !== objectiveId)
      : [...intent.objective_ids, objectiveId]
    set({ intent: { ...intent, objective_ids: chosen } })
  },

  selectCourse: (name) => set({ selectedCourseName: name }),

  assessCourses: async () => {
    const study = get().study
    if (!study || get().coursesPhase === 'running') return
    set({ coursesPhase: 'running', error: null })
    try {
      const { intent, courses } = await runEnemyCourses(study.id, get().intent)
      set({
        coursesPhase: 'idle',
        intent,
        study: { ...study, intent, courses },
        // The model rewrites every course on each run, so a name selected
        // against the previous assessment points at nothing.
        selectedCourseName: courses.most_likely?.name ?? courses.courses[0]?.name ?? null,
      })
    } catch (error: unknown) {
      set({ coursesPhase: 'idle', error: message(error) })
    }
  },

  judgeCourse: async (courseName, verdict) => {
    const study = get().study
    if (!study) return
    try {
      const { weights } = await sendCourseFeedback(study.id, courseName, verdict)
      const previous = get().preferences
      set({ preferences: { weights, verdicts: (previous?.verdicts ?? 0) + 1 } })
    } catch (error: unknown) {
      set({ error: message(error) })
    }
  },

  // --- Order of battle --------------------------------------------------------

  addUnit: (echelon, lon, lat) => {
    const units = get().orbatUnits
    // Stamped under the last unit that can hold it, so building a company
    // top-down is a sequence of clicks rather than a sequence of dropdowns.
    const parent = [...units]
      .reverse()
      .find((unit) => ECHELON_DEPTH[unit.echelon] < ECHELON_DEPTH[echelon])
    const unit: OrbatUnit = {
      unit_id: crypto.randomUUID(),
      name: nextUnitName(units, echelon),
      echelon,
      parent_id: parent?.unit_id ?? null,
      lon,
      lat,
      strength: DEFAULT_STRENGTH[echelon],
      weapons: [],
      availability: 'uncommitted',
      redcon: null,
    }
    set({ orbatUnits: [...units, unit], selectedUnitId: unit.unit_id })
  },

  updateUnit: (unitId, patch) =>
    set({
      orbatUnits: get().orbatUnits.map((unit) =>
        unit.unit_id === unitId ? { ...unit, ...patch } : unit,
      ),
    }),

  removeUnit: (unitId) => {
    // Children are re-parented rather than deleted with their parent: losing a
    // company HQ to a stray click must not silently delete its platoons.
    const removed = get().orbatUnits.find((unit) => unit.unit_id === unitId)
    set({
      orbatUnits: get()
        .orbatUnits.filter((unit) => unit.unit_id !== unitId)
        .map((unit) =>
          unit.parent_id === unitId ? { ...unit, parent_id: removed?.parent_id ?? null } : unit,
        ),
      selectedUnitId: get().selectedUnitId === unitId ? null : get().selectedUnitId,
    })
  },

  setUnitAvailability: (unitId, availability) => get().updateUnit(unitId, { availability }),

  selectUnit: (unitId) => set({ selectedUnitId: unitId }),

  // --- Block forces -----------------------------------------------------------

  planBlocks: async (blockPoints, delayAssessments) => {
    const study = get().study
    if (!study || get().blockPhase === 'running') return
    const units = get().orbatUnits
    // The engine rejects a malformed tree outright. Saying which unit is wrong
    // here beats a 400 with the first pydantic message in it.
    const issues = orbatIssues(units)
    if (issues.length > 0) {
      set({ error: issues[0] })
      return
    }
    set({ blockPhase: 'running', error: null })
    try {
      const retainedPoints = blockPoints ?? blockPointInputs(study.blockPlan)
      const retainedDelays = delayAssessments ?? delayAssessmentInputs(study.blockPlan)
      const { orbat, blockPlan } = await runBlockForces(
        study.id,
        { units },
        retainedPoints,
        retainedDelays,
      )
      set({
        blockPhase: 'idle',
        orbatUnits: orbat.units,
        study: { ...study, orbat, blockPlan },
      })
    } catch (error: unknown) {
      set({ blockPhase: 'idle', error: message(error) })
    }
  },

  // --- Learned ranking --------------------------------------------------------

  loadPreferences: async () => {
    try {
      set({ preferences: await fetchPreferences() })
    } catch {
      // A ranking nobody can inspect is worse than no ranking, but failing to
      // read one is no reason to stop the operator working.
      set({ preferences: null })
    }
  },

  forgetPreferences: async () => {
    try {
      set({ preferences: { weights: await resetPreferences(), verdicts: 0 } })
    } catch (error: unknown) {
      set({ error: message(error) })
    }
  },
}))
