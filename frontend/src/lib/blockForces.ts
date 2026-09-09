import { descendants, orbatRows, type OrbatRow } from './orbatTree'
import type {
  BlockPlan,
  BlockEstablishmentInput,
  BlockPointInput,
  DelayAssessmentInput,
  ExactCount,
  InletBlock,
  OrbatUnit,
  RoadGraph,
  SealingAssessment,
} from '../types/routeStudy'

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

export function blockInlets(plan: BlockPlan): InletBlock[] {
  if (plan.inlets) return plan.inlets
  return (plan.corridors ?? []).map((block) => ({
    inlet_id: `legacy:${block.corridor_id}`,
    corridor_id: block.corridor_id,
    inlet_number: 1,
    reserve_id: '',
    objective_id: '',
    edge_ids: block.choke_edge_ids,
    candidates: block.candidates,
  }))
}

export function allocationByInlet(plan: BlockPlan) {
  return new Map(
    plan.allocation.map((entry) => [entry.inlet_id ?? `legacy:${entry.corridor_id}`, entry]),
  )
}

export function unblockableByInlet(plan: BlockPlan): Map<string, string> {
  return new Map(
    plan.unblockable.map((entry) => [
      entry.inlet_id ?? `legacy:${entry.corridor_id}`,
      entry.reason,
    ]),
  )
}

export function sealingByInlet(plan: BlockPlan): Map<string, SealingAssessment> {
  return new Map((plan.sealing ?? []).map((assessment) => [assessment.inlet_id, assessment]))
}

export function blockPointInputs(plan: BlockPlan | null): BlockPointInput[] {
  return (plan?.block_points ?? []).map(({ inlet_id, lon, lat }) => ({ inlet_id, lon, lat }))
}

/** Preserve every accepted operator point while replacing or clearing one inlet. */
export function replaceBlockPoint(
  plan: BlockPlan | null,
  inletId: string,
  position: { longitude: number; latitude: number } | null,
): BlockPointInput[] {
  const retained = blockPointInputs(plan)
    .filter((point) => point.inlet_id !== inletId)
  return position
    ? [...retained, { inlet_id: inletId, lon: position.longitude, lat: position.latitude }]
    : retained
}

export function delayAssessmentInputs(plan: BlockPlan | null): DelayAssessmentInput[] {
  return (plan?.delay_assessments ?? []).map(({ inlet_id, unit_id, delay_minutes }) => ({
    inlet_id,
    unit_id,
    delay_minutes,
  }))
}

/** Preserve every accepted delay assessment while replacing or clearing one inlet. */
export function replaceDelayAssessment(
  plan: BlockPlan | null,
  inletId: string,
  delayMinutes: number | null,
): DelayAssessmentInput[] {
  const retained = delayAssessmentInputs(plan)
    .filter((assessment) => assessment.inlet_id !== inletId)
  const unitId = plan?.allocation.find(
    (entry) => (entry.inlet_id ?? `legacy:${entry.corridor_id}`) === inletId,
  )?.unit_id
  return delayMinutes == null
    ? retained
    : unitId == null
      ? retained
      : [...retained, { inlet_id: inletId, unit_id: unitId, delay_minutes: delayMinutes }]
}

export function blockEstablishmentInputs(plan: BlockPlan | null): BlockEstablishmentInput[] {
  return (plan?.block_establishments ?? []).map((entry) => ({ ...entry }))
}

/** Bind an establishment time to the allocation and exact point it assessed. */
export function replaceBlockEstablishment(
  plan: BlockPlan | null,
  inletId: string,
  establishedMinutes: number | null,
): BlockEstablishmentInput[] {
  const retained = blockEstablishmentInputs(plan)
    .filter((entry) => entry.inlet_id !== inletId)
  if (establishedMinutes == null) return retained
  const allocation = plan?.allocation.find(
    (entry) => (entry.inlet_id ?? `legacy:${entry.corridor_id}`) === inletId,
  )
  const point = plan?.block_points?.find((entry) => entry.inlet_id === inletId)
    ?? allocation?.block_point
  if (!allocation || !point) return retained
  return [
    ...retained,
    {
      inlet_id: inletId,
      unit_id: allocation.unit_id,
      block_point_lon: point.lon,
      block_point_lat: point.lat,
      established_minutes: establishedMinutes,
    },
  ]
}

/** Preserve the engine's exact fractions instead of implying false precision
 * by rounding reduced force estimates to whole platforms. */
export function formatExactCount(count: ExactCount | null | undefined): string {
  if (!count) return '—'
  return count.denominator === 1 ? String(count.numerator) : `${count.numerator}/${count.denominator}`
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
  const inlets = blockInlets(plan).filter((entry) => entry.corridor_id === corridorId)
  if (inlets.length === 0) return 'unknown'
  if (plan.uncovered.some((entry) => entry.corridor_id === corridorId)) return 'uncovered'
  if (plan.unblockable.some((entry) => entry.corridor_id === corridorId)) return 'unblockable'
  const allocated = new Set(
    plan.allocation
      .filter((entry) => entry.corridor_id === corridorId)
      .map((entry) => entry.inlet_id ?? `legacy:${entry.corridor_id}`),
  )
  if (inlets.every((entry) => allocated.has(entry.inlet_id))) return 'allocated'
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

/** A representative point on an inlet, to draw an allocation link to.
 *
 *  A real route vertex rather than an interpolated point: the link remains a
 *  sketch of tasking, without implying a road movement or arrival time. */
export function inletMidpoint(graph: RoadGraph, edgeIds: string[]): [number, number] | null {
  const points = edgeIds.flatMap(
    (edgeId) => graph.edges.find((candidate) => candidate.id === edgeId)?.points ?? [],
  )
  return points[Math.floor(points.length / 2)] ?? null
}
