import { eq } from 'drizzle-orm'
import { db } from '../db/client'
import { battlegrounds } from '../db/schema'
import type { BattlegroundJob, BBox, GridMeta, OsmFeatures, Weather } from '../types'

/**
 * Durable home for generated terrain.
 *
 * A battleground used to reach Postgres only when the operator first saved a
 * plan on it, which made saving depend on the row still being in the pipeline's
 * in-memory LRU: restart the service, or generate `jobCacheSize` more grounds,
 * and saving failed with "re-run terrain generation". Because simulating
 * requires a saved plan, that silently blocked simulation too.
 *
 * Terrain is written as soon as it exists instead. The LRU stays, but purely as
 * a read-through cache in front of this.
 */

export interface StoredBattleground {
  meta: GridMeta
  features: OsmFeatures
  gridBuffer: Buffer
}

/** Rows are immutable once written — the same ground regenerated later is a new
 *  id — so a re-issued cache hit conflicting on id is expected, not an error. */
export async function persistBattleground(job: BattlegroundJob): Promise<void> {
  if (job.status !== 'ready' || !job.meta || !job.gridBuffer || !job.features) return

  await db
    .insert(battlegrounds)
    .values({
      id: job.meta.id,
      name: job.meta.name,
      bbox: job.meta.bbox,
      width: job.meta.width,
      height: job.meta.height,
      cellMeters: job.meta.cellMeters,
      generatedAt: job.meta.generatedAt,
      weather: job.meta.weather,
      featureCounts: job.meta.featureCounts,
      segmentation: job.meta.segmentation ?? null,
      gridBuffer: job.gridBuffer,
      features: job.features,
    })
    .onConflictDoNothing({ target: battlegrounds.id })
}

export async function loadBattleground(id: string): Promise<StoredBattleground | null> {
  const rows = await db.select().from(battlegrounds).where(eq(battlegrounds.id, id)).limit(1)
  const row = rows[0]
  if (!row) return null

  return {
    meta: {
      id: row.id,
      name: row.name,
      bbox: row.bbox as BBox,
      width: row.width,
      height: row.height,
      cellMeters: row.cellMeters,
      generatedAt: row.generatedAt,
      weather: row.weather as Weather | null,
      featureCounts: row.featureCounts,
      segmentation: row.segmentation,
    },
    features: row.features as OsmFeatures,
    gridBuffer: row.gridBuffer,
  }
}
