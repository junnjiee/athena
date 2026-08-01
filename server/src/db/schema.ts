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
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
