import { gzipSync } from 'node:zlib'
import { unpackGrid } from './grid'
import { TERRAIN_CLASS_NAMES } from '../types'
import type { BBox } from '../types'
import type { ForceSide, LonLat, PlacedObjective, PlacedUnit, SymbolKind } from '../db/planTypes'

/**
 * The scenario the simulation engine actually runs.
 *
 * The engine names a scenario one of two ways: a plan id it pulls back over
 * HTTP, or an uploaded payload file. We upload, because the pull path can only
 * carry what `GET /api/plans/:id` already returns — one entry per drawn marker —
 * and a marker is an *establishment*, not a soldier. A platoon of 21 has to
 * reach the engine as 21 agents, and expanding it is something only this side
 * can do without changing the engine.
 *
 * That is not a second representation of the battleground: the terrain here is
 * decoded from the same stored `gridBuffer` the web app renders, so the bytes
 * still have one source. Only the laydown is derived.
 *
 * Shape mirrors `TerrainPayload` in `engine/athena/loaders/terrain_payload.py`.
 * Field names are camelCase because that loader camel-cases every field through
 * its alias generator, and `cls` is the alias it gives the class grid.
 */

export interface EnginePayloadUnit {
  id: string
  side: ForceSide
  name: string
  position: LonLat
}

export interface EnginePayloadObjective {
  id: string
  name: string
  description: string
  position: LonLat
  radiusMeters: number
}

export interface EnginePayload {
  terrain: {
    bbox: BBox
    width: number
    height: number
    cellMeters: number
    /** cls code → human-readable name. The engine asserts these against its own
     *  `TerrainClass`, which turns a renumbering on either side into a loud 422
     *  instead of forest silently loading as something else. */
    classNames: Record<number, string>
    /** row-major, row 0 = northernmost — the packed grid's own layout */
    cells: {
      elevation: number[]
      cls: number[]
    }
  }
  units: EnginePayloadUnit[]
  objectives: EnginePayloadObjective[]
}

export interface SimulationPayloadInput {
  battleground: {
    bbox: BBox
    gridBuffer: Buffer
  }
  plan: {
    units: PlacedUnit[]
    objectives: PlacedObjective[]
  }
}

/** Trenches are ground, not troops — they carry no ORBAT establishment. */
const FORTIFICATION_SYMBOLS: ReadonlySet<SymbolKind> = new Set<SymbolKind>([
  'trench',
  'preparedTrench',
])

/**
 * How many soldiers one marker contributes.
 *
 * A fortification is a position rather than an establishment, so it contributes
 * the single soldier holding it — the engine has no way to represent the works
 * themselves, so a trench that spawned nobody would just be a gap in the line.
 * Everything else contributes its ORBAT strength, defaulting to one for plans
 * drawn before unit templates existed.
 */
export function soldiersFor(unit: PlacedUnit): number {
  if (FORTIFICATION_SYMBOLS.has(unit.symbolKind)) return 1
  return Math.max(1, Math.round(unit.strength ?? 1))
}

export function countSoldiers(units: readonly PlacedUnit[]): number {
  return units.reduce((total, unit) => total + soldiersFor(unit), 0)
}

/**
 * One marker → one soldier per man on its establishment.
 *
 * Every soldier is emitted at the marker's exact position. The engine resolves
 * each onto the nearest free passable cell by spiralling outward from there
 * (`_place`), so a 21-man platoon lands as a blob around where it was drawn
 * rather than stacked in one cell. Single-soldier markers keep their original
 * id and name so the laydown reads the same as the drawing.
 */
function expandUnit(unit: PlacedUnit): EnginePayloadUnit[] {
  const count = soldiersFor(unit)
  const base = { side: unit.side, position: unit.position }

  if (count === 1) return [{ id: unit.id, name: unit.name, ...base }]

  return Array.from({ length: count }, (_, index) => ({
    id: `${unit.id}:${index + 1}`,
    name: `${unit.name} ${index + 1}`,
    ...base,
  }))
}

/** Metres, two decimals. The engine quantizes elevation to integer levels on
 *  load, so the extra Float32 digits are noise that would multiply the JSON
 *  size of a 640k-cell grid several times over for nothing. */
const round2 = (n: number) => Math.round(n * 100) / 100

export function buildSimulationPayload({
  battleground,
  plan,
}: SimulationPayloadInput): EnginePayload {
  const { width, height, cellMeters, channels } = unpackGrid(battleground.gridBuffer)

  return {
    terrain: {
      bbox: battleground.bbox,
      width,
      height,
      cellMeters,
      classNames: TERRAIN_CLASS_NAMES,
      cells: {
        elevation: Array.from(channels.height, round2),
        cls: Array.from(channels.cls),
      },
    },
    units: plan.units.flatMap(expandUnit),
    objectives: plan.objectives.map((objective) => ({
      id: objective.id,
      name: objective.name,
      description: objective.description,
      position: objective.position,
      radiusMeters: objective.radiusMeters,
    })),
  }
}

/** Gzipped JSON. The engine sniffs the gzip magic bytes rather than trusting a
 *  filename, and a raw grid this size is mostly repeated digits, so compressing
 *  is close to free and cuts the upload by an order of magnitude. */
export function encodeSimulationPayload(payload: EnginePayload): Buffer {
  return gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'))
}
