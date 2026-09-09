/** Shapes stored inside route_studies' jsonb columns. Kept out of schema.ts so
 *  the table definition stays readable. */

export interface Mark {
  id: string
  name: string
  lon: number
  lat: number
  /** Named terrain reference for either a reserve or objective. */
  locality?: string
  /** Reserve-only deployment-overlay fields; absent on objectives and legacy marks. */
  level?: 'K' | 'K1' | 'K2' | 'K3' | 'K4'
  owning_formation?: string
  intelligence_status?: 'assessed' | 'confirmed'
  task_organization?: {
    id: string
    designation: string
    echelon: 'division' | 'regiment' | 'battalion' | 'company' | 'platoon' | 'section'
    modifier: '=' | '-' | 'full' | '+'
    order_of_move: number
    platforms: { id: string; platform: string; establishment_count: number }[]
  }[]
  /** Operator-supplied doctrinal stages, normalized to minutes. Unknown stages
   *  stay absent rather than being treated as zero. */
  timing?: {
    decision_minutes?: number
    readiness_minutes?: number
    deployment_minutes?: number
  }
  /** Objectives are ground, not pins: when the operator dragged an area rather
   *  than clicking a point, its bounds ride along and lon/lat is the centre.
   *  The engine still routes to the centre, so this is display only. */
  bbox?: { west: number; south: number; east: number; north: number }
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
  /** Provenance shown when an edit was conservatively carried across a graph
   *  revision by shared-ground overlap. */
  reattachment?: {
    from_corridor_id: string
    from_revision: number
    to_revision: number
    overlap: number
  }
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

/** What the operator believes the enemy is trying to do. */
export interface EnemyIntent {
  objective_ids: string[]
  /** Free text as an S2 would write it; reaches the model unedited. */
  narrative: string
}

export interface Effort {
  kind: 'main' | 'supporting'
  corridor_id: string
  reserve_id: string
  rationale: string
}

export interface CourseOfAction {
  name: string
  narrative: string
  efforts: Effort[]
  likelihood: number
  danger: number
}

/** Ground the model named that the study does not contain. Surfaced, never
 *  swallowed — a model inventing a corridor is the failure the grounding check
 *  exists to catch, and hiding it removes the evidence it happened. */
export interface RejectedReference {
  course_name: string
  corridor_id?: string | null
  reserve_id?: string | null
  reason: string
}

export interface RankedCourses {
  courses: CourseOfAction[]
  most_likely: CourseOfAction | null
  most_dangerous: CourseOfAction | null
  rejected: RejectedReference[]
}

/** How much this operator has shown they care about each axis of a course.
 *
 *  Learned from what they accept and reject, kept visible and resettable: a
 *  ranking that drifts for reasons nobody can see is worse than no ranking. */
export interface RankingWeights {
  speed: number
  blockable: number
  complexity: number
  likelihood: number
  danger: number
}

/** What a judged course looked like — the record of why weights moved. */
export interface CourseFeatures extends RankingWeights {}

export type Verdict = 'accepted' | 'rejected'
