import { pgTable, text, integer, real, jsonb, timestamp, customType } from 'drizzle-orm/pg-core'
import type { BBox, Weather, OsmFeatures, SegmentationInfo } from '../types'
import type { PlacedUnit, PlacedObjective, PlacedRoute } from './planTypes'

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

/**
 * A batch this service submitted, and the plan it was drawn from.
 *
 * Deliberately *not* a copy of the results. The engine stores every run's
 * outcome itself and serves it back on `GET /v1/simulation-batches/{id}`, so
 * duplicating it here would give two records that can disagree — and recording
 * results as the event stream passes would lose them the moment the operator
 * closed the tab, which is the failure this table exists to fix.
 *
 * What the engine cannot know is which plan a batch belongs to: it is handed an
 * uploaded scenario, not a plan id. That mapping is the whole point of this row.
 */
export const simulationBatches = pgTable('simulation_batches', {
  id: text('id').primaryKey(),
  planId: text('plan_id')
    .notNull()
    .references(() => plans.id, { onDelete: 'cascade' }),
  /** Plan name as it read when the batch ran — a later rename should not
   *  silently relabel history. */
  planName: text('plan_name').notNull(),
  battlegroundId: text('battleground_id')
    .notNull()
    .references(() => battlegrounds.id),
  simulationCount: integer('simulation_count').notNull(),
  ticks: integer('ticks').notNull(),
  model: text('model'),
  /** Soldiers actually fielded, after establishment expansion. */
  soldiers: integer('soldiers').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
