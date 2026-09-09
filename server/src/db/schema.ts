import { pgTable, text, integer, real, jsonb, timestamp, customType } from 'drizzle-orm/pg-core'
import type { BBox, Weather, OsmFeatures, RoadEdit, RoadTheme, SegmentationInfo } from '../types'
import type { PlacedUnit, PlacedObjective, PlacedRoute } from './planTypes'
import type {
  BlockPlan,
  CorridorEdit,
  CourseFeatures,
  Echelon,
  EnemyIntent,
  Orbat,
  RankedCourses,
  RankingWeights,
  StudyMarks,
  StudyResult,
  Verdict,
} from './studyTypes'

const bytea = customType<{ data: Buffer }>({
  dataType() {
    return 'bytea'
  },
})

/** A generated battlefield's terrain snapshot -- immutable once written, so
 *  plans referencing the same battleground never need to re-run the DEM/OSM/
 *  weather pipeline (which isn't deterministic across time anyway). */
export const battlegrounds = pgTable('battlegrounds', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  bbox: jsonb('bbox').$type<BBox>().notNull(),
  width: integer('width').notNull(),
  height: integer('height').notNull(),
  cellMeters: real('cell_meters').notNull(),
  generatedAt: text('generated_at').notNull(),
  weather: jsonb('weather').$type<Weather | null>(),
  featureCounts: jsonb('feature_counts').$type<{ roads: number; buildings: number; areas: number }>().notNull(),
  segmentation: jsonb('segmentation').$type<SegmentationInfo | null>(),
  /** packed binary grid -- same wire format as GET /api/battleground/:id/grid (see services/grid.ts). */
  gridBuffer: bytea('grid_buffer').notNull(),
  features: jsonb('features').$type<OsmFeatures>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/** A commander's drawn plan against a saved battleground. One battleground can
 *  have many plans drawn on it. */
export const plans = pgTable('plans', {
  id: text('id').primaryKey(),
  battlegroundId: text('battleground_id')
    .notNull()
    .references(() => battlegrounds.id),
  name: text('name').notNull(),
  units: jsonb('units').$type<PlacedUnit[]>().notNull(),
  objectives: jsonb('objectives').$type<PlacedObjective[]>().notNull(),
  routes: jsonb('routes').$type<PlacedRoute[]>().notNull(),
  /** Mission start as epoch milliseconds, or null when the operator hasn't set
   *  one. Stored as text because it exceeds a 32-bit integer and the exact
   *  instant matters more than arithmetic in SQL. */
  hHour: text('h_hour'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/** An ingested operational area: the drivable road network over wide ground,
 *  stored as a gzipped graph. Immutable once written, like a battleground, so
 *  route studies over the same ground never re-hit Overpass. */
export const operationalAreas = pgTable('operational_areas', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  bbox: jsonb('bbox').$type<BBox>().notNull(),
  generatedAt: text('generated_at').notNull(),
  // Denormalized so the list page never inflates a graph to show its size --
  // same rationale as battlegrounds.featureCounts.
  nodeCount: integer('node_count').notNull(),
  edgeCount: integer('edge_count').notNull(),
  demResolutionMeters: real('dem_resolution_meters').notNull(),
  roadTheme: text('road_theme').$type<RoadTheme>().notNull().default('raptors'),
  roadEdits: jsonb('road_edits').$type<Record<string, RoadEdit>>().notNull().default({}),
  /** gzipped JSON — see services/graphWire.ts for why not a binary layout. */
  graphBuffer: bytea('graph_buffer').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

/** One route study over an operational area: the ground the operator marked,
 *  the corridors the engine derived from it, and the operator's own edits.
 *  Mutable, unlike the area it stands on. */
export const routeStudies = pgTable('route_studies', {
  id: text('id').primaryKey(),
  areaId: text('area_id')
    .notNull()
    .references(() => operationalAreas.id),
  name: text('name').notNull(),
  marks: jsonb('marks').$type<StudyMarks>().notNull(),
  /** Edges the operator marked impassable — a dropped bridge is an edge, not a
   *  corridor, so removing one never deletes ground other corridors share. */
  edgeOverrides: jsonb('edge_overrides').$type<string[]>().notNull(),
  /** Last engine result. Cached so re-reading a study costs nothing; replaced
   *  wholesale whenever the ground or the marks change. */
  result: jsonb('result').$type<StudyResult>().notNull(),
  /** Operator renames and categories, keyed by corridor id. */
  corridorEdits: jsonb('corridor_edits').$type<Record<string, CorridorEdit>>().notNull(),
  /** Force available for blocking, and the largest formation that may be
   *  committed to any one corridor. Null until an S3 pass has been run. */
  orbat: jsonb('orbat').$type<Orbat | null>(),
  ceiling: text('ceiling').$type<Echelon | null>(),
  /** Last block-force result, cached like the corridor result above. */
  blockPlan: jsonb('block_plan').$type<BlockPlan | null>(),
  /** What the operator believes the enemy wants, and the courses of action the
   *  engine assessed from it. Null until an S2 pass has been run. */
  intent: jsonb('intent').$type<EnemyIntent | null>(),
  courses: jsonb('courses').$type<RankedCourses | null>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/** Learned ranking weights. One row: this service has no user model, so
 *  preference is per deployment rather than per operator. */
export const rankingWeights = pgTable('ranking_weights', {
  id: text('id').primaryKey(),
  weights: jsonb('weights').$type<RankingWeights>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/** Every verdict that moved the weights, kept so the drift can be audited and
 *  explained rather than merely undone. */
export const courseFeedback = pgTable('course_feedback', {
  id: text('id').primaryKey(),
  studyId: text('study_id')
    .notNull()
    .references(() => routeStudies.id),
  courseName: text('course_name').notNull(),
  verdict: text('verdict').$type<Verdict>().notNull(),
  /** The course's feature vector at the time — why this verdict moved the
   *  weights as it did. Courses have no identity across runs; features do. */
  features: jsonb('features').$type<CourseFeatures>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
