import { descendants, orbatRows, type OrbatRow } from './orbatTree'
import type { BlockPlan, OrbatUnit, RoadGraph } from '../types/routeStudy'

/**
 * Reading a block plan.
 *
 * The engine answers with four separate lists, and the distinction between the
 * last two is the point: `unblockable` is ground nothing can be put on,
 * `uncovered` is ground that could have been held had the force not run out.
 * Collapsing them into "not blocked" would hide which one a commander can fix
 * by finding more men.
 */

export type Coverage = 'allocated' | 'uncovered' | 'unblockable' | 'unknown'

export function allocationByCorridor(plan: BlockPlan) {
  return new Map(plan.allocation.map((entry) => [entry.corridor_id, entry]))
}

export function unblockableByCorridor(plan: BlockPlan): Map<string, string> {
  return new Map(plan.unblockable.map((entry) => [entry.corridor_id, entry.reason]))
}

/** The formed body committed by one allocation, presented as an ORBAT rooted
 * at the assigned unit. Ancestors are availability dependencies, not members
 * of the task-organised block force, so only the unit and its descendants are
 * included. */
export function blockForceOrbat(units: OrbatUnit[], unitId: string): OrbatRow[] {
  if (!units.some((unit) => unit.unit_id === unitId)) return []
  const included = new Set([unitId, ...descendants(units, unitId)])
  return orbatRows(units.filter((unit) => included.has(unit.unit_id)))
}

/** What happened to one corridor. `unknown` means this plan predates the
 *  corridor — a re-run of the study after an allocation — and is deliberately
 *  not reported as uncovered, which would be a claim the engine never made. */
export function blockCoverage(plan: BlockPlan | null, corridorId: string): Coverage {
  if (!plan) return 'unknown'
  if (plan.allocation.some((entry) => entry.corridor_id === corridorId)) return 'allocated'
  if (plan.unblockable.some((entry) => entry.corridor_id === corridorId)) return 'unblockable'
  if (plan.uncovered.some((entry) => entry.corridor_id === corridorId)) return 'uncovered'
  return 'unknown'
}

export function blockSummary(plan: BlockPlan): {
  allocated: number
  uncovered: number
  unblockable: number
} {
  return {
    allocated: plan.allocation.length,
    uncovered: plan.uncovered.length,
    unblockable: plan.unblockable.length,
  }
}

/** A point on the corridor's choke edge, to draw an allocation link to.
 *
 *  A real vertex rather than an interpolated midpoint: the link is a sketch of
 *  which unit holds which choke point, and a vertex is guaranteed to sit on
 *  the road. */
export function chokeMidpoint(graph: RoadGraph, chokeEdgeIds: string[]): [number, number] | null {
  for (const edgeId of chokeEdgeIds) {
    const edge = graph.edges.find((candidate) => candidate.id === edgeId)
    if (edge && edge.points.length > 0) return edge.points[Math.floor(edge.points.length / 2)]
  }
  return null
}
