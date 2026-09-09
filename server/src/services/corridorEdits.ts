import type { Corridor, CorridorEdit, StudyResult } from '../db/studyTypes'

export const CORRIDOR_REATTACHMENT_FLOOR = 0.5

function ground(corridor: Corridor): Set<string> {
  return new Set(corridor.routes.flatMap((route) => route.edge_ids))
}

/** Jaccard overlap of the road ground covered by two corridor shapes. */
export function corridorGroundOverlap(one: Corridor, other: Corridor): number {
  const first = ground(one)
  const second = ground(other)
  const union = new Set([...first, ...second])
  if (union.size === 0) return 0
  let intersection = 0
  for (const edgeId of first) if (second.has(edgeId)) intersection += 1
  return intersection / union.size
}

/** Carries operator edits onto a new corridor result only when shared ground is
 *  strong enough to make the match defensible. Exact ids win first; remaining
 *  matches are one-to-one and greedily selected from highest overlap. */
export function reattachCorridorEdits(
  previous: StudyResult,
  next: StudyResult,
  edits: Record<string, CorridorEdit>,
  fromRevision: number,
  toRevision: number,
  floor = CORRIDOR_REATTACHMENT_FLOOR,
): Record<string, CorridorEdit> {
  const attached: Record<string, CorridorEdit> = {}
  const previousById = new Map(previous.corridors.map((corridor) => [corridor.id, corridor]))
  const claimedOld = new Set<string>()
  const claimedNew = new Set<string>()

  for (const corridor of next.corridors) {
    const edit = edits[corridor.id]
    if (!edit) continue
    attached[corridor.id] = edit
    claimedOld.add(corridor.id)
    claimedNew.add(corridor.id)
  }

  const candidates = Object.entries(edits).flatMap(([oldId, edit]) => {
    const oldCorridor = previousById.get(oldId)
    if (!oldCorridor || claimedOld.has(oldId)) return []
    return next.corridors
      .filter((corridor) => !claimedNew.has(corridor.id))
      .map((corridor) => ({
        oldId,
        newId: corridor.id,
        edit,
        overlap: corridorGroundOverlap(oldCorridor, corridor),
      }))
  }).sort((a, b) => b.overlap - a.overlap || a.oldId.localeCompare(b.oldId) || a.newId.localeCompare(b.newId))

  for (const candidate of candidates) {
    if (candidate.overlap < floor) break
    if (claimedOld.has(candidate.oldId) || claimedNew.has(candidate.newId)) continue
    attached[candidate.newId] = {
      ...candidate.edit,
      reattachment: {
        from_corridor_id: candidate.oldId,
        from_revision: fromRevision,
        to_revision: toRevision,
        overlap: candidate.overlap,
      },
    }
    claimedOld.add(candidate.oldId)
    claimedNew.add(candidate.newId)
  }

  return attached
}
