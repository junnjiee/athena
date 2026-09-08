import { eq } from 'drizzle-orm'
import { db } from '../db/client'
import { operationalAreas } from '../db/schema'
import { decodeGraph, encodeGraph } from './graphWire'
import type { OperationalAreaMeta, RoadGraph } from '../types'

/** Writes an ingested area. Called only after a complete ingest: a partial
 *  graph is never persisted, so a row that exists is a row that routes. */
export async function persistOperationalArea(
  meta: OperationalAreaMeta,
  graph: RoadGraph,
): Promise<void> {
  await db.insert(operationalAreas).values({
    id: meta.id,
    name: meta.name,
    bbox: meta.bbox,
    generatedAt: meta.generatedAt,
    nodeCount: meta.nodeCount,
    edgeCount: meta.edgeCount,
    demResolutionMeters: meta.demResolutionMeters,
    graphBuffer: encodeGraph(graph),
  })
}

export async function loadOperationalArea(
  id: string,
): Promise<{ meta: OperationalAreaMeta; graph: RoadGraph } | null> {
  const rows = await db.select().from(operationalAreas).where(eq(operationalAreas.id, id)).limit(1)
  const row = rows[0]
  if (!row) return null

  return {
    meta: {
      id: row.id,
      name: row.name,
      bbox: row.bbox,
      generatedAt: row.generatedAt,
      nodeCount: row.nodeCount,
      edgeCount: row.edgeCount,
      demResolutionMeters: row.demResolutionMeters,
    },
    graph: decodeGraph(row.graphBuffer),
  }
}

/** The packed bytes as stored, for handing to the engine without a needless
 *  decode-and-re-encode round trip through this process. */
export async function loadOperationalGraphBuffer(id: string): Promise<Buffer | null> {
  const rows = await db
    .select({ graphBuffer: operationalAreas.graphBuffer })
    .from(operationalAreas)
    .where(eq(operationalAreas.id, id))
    .limit(1)
  return rows[0]?.graphBuffer ?? null
}

export async function listOperationalAreas(): Promise<OperationalAreaMeta[]> {
  const rows = await db
    .select({
      id: operationalAreas.id,
      name: operationalAreas.name,
      bbox: operationalAreas.bbox,
      generatedAt: operationalAreas.generatedAt,
      nodeCount: operationalAreas.nodeCount,
      edgeCount: operationalAreas.edgeCount,
      demResolutionMeters: operationalAreas.demResolutionMeters,
    })
    .from(operationalAreas)
  return rows
}
