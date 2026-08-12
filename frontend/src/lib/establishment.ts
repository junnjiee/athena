import type { PlacedUnit, SymbolKind } from '../types/entities'

/**
 * How many soldiers a drawn plan actually fields.
 *
 * Mirrors `soldiersFor` in `server/src/services/simulationPayload.ts`, which is
 * the authority — this exists only so the run dialog can price a batch before
 * submitting it. The server returns the real count on the way back, and that is
 * the number displayed once a run is under way.
 */

/** Trenches are ground, not troops, so they carry no ORBAT establishment. */
const FORTIFICATION_SYMBOLS: ReadonlySet<SymbolKind> = new Set<SymbolKind>([
  'trench',
  'preparedTrench',
])

export function soldiersFor(unit: PlacedUnit): number {
  if (FORTIFICATION_SYMBOLS.has(unit.symbolKind)) return 1
  return Math.max(1, Math.round(unit.strength ?? 1))
}

export function countSoldiers(units: readonly PlacedUnit[]): number {
  return units.reduce((total, unit) => total + soldiersFor(unit), 0)
}

/** Soldiers per side, for the "who is fighting whom" line in the run dialog. */
export function soldiersBySide(units: readonly PlacedUnit[]): { blue: number; red: number } {
  return units.reduce(
    (totals, unit) => ({
      ...totals,
      [unit.side]: totals[unit.side] + soldiersFor(unit),
    }),
    { blue: 0, red: 0 },
  )
}
