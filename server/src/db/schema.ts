import { pgTable, text, integer, real, jsonb, timestamp, customType } from 'drizzle-orm/pg-core'
import type { BBox, Weather, OsmFeatures, SegmentationInfo } from '../types'
import type { PlacedUnit, PlacedObjective, PlacedRoute } from './planTypes'
import type { ReplayLog } from './replayTypes'

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

/** A playable replay of a Monte Carlo run, imported from the engine's already-
 *  produced ReplayLog JSON (schema_version 3). Tied to a battleground so
 *  soldiers render on real classified terrain -- battlefield.width/height is
 *  validated against the linked battleground's dimensions on import. */
export const simulationRuns = pgTable('simulation_runs', {
  id: text('id').primaryKey(),
  battlegroundId: text('battleground_id')
    .notNull()
    .references(() => battlegrounds.id),
  name: text('name').notNull(),
  // Denormalized so the list page never downloads the full replay just to
  // show step/soldier counts -- same rationale as battlegrounds.featureCounts.
  stepCount: integer('step_count').notNull(),
  soldierCount: integer('soldier_count').notNull(),
  replayLog: jsonb('replay_log').$type<ReplayLog>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
