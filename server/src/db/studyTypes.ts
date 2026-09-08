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
