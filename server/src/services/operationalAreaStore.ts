import { eq, inArray } from 'drizzle-orm'
import { db } from '../db/client'
import { courseFeedback, operationalAreas, routeStudies } from '../db/schema'
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

/** Removes an area and everything standing on it.
 *
 *  A study is meaningless without the graph it was routed over, so the two
 *  cannot be deleted independently -- and the foreign keys say so. Ordered
 *  child-first rather than wrapped in a transaction because neon-http has no
 *  interactive transactions (see db/client.ts); a failure part way through
 *  leaves fewer rows than asked for, never a study pointing at a missing area.
 *
 *  Returns null when the area was never there, so the caller can answer 404
 *  rather than reporting a delete that deleted nothing. */
export async function deleteOperationalArea(
  id: string,
): Promise<{ deletedStudies: number } | null> {
  const existing = await db
    .select({ id: operationalAreas.id })
    .from(operationalAreas)
    .where(eq(operationalAreas.id, id))
    .limit(1)
  if (!existing[0]) return null

  const studies = await db
    .select({ id: routeStudies.id })
    .from(routeStudies)
    .where(eq(routeStudies.areaId, id))
  const studyIds = studies.map((row) => row.id)

  if (studyIds.length > 0) {
    await db.delete(courseFeedback).where(inArray(courseFeedback.studyId, studyIds))
    await db.delete(routeStudies).where(eq(routeStudies.areaId, id))
  }
  await db.delete(operationalAreas).where(eq(operationalAreas.id, id))

  return { deletedStudies: studyIds.length }
}
