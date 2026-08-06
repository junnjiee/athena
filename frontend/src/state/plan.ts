import { create } from 'zustand'
import type {
  ForceSide,
  LonLat,
  NewRouteInput,
  PlaceableMode,
  PlacedObjective,
  PlacedRoute,
  PlacedUnit,
  SymbolKind,
} from '../types/entities'

/**
 * The drawn plan: units, objectives, routes and the plan's name.
 *
 * This lives in a store rather than in BattlegroundSelectorPage's local state
 * because more than one surface mutates it -- the 3D globe, the topo sketch
 * view, the roster panel, and the voice assistant's tool calls. A page-local
 * `useState` can't be reached by the assistant, which runs outside the React
 * tree that owns the drawing surfaces.
 *
 * Terrain (meta/grid/features) stays in `state/battleground.ts`; this store is
 * only the human's drawing on top of it.
 */

const NATO = [
  'Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo', 'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliett',
  'Kilo', 'Lima', 'Mike', 'November', 'Oscar', 'Papa', 'Quebec', 'Romeo', 'Sierra', 'Tango',
  'Uniform', 'Victor', 'Whiskey', 'X-ray', 'Yankee', 'Zulu',
]

/** Every non-objective placeable tool -> the unit fields it stamps down. */
export const UNIT_PLACEMENT: Record<
  Exclude<PlaceableMode, 'place-objective'>,
  { side: ForceSide; symbolKind: SymbolKind; typeLabel: string }
> = {
  'place-blue-section': { side: 'blue', symbolKind: 'blueSection', typeLabel: 'Blue Force Section' },
  'place-blue-platoon': { side: 'blue', symbolKind: 'bluePlatoon', typeLabel: 'Blue Force Platoon' },
  'place-red-section': { side: 'red', symbolKind: 'redSection', typeLabel: 'Red Force Section' },
  'place-red-platoon': { side: 'red', symbolKind: 'redPlatoon', typeLabel: 'Red Force Platoon' },
  'place-trench': { side: 'red', symbolKind: 'trench', typeLabel: 'Trench Position' },
  'place-prepared-trench': { side: 'red', symbolKind: 'preparedTrench', typeLabel: 'Prepared Trench' },
}

const DEFAULT_OBJECTIVE_RADIUS_M = 150

/** A plan restored from the Plans page, ready to seed the drawing surfaces. */
export interface SavedPlanContents {
  id: string
  /** the plan's own title */
  name: string
  /** the ground it was drawn on, from the battleground snapshot */
  groundName: string
  units: PlacedUnit[]
  objectives: PlacedObjective[]
  routes: PlacedRoute[]
}

interface PlanState {
  /** Name of the ground being planned on -- edited in the header, and what the
   *  terrain pipeline records as the battleground's name. */
  planName: string
  /** The plan's own title, independent of the ground. Empty means "untitled",
   *  and the UI falls back to showing the ground name. Two courses of action on
   *  the same battleground differ only by this. */
  planTitle: string
  units: PlacedUnit[]
  objectives: PlacedObjective[]
  routes: PlacedRoute[]
  /** Row this drawing came from, or was last written to. Null means unsaved, so
   *  the next save inserts; non-null means the next save overwrites that row.
   *  Without this, every press of Save Plan left another near-identical copy. */
  savedPlanId: string | null

  setPlanName: (name: string) => void
  setPlanTitle: (title: string) => void
  /** Records the row a fresh save landed in, so the next save updates it. */
  markSaved: (id: string) => void
  /** Detaches the drawing from its saved row so the next save forks a copy. */
  forkPlan: () => void
  /** Places a unit/objective for a placement tool, naming it by NATO sequence.
   *  Returns the new element's id so a caller can select or reference it. */
  place: (mode: PlaceableMode, position: LonLat) => string
  addRoute: (input: NewRouteInput) => string
  moveUnit: (id: string, position: LonLat) => void
  moveObjective: (id: string, position: LonLat) => void
  rotateUnit: (id: string, rotationRadians: number) => void
  /** Removes a unit and every route that started at or ended on it. */
  deleteUnit: (id: string) => void
  /** Removes an objective and detaches any route that ended on it. */
  deleteObjective: (id: string) => void
  deleteRoute: (id: string) => void
  /** Removes whichever element carries this id, whatever kind it is. */
  deleteElement: (id: string) => void
  clearPlan: () => void
  /** Replaces the whole drawing with a plan loaded from the Plans page. */
  seedFromSaved: (plan: SavedPlanContents) => void
}

const EMPTY = {
  planName: '',
  planTitle: '',
  units: [],
  objectives: [],
  routes: [],
  savedPlanId: null,
}

export const usePlan = create<PlanState>((set, get) => ({
  ...EMPTY,

  setPlanName: (name) => set({ planName: name }),
  setPlanTitle: (title) => set({ planTitle: title }),
  markSaved: (id) => set({ savedPlanId: id }),
  forkPlan: () => set({ savedPlanId: null }),

  place(mode, position) {
    const id = crypto.randomUUID()

    if (mode === 'place-objective') {
      set((s) => ({
        objectives: [
          ...s.objectives,
          {
            id,
            name: `OBJ ${NATO[s.objectives.length % NATO.length].toUpperCase()}`,
            description: 'Capture & Hold',
            position,
            radiusMeters: DEFAULT_OBJECTIVE_RADIUS_M,
          },
        ],
      }))
      return id
    }

    const { side, symbolKind, typeLabel } = UNIT_PLACEMENT[mode]
    set((s) => {
      const sideCount = s.units.filter((u) => u.side === side).length
      return {
        units: [
          ...s.units,
          {
            id,
            side,
            symbolKind,
            name: NATO[sideCount % NATO.length],
            typeLabel,
            position,
            rotationRadians: 0,
          },
        ],
      }
    })
    return id
  },

  addRoute(input) {
    const id = crypto.randomUUID()
    set((s) => ({ routes: [...s.routes, { id, ...input }] }))
    return id
  },

  moveUnit: (id, position) =>
    set((s) => ({ units: s.units.map((u) => (u.id === id ? { ...u, position } : u)) })),

  moveObjective: (id, position) =>
    set((s) => ({ objectives: s.objectives.map((o) => (o.id === id ? { ...o, position } : o)) })),

  rotateUnit: (id, rotationRadians) =>
    set((s) => ({ units: s.units.map((u) => (u.id === id ? { ...u, rotationRadians } : u)) })),

  deleteUnit: (id) =>
    set((s) => ({
      units: s.units.filter((u) => u.id !== id),
      // A route is anchored to its start unit, so it can't outlive it; one
      // ending *on* the unit would otherwise point at a marker that's gone.
      routes: s.routes.filter(
        (r) => r.startUnitId !== id && !(r.endRef?.kind === 'unit' && r.endRef.id === id),
      ),
    })),

  deleteObjective: (id) =>
    set((s) => ({
      objectives: s.objectives.filter((o) => o.id !== id),
      routes: s.routes.filter((r) => !(r.endRef?.kind === 'objective' && r.endRef.id === id)),
    })),

  deleteRoute: (id) => set((s) => ({ routes: s.routes.filter((r) => r.id !== id) })),

  deleteElement(id) {
    const { units, objectives, routes } = get()
    if (units.some((u) => u.id === id)) return get().deleteUnit(id)
    if (objectives.some((o) => o.id === id)) return get().deleteObjective(id)
    if (routes.some((r) => r.id === id)) return get().deleteRoute(id)
  },

  clearPlan: () => set({ ...EMPTY }),

  seedFromSaved: (plan) =>
    set({
      planName: plan.groundName,
      planTitle: plan.name,
      units: plan.units,
      objectives: plan.objectives,
      routes: plan.routes,
      savedPlanId: plan.id,
    }),
}))

/** Case-insensitive lookup by callsign across units and objectives — the handle
 *  the voice assistant has on a plan, since a speaker says "Alpha", not a UUID.
 *
 *  Routes are deliberately not searchable here: they carry no name of their own,
 *  so callers address them through their start unit (`routes.filter(r =>
 *  r.startUnitId === unit.id)`). Objectives are matched with and without the
 *  "OBJ " prefix the placement tool stamps on, so "Bravo" finds "OBJ BRAVO". */
export function findElementByName(
  state: Pick<PlanState, 'units' | 'objectives'>,
  name: string,
): { id: string; kind: 'unit' | 'objective'; label: string } | null {
  const needle = name.trim().toLowerCase()
  if (needle === '') return null

  const unit = state.units.find((u) => u.name.toLowerCase() === needle)
  if (unit) return { id: unit.id, kind: 'unit', label: unit.name }

  const objective = state.objectives.find((o) => {
    const label = o.name.toLowerCase()
    return label === needle || label === `obj ${needle}`
  })
  if (objective) return { id: objective.id, kind: 'objective', label: objective.name }

  return null
}
