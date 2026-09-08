/** Shapes stored inside route_studies' jsonb columns. Kept out of schema.ts so
 *  the table definition stays readable. */

export interface Mark {
  id: string
  name: string
  lon: number
  lat: number
}

export interface StudyMarks {
  reserves: Mark[]
  objectives: Mark[]
}

/** One approach, as the engine derived it. */
export interface Corridor {
  id: string
  routes: {
    reserve_id: string
    objective_id: string
    edge_ids: string[]
    node_ids: number[]
    seconds: number
    length_meters: number
  }[]
  choke_edge_ids: string[]
  fastest_seconds: number
}

export interface UnreachablePair {
  reserve_id: string
  objective_id: string
  reason: string
}

export interface StudyResult {
  corridors: Corridor[]
  unreachable: UnreachablePair[]
}

/** What the operator changed about a corridor the engine found.
 *
 *  Held as an overlay keyed by corridor id rather than written into the
 *  corridor itself: the engine's output is a derivation of the ground and is
 *  replaced wholesale on every re-run, while these survive it. That only works
 *  because corridor ids are derived from the ground they cover. */
export interface CorridorEdit {
  name?: string
  category?: string
}

/** The force available for blocking, as the operator supplied it.
 *
 *  Not the formation's whole establishment: units get moved around by mission
 *  requirement, so what can actually be committed today is given per study. */
export interface OrbatUnit {
  unit_id: string
  name: string
  echelon: 'company' | 'platoon' | 'section' | 'group'
  parent_id?: string | null
  lon: number
  lat: number
  strength: number
  availability: 'uncommitted' | 'committed' | 'reserve'
}

export interface Orbat {
  units: OrbatUnit[]
}

export type Echelon = OrbatUnit['echelon']

export interface BlockCandidate {
  unit_id: string
  unit_name: string
  echelon: Echelon
  strength: number
  /** Straight-line metres to the choke point — not road distance, not time. */
  distance_meters: number
}

export interface CorridorBlock {
  corridor_id: string
  choke_edge_ids: string[]
  candidates: BlockCandidate[]
}

export interface BlockAllocation {
  corridor_id: string
  unit_id: string
  unit_name: string
  distance_meters: number
}

/** A corridor nothing can be put on. Distinct from `uncovered`, which is a
 *  corridor that could have been blocked had the force not run out. */
export interface UnblockableCorridor {
  corridor_id: string
  reason: string
}

export interface BlockPlan {
  corridors: CorridorBlock[]
  allocation: BlockAllocation[]
  unblockable: UnblockableCorridor[]
  uncovered: { corridor_id: string }[]
}
