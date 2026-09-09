import type { Availability, Echelon, OrbatUnit } from '../types/routeStudy'

/**
 * The order of battle the operator builds to block with.
 *
 * The engine validates this tree too, and rejects a bad one outright. Doing it
 * here as well is not duplication for its own sake: a commander editing a force
 * list needs to see which unit is wrong while typing, not a 400 after pressing
 * run.
 */

export const ECHELON_ORDER: Echelon[] = ['company', 'platoon', 'section', 'group']

export const ECHELON_DEPTH: Record<Echelon, number> = {
  company: 0,
  platoon: 1,
  section: 2,
  group: 3,
}

export const ECHELON_LABEL: Record<Echelon, string> = {
  company: 'Company',
  platoon: 'Platoon',
  section: 'Section',
  group: 'Group',
}

/** Establishment strengths a new unit starts at, so placing one on the map is
 *  a single click rather than a form. Every one of them is editable. */
export const DEFAULT_STRENGTH: Record<Echelon, number> = {
  company: 90,
  platoon: 24,
  section: 7,
  group: 4,
}

export const AVAILABILITY_LABEL: Record<Availability, string> = {
  uncommitted: 'Uncommitted',
  committed: 'Committed',
  reserve: 'Reserve',
}

/** Whether committing this echelon stays inside the operator's ceiling. On
 *  depth rather than a rank order, so it cannot disagree with the tree rule. */
export function fitsWithin(echelon: Echelon, ceiling: Echelon): boolean {
  return ECHELON_DEPTH[echelon] >= ECHELON_DEPTH[ceiling]
}

/** What the engine would refuse, phrased for the operator. Empty means the
 *  ORBAT is sendable. */
export function orbatIssues(units: OrbatUnit[]): string[] {
  const issues: string[] = []
  const byId = new Map<string, OrbatUnit>()

  for (const unit of units) {
    if (byId.has(unit.unit_id)) issues.push(`${unit.name}: duplicate unit id`)
    byId.set(unit.unit_id, unit)
  }

  for (const unit of units) {
    const label = unit.name.trim() || unit.unit_id
    if (unit.name.trim() === '') issues.push(`${unit.unit_id}: needs a name`)
    if (!Number.isFinite(unit.strength) || unit.strength < 1) {
      issues.push(`${label}: strength must be at least one soldier`)
    }
    if (unit.parent_id == null) continue
    const parent = byId.get(unit.parent_id)
    if (!parent) {
      issues.push(`${label}: unknown parent unit`)
      continue
    }
    if (ECHELON_DEPTH[parent.echelon] >= ECHELON_DEPTH[unit.echelon]) {
      issues.push(`${label}: parent must be a higher echelon than ${ECHELON_LABEL[unit.echelon].toLowerCase()}`)
    }
  }
  return issues
}

export interface OrbatRow {
  unit: OrbatUnit
  depth: number
}

/** The tree flattened for display, parents before their children.
 *
 *  A unit whose parent is missing or circular is still listed, at the root:
 *  the panel exists to fix a broken force list, and a unit it refuses to draw
 *  is one nobody can correct. */
export function orbatRows(units: OrbatUnit[]): OrbatRow[] {
  const byId = new Map(units.map((unit) => [unit.unit_id, unit]))
  const children = new Map<string, OrbatUnit[]>()
  const roots: OrbatUnit[] = []

  for (const unit of units) {
    const parent = unit.parent_id != null ? byId.get(unit.parent_id) : undefined
    if (!parent || parent.unit_id === unit.unit_id) {
      roots.push(unit)
      continue
    }
    const siblings = children.get(parent.unit_id)
    if (siblings) siblings.push(unit)
    else children.set(parent.unit_id, [unit])
  }

  const rows: OrbatRow[] = []
  const seen = new Set<string>()

  function walk(unit: OrbatUnit, depth: number): void {
    if (seen.has(unit.unit_id)) return
    seen.add(unit.unit_id)
    rows.push({ unit, depth })
    for (const child of children.get(unit.unit_id) ?? []) walk(child, depth + 1)
  }

  for (const root of roots) walk(root, 0)
  // A parent cycle leaves its members out of every root's subtree. Listing them
  // flat is what makes the cycle fixable.
  for (const unit of units) walk(unit, 0)
  return rows
}

/** Everything under a unit, at any depth. */
export function descendants(units: OrbatUnit[], unitId: string): Set<string> {
  const children = new Map<string, OrbatUnit[]>()
  for (const unit of units) {
    if (unit.parent_id == null) continue
    const siblings = children.get(unit.parent_id)
    if (siblings) siblings.push(unit)
    else children.set(unit.parent_id, [unit])
  }
  const found = new Set<string>()
  const stack = [...(children.get(unitId) ?? [])]
  while (stack.length > 0) {
    const unit = stack.pop()
    if (!unit || found.has(unit.unit_id)) continue
    found.add(unit.unit_id)
    stack.push(...(children.get(unit.unit_id) ?? []))
  }
  return found
}

/** Every unit above this one, nearest parent first. */
export function ancestors(units: OrbatUnit[], unitId: string): Set<string> {
  const byId = new Map(units.map((unit) => [unit.unit_id, unit]))
  const found = new Set<string>()
  let cursor = byId.get(unitId)
  while (cursor?.parent_id != null) {
    const parent = byId.get(cursor.parent_id)
    if (!parent || found.has(parent.unit_id)) break
    found.add(parent.unit_id)
    cursor = parent
  }
  return found
}

/** Units this one could be placed under: strictly higher echelon, and never
 *  itself or anything already below it. */
export function validParents(units: OrbatUnit[], unit: OrbatUnit): OrbatUnit[] {
  const below = descendants(units, unit.unit_id)
  return units.filter(
    (candidate) =>
      candidate.unit_id !== unit.unit_id &&
      !below.has(candidate.unit_id) &&
      ECHELON_DEPTH[candidate.echelon] < ECHELON_DEPTH[unit.echelon],
  )
}

/** Every unit made unavailable by committing this one — down, because a
 *  platoon takes its sections with it, and up, because a platoon missing a
 *  section is no longer a platoon to commit. */
export function commitsWith(units: OrbatUnit[], unitId: string): Set<string> {
  return new Set([unitId, ...descendants(units, unitId), ...ancestors(units, unitId)])
}

export function availabilitySummary(units: OrbatUnit[]): {
  total: number
  uncommitted: number
  committed: number
  reserve: number
} {
  return {
    total: units.length,
    uncommitted: units.filter((unit) => unit.availability === 'uncommitted').length,
    committed: units.filter((unit) => unit.availability === 'committed').length,
    reserve: units.filter((unit) => unit.availability === 'reserve').length,
  }
}

/** A name for a newly stamped unit that reads like a force list rather than a
 *  uuid: "3 Platoon", "4 Section". */
export function nextUnitName(units: OrbatUnit[], echelon: Echelon): string {
  const count = units.filter((unit) => unit.echelon === echelon).length
  return `${count + 1} ${ECHELON_LABEL[echelon]}`
}
