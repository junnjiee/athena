import type { Corridor, CorridorEdit, StudyResult } from '../types/routeStudy'

/**
 * Presenting corridors: naming, ordering and colouring them.
 *
 * The engine returns corridors derived from ground and identified by a hash of
 * it. Everything a human reads — a name, a colour, a rank — is applied here, so
 * a re-run replaces the derivation without disturbing what the operator sees.
 */

/** Distinct hues for adjacent corridors on the map. Deliberately not the
 *  blue/red force palette: a corridor is ground, not a side. */
export const CORRIDOR_COLORS = [
  '#f59e0b',
  '#8b5cf6',
  '#14b8a6',
  '#ec4899',
  '#84cc16',
  '#0ea5e9',
  '#f97316',
  '#a855f7',
] as const

export function corridorColor(index: number): string {
  return CORRIDOR_COLORS[index % CORRIDOR_COLORS.length]
}

/** What to call a corridor: the operator's name if they gave one, else a
 *  stable fallback from its rank. Never the raw id — a hash is not a name. */
export function corridorLabel(
  corridor: Corridor,
  index: number,
  edits: Record<string, CorridorEdit>,
): string {
  const named = edits[corridor.id]?.name?.trim()
  return named && named.length > 0 ? named : `Corridor ${index + 1}`
}

/** Minutes to traverse, for display. */
export function corridorMinutes(corridor: Corridor): number {
  return Math.round(corridor.fastest_seconds / 60)
}

/** Every edge in a corridor, deduplicated — what to draw for it. */
export function corridorEdgeIds(corridor: Corridor): string[] {
  const seen = new Set<string>()
  for (const route of corridor.routes) {
    for (const id of route.edge_ids) seen.add(id)
  }
  return [...seen]
}

/** True when the operator has marked this corridor's choke point impassable,
 *  which is how "block this corridor" is expressed against the graph. */
export function isChokeBlocked(corridor: Corridor, edgeOverrides: string[]): boolean {
  if (corridor.choke_edge_ids.length === 0) return false
  const blocked = new Set(edgeOverrides)
  return corridor.choke_edge_ids.every((id) => blocked.has(id))
}

/** Blocking a corridor means blocking the ground all its routes cross. A
 *  corridor with no common edge cannot be blocked at a single point, and
 *  saying so is more useful than offering a button that does nothing. */
export function chokeToggle(
  corridor: Corridor,
  edgeOverrides: string[],
): { canBlock: boolean; next: string[] } {
  if (corridor.choke_edge_ids.length === 0) {
    return { canBlock: false, next: edgeOverrides }
  }
  const blocked = new Set(edgeOverrides)
  const alreadyBlocked = corridor.choke_edge_ids.every((id) => blocked.has(id))
  for (const id of corridor.choke_edge_ids) {
    if (alreadyBlocked) blocked.delete(id)
    else blocked.add(id)
  }
  return { canBlock: true, next: [...blocked].sort() }
}

/** Pairs the engine could not route, phrased for a commander. */
export function unreachableSummary(result: StudyResult, marks: {
  reserves: { id: string; name: string }[]
  objectives: { id: string; name: string }[]
}): string[] {
  const name = (list: { id: string; name: string }[], id: string) =>
    list.find((m) => m.id === id)?.name ?? id
  return result.unreachable.map(
    (pair) =>
      `${name(marks.reserves, pair.reserve_id)} → ${name(marks.objectives, pair.objective_id)}: ${pair.reason}`,
  )
}
