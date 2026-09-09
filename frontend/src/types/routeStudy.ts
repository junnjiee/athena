import type { BBoxDeg } from './terrain'

export type RoadTheme = 'raptors' | 'big-cats' | 'weather' | 'trees'
export type OperationalRoadWidth = 2 | 4 | 6
export type OperationalRoadType = 'X' | 'Y' | 'Z'

export interface RoadEdit {
  name: string
  width: OperationalRoadWidth
  dual: boolean
  type: OperationalRoadType
}

export interface OperationalAreaMeta {
  id: string
  name: string
  bbox: BBoxDeg
  generatedAt: string
  nodeCount: number
  edgeCount: number
  currentRevision: number
  demResolutionMeters: number
  roadTheme: RoadTheme
  /** Sparse operator edits keyed by road identity, never by graph segment. */
  roadEdits: Record<string, RoadEdit>
}

export interface GraphNode {
  id: number
  lon: number
  lat: number
  elevation: number
}

export interface GraphEdge {
  id: string
  wayId: number
  from: number
  to: number
  roadClass: string
  /** OSM source metadata. Older stored graphs legitimately omit both. */
  name?: string | null
  lanes?: string | null
  /** Terrain fact retained for comparison/display but excluded from routing. */
  destroyed?: boolean
  nodes: number[]
  points: [number, number][]
  lengthMeters: number
}

export interface RoadGraph {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export interface StudyMark {
  id: string
  /** Reserve designation. Kept as `name` for backward compatibility with
   *  existing studies and with objective marks. */
  name: string
  lon: number
  lat: number
  /** Named terrain reference for reserves and objectives. */
  locality?: string
  /** Reserve-only S2 fields. Older saved marks legitimately omit them. */
  level?: ReserveLevel
  owning_formation?: string
  intelligence_status?: IntelligenceStatus
  /** Bounded excerpts retained when a document proposal becomes a mark. Raw
   *  source bytes are never stored in the study. */
  intelligence_evidence?: IntelligenceEvidence[]
  task_organization?: TaskOrganizationElement[]
  timing?: ReserveTiming
  /** Objectives are usually ground, not a pin. Routing stops at the first live
   *  road point reached inside its bounds, including midway along an edge;
   *  lon/lat remains the centre and fallback snap. */
  bbox?: BBoxDeg
}

export type ReserveLevel = 'K' | 'K1' | 'K2' | 'K3' | 'K4'
export type IntelligenceStatus = 'assessed' | 'confirmed'

export interface IntelligenceEvidence {
  source_document_id: string
  source_document_name: string
  excerpt: string
}

export interface ReserveTiming {
  /** Doctrinal stages normalized to minutes; missing means not yet assessed. */
  decision_minutes?: number
  readiness_minutes?: number
  deployment_minutes?: number
}

export type AggressorEchelon = 'division' | 'regiment' | 'battalion' | 'company' | 'platoon' | 'section'
export type CompositionModifier = '=' | '-' | 'full' | '+'

export interface PlatformCount {
  id: string
  platform: string
  /** Full-establishment count. The formation modifier supplies the exact
   *  fractional-third multiplier; it is never rounded into another echelon. */
  establishment_count: number
}

export interface TaskOrganizationElement {
  id: string
  designation: string
  echelon: AggressorEchelon
  modifier: CompositionModifier
  /** 1 is the lead element. Ordering is explicit, never inferred from type. */
  order_of_move: number
  platforms: PlatformCount[]
}

export interface StudyMarks {
  reserves: StudyMark[]
  objectives: StudyMark[]
}

export interface StudyRoute {
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
}

export interface Corridor {
  id: string
  routes: StudyRoute[]
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

export interface CorridorEdit {
  name?: string
  category?: string
  reattachment?: {
    from_corridor_id: string
    from_revision: number
    to_revision: number
    overlap: number
  }
}

export interface RouteStudySummary {
  id: string
  areaId: string
  name: string
  updatedAt: string
}

export interface RouteStudy {
  id: string
  areaId: string
  name: string
  /** Immutable road-graph snapshot that produced result. */
  graphRevision: number
  currentGraphRevision: number
  stale: boolean
  marks: StudyMarks
  edgeOverrides: string[]
  result: StudyResult
  corridorEdits: Record<string, CorridorEdit>
  /** The S3 pass. Null until block forces have been run over this study. */
  orbat: Orbat | null
  blockPlan: BlockPlan | null
  /** The S2 pass. Null until courses of action have been assessed. */
  intent: EnemyIntent | null
  courses: RankedCourses | null
}

export type OperationalToolMode =
  | 'navigate'
  | 'select-area'
  | 'draw-road'
  | 'break-road'
  | 'place-reserve'
  /** Objectives are dragged as ground. A drag too small to be ground is taken
   *  as a click and stored as a point, so a bridge is still one mark. */
  | 'draw-objective-area'
  | 'place-orbat-unit'
  | 'place-block-point'

export type StudyMarkKind = 'reserve' | 'objective'

// Short aliases used by the route-study store and panels.
export type Mark = StudyMark
export type MarkKind = StudyMarkKind

// --- Order of battle, block forces, enemy courses of action -------------------
//
// Mirrors the engine's wire shapes (see engine/athena/{orbat,blocking,eca,
// preference}.py and server/src/db/studyTypes.ts). Snake case throughout: these
// cross the engine boundary unchanged.

export type Echelon = 'company' | 'platoon' | 'section' | 'group'

export type Availability = 'uncommitted' | 'committed' | 'reserve'
export type Redcon = 1 | 2 | 3 | 4 | 5

export interface OrbatUnit {
  unit_id: string
  name: string
  echelon: Echelon
  parent_id?: string | null
  lon: number
  lat: number
  strength: number
  /** Organic holdings only; a formed block force includes descendants. */
  weapons?: WeaponHolding[]
  availability: Availability
  /** Readiness only; does not determine whether the unit is available. */
  redcon?: Redcon | null
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

export interface BlockCandidate {
  unit_id: string
  unit_name: string
  echelon: Echelon
  /** Aggregated organic holdings on this unit and all of its descendants. */
  weapons?: BlockWeapon[]
  /** Present only in saved block plans created before weapon holdings. */
  strength?: number
  /** Straight-line metres to the inlet — not road distance, not time. */
  distance_meters: number
  /** Exact inlet point against which distance_meters was measured. */
  nearest_point?: { lon: number; lat: number }
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

/** Saved before allocation became inlet-based. Read-only compatibility shape. */
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
  /** Exact inlet point against which distance_meters was measured. */
  nearest_point?: { lon: number; lat: number }
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

/** Ground the model named that the study does not contain. Surfaced rather
 *  than swallowed — the assessment is a subset of what was proposed. */
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

export interface RankingWeights {
  speed: number
  blockable: number
  complexity: number
  likelihood: number
  danger: number
}

export interface Preferences {
  weights: RankingWeights
  verdicts: number
}

export type Verdict = 'accepted' | 'rejected'

/** What one verdict did: where the weights landed, and the feature vector of
 *  the course that moved them. Courses have no identity across runs; features
 *  do, which is what makes feedback attachable at all. */
export interface CourseFeedbackResult {
  weights: RankingWeights
  features: RankingWeights
}
