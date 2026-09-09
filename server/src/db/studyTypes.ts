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
  /** Evidence retained after operator acceptance; source bytes are never stored. */
  intelligence_evidence?: {
    source_document_id: string
    source_document_name: string
    excerpt: string
  }[]
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
  /** Objectives are ground, not pins: routing stops at the first live road
   *  point reached inside these bounds, including midway along an edge.
   *  lon/lat remains the centre and fallback snap. */
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
    /** Exact area boundary reached part-way along the final graph edge. */
    terminal?: {
      edge_id: string
      lon: number
      lat: number
      /** Fraction of stored edge geometry measured from its `from` node. */
      edge_fraction: number
    } | null
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
  weapons?: WeaponHolding[]
  availability: 'uncommitted' | 'committed' | 'reserve'
  redcon?: 1 | 2 | 3 | 4 | 5 | null
}

export type WeaponSystem =
  | 'ATGM'
  | 'Light RR'
  | 'LAW'
  | '40mm AGL'
  | '12.7mm HMG'
  | 'GPMG'
  | 'SAW'
  | '81mm mortar'
  | '60mm mortar'
  | 'mini UAV'

export interface WeaponHolding {
  id: string
  weapon: WeaponSystem
  count: number
}

export interface BlockWeapon {
  weapon: WeaponSystem
  count: number
}

export interface Orbat {
  units: OrbatUnit[]
}

export type Echelon = OrbatUnit['echelon']

export interface BlockCandidate {
  unit_id: string
  unit_name: string
  echelon: Echelon
  /** Aggregated organic holdings on this unit and all of its descendants. */
  weapons?: BlockWeapon[]
  /** Legacy block plans used manpower here. */
  strength?: number
  /** Straight-line metres to the inlet — not road distance, not time. */
  distance_meters: number
}

export interface InletBlock {
  inlet_id: string
  corridor_id: string
  inlet_number: number
  reserve_id: string
  objective_id: string
  edge_ids: string[]
  /** Enemy movement time over the complete inlet route. Missing on legacy plans. */
  movement_seconds?: number
  candidates: BlockCandidate[]
}

/** Legacy shape retained only so route studies saved before inlet allocation
 *  remain readable. New engine responses use `inlets`. */
export interface CorridorBlock {
  corridor_id: string
  choke_edge_ids: string[]
  candidates: BlockCandidate[]
}

export interface BlockAllocation {
  inlet_id?: string
  corridor_id: string
  unit_id: string
  unit_name: string
  distance_meters: number
  block_point?: BlockPoint | null
}

export interface BlockPointInput {
  inlet_id: string
  lon: number
  lat: number
}

export interface BlockPoint extends BlockPointInput {
  enemy_movement_seconds: number
  snap_distance_meters: number
}

export interface DelayAssessmentInput {
  inlet_id: string
  unit_id: string
  delay_minutes: number
}

export interface BlockEstablishmentInput {
  inlet_id: string
  unit_id: string
  block_point_lon: number
  block_point_lat: number
  established_minutes: number
}

/** An inlet nothing can be put on. Distinct from `uncovered`, which is an
 *  inlet that could have been blocked had the force not run out. */
export interface UnblockableCorridor {
  inlet_id?: string
  corridor_id: string
  reason: string
}

export interface ExactCount {
  numerator: number
  denominator: number
}

export interface ReactionTimeline {
  commencement_minutes?: number | null
  contact_minutes?: number | null
  block_established_minutes?: number | null
  block_established_by_contact?: boolean | null
  delay_minutes?: number | null
  remnant_continued?: boolean | null
  objective_arrival_minutes?: number | null
  objective_outcome: 'reached' | 'did_not_reach' | 'unknown'
  unknowns: string[]
}

export interface SealingAssessment {
  inlet_id: string
  corridor_id: string
  reserve_id: string
  reserve_name?: string | null
  target_hardness?: 'soft_skin' | 'hard_skin_light' | 'hard_skin_heavy' | null
  target_platforms: { platform: string; count: ExactCount }[]
  target_platform_count?: ExactCount | null
  effective_weapons: BlockWeapon[]
  effective_weapon_count: number
  remaining_platform_count?: ExactCount | null
  outcome: 'destroyed_at_block' | 'delayed_and_attrited' | 'passed' | 'unknown'
  reason: string
  /** Missing on sealing assessments saved before the reaction-chain pass. */
  reaction?: ReactionTimeline
}

export interface BlockPlan {
  inlets?: InletBlock[]
  corridors?: CorridorBlock[]
  allocation: BlockAllocation[]
  unblockable: UnblockableCorridor[]
  uncovered: { inlet_id?: string; corridor_id: string }[]
  sealing?: SealingAssessment[]
  block_points?: BlockPoint[]
  rejected_block_points?: { inlet_id: string; reason: string }[]
  delay_assessments?: DelayAssessmentInput[]
  rejected_delay_assessments?: { inlet_id: string; reason: string }[]
  block_establishments?: BlockEstablishmentInput[]
  rejected_block_establishments?: { inlet_id: string; reason: string }[]
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
