import { gzipSync } from 'node:zlib'
import { unpackGrid } from './grid'
import { cellAt, cellsWithinRadius } from '../lib/cells'
import { TERRAIN_CLASS_NAMES } from '../types'
import type { BBox } from '../types'
import type {
  ForceSide,
  LonLat,
  MovementType,
  PlacedObjective,
  PlacedRoute,
  PlacedUnit,
  SymbolKind,
} from '../db/planTypes'

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
  /** The marker-and-section this soldier belongs to, and whether it is the one
   *  making decisions for it. Only commanders cost a model call; the rest run
   *  the engine's section policy, which is what makes a batch affordable. */
  sectionId?: string
  commander?: boolean
  /** Establishment vision range in metres. Cells are one metre, so the engine
   *  reads it as cells. Without it every soldier ran on the flat 10 m default,
   *  which made a Recon Section indistinguishable from a rifle section. */
  visionRangeM?: number
  /** The movement arrow drawn from this marker, as drawn. The engine projects
   *  it to cells and hands it to the agent as an axis of advance — without it a
   *  drawn route is decoration, because a soldier's only other steer is the
   *  compass default (`DEFAULT_TEAM_OBJECTIVES`). */
  route?: LonLat[]
  /** Gait the arrow carried. Sets the soldier's per-tick movement allowance in
   *  the engine (prowl 2, patrol 5, charge 8 units of terrain cost), and is
   *  restated to the agent as guidance on how to use it. */
  movementType?: MovementType
}

export interface EnginePayloadObjective {
  id: string
  name: string
  description: string
  position: LonLat
  radiusMeters: number
  /** Which side is tasked with it. The owner is told to take and hold it, the
   *  other side to deny it. Absent means contested — both are told it is
   *  theirs, which is how plans drawn before objectives had a side behave. */
  side?: ForceSide
}

/** One cell whose terrain class the plan replaces. */
export interface EngineTerrainOverride {
  index: number
  cls: number
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
    /** Ground the commander made rather than ground the classifier found —
     *  today that means field works. Kept out of the `cls` grid so the class
     *  numbering stays a straight contract with the terrain pipeline. */
    overrides?: EngineTerrainOverride[]
  }
  units: EnginePayloadUnit[]
  objectives: EnginePayloadObjective[]
  /** Daylight over the ground at H-hour. Omitted when the plan sets no mission
   *  start, which the engine simulates as daytime. */
  isDay?: boolean
}

export interface SimulationPayloadInput {
  battleground: {
    bbox: BBox
    gridBuffer: Buffer
    /** Daylight at the battleground's own coordinates, from the stored
     *  forecast. Null when the pipeline recorded no weather. */
    isDay?: boolean | null
  }
  plan: {
    units: PlacedUnit[]
    objectives: PlacedObjective[]
    routes: PlacedRoute[]
  }
}

/**
 * Soldiers per section, and therefore soldiers per model call.
 *
 * A rifle section is seven men under one commander, and a platoon is three of
 * them — so a 21-man platoon marker becomes three sections, not one commander
 * directing twenty individuals. Every soldier being an agent is what made a
 * batch cost `soldiers x ticks x runs` model calls; this divides that by seven.
 */
const SECTION_SIZE = 7

/** Cells a fortification marker digs in, as a radius around where it was drawn.
 *  A trench is a position rather than a point, and the engine can only raise a
 *  cell's protection if it is told which cells the works cover. */
const TRENCH_RADIUS_METERS = 4

/** Engine-side terrain class for a field work. Not in the terrain pipeline's
 *  `TERRAIN_CLASS`, because the classifier reads imagery and a trench is drawn:
 *  it travels as an override rather than inside the class grid. */
const TRENCH_CLASS = 10

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
function expandUnit(unit: PlacedUnit, route: PlacedRoute | undefined): EnginePayloadUnit[] {
  const count = soldiersFor(unit)
  // Every man expanded from a marker inherits the marker's route and its
  // establishment's vision: both were drawn for the unit, not for one soldier.
  const base = {
    side: unit.side,
    position: unit.position,
    ...(unit.visionRangeM ? { visionRangeM: unit.visionRangeM } : {}),
    ...(route ? { route: route.points, movementType: route.movementType } : {}),
  }

  if (count === 1) {
    return [{ id: unit.id, name: unit.name, sectionId: unit.id, commander: true, ...base }]
  }

  return Array.from({ length: count }, (_, index) => {
    const section = Math.floor(index / SECTION_SIZE)
    return {
      id: `${unit.id}:${index + 1}`,
      name: `${unit.name} ${index + 1}`,
      sectionId: `${unit.id}#${section + 1}`,
      // The first man of each section carries it. Everyone else follows.
      commander: index % SECTION_SIZE === 0,
      ...base,
    }
  })
}

/** Soldiers whose decisions cost a model call — the number that actually prices
 *  a batch, now that the rest run the engine's section policy. */
export function countAgents(units: readonly PlacedUnit[]): number {
  return units.reduce(
    (total, unit) => total + Math.ceil(soldiersFor(unit) / SECTION_SIZE),
    0,
  )
}

/** A drawn arrow belongs to the marker it starts from. One route per unit: the
 *  toolbar draws a single axis per marker, and a soldier told to follow two
 *  contradictory paths is worse than one told to follow none. */
function routesByUnit(routes: readonly PlacedRoute[]): Map<string, PlacedRoute> {
  const byUnit = new Map<string, PlacedRoute>()
  for (const route of routes) {
    if (route.points.length > 1 && !byUnit.has(route.startUnitId)) {
      byUnit.set(route.startUnitId, route)
    }
  }
  return byUnit
}

/** Metres, two decimals. The engine quantizes elevation to integer levels on
 *  load, so the extra Float32 digits are noise that would multiply the JSON
 *  size of a 640k-cell grid several times over for nothing. */
const round2 = (n: number) => Math.round(n * 100) / 100

/** Trench markers as per-cell terrain overrides. */
function trenchOverrides(
  units: readonly PlacedUnit[],
  geo: { bbox: BBox; width: number; height: number; cellMeters: number },
): EngineTerrainOverride[] {
  const seen = new Set<number>()
  for (const unit of units) {
    if (!FORTIFICATION_SYMBOLS.has(unit.symbolKind)) continue

    // The cell it was drawn on always counts. `cellsWithinRadius` tests cell
    // centres, so a radius smaller than a cell selects nothing at all — which
    // would silently turn a drawn trench back into no works whatsoever.
    const origin = cellAt(geo, unit.position.longitude, unit.position.latitude)
    if (origin) seen.add(origin.index)

    for (const cell of cellsWithinRadius(geo, unit.position, TRENCH_RADIUS_METERS)) {
      seen.add(cell.index)
    }
  }
  return Array.from(seen, (index) => ({ index, cls: TRENCH_CLASS }))
}

export function buildSimulationPayload({
  battleground,
  plan,
}: SimulationPayloadInput): EnginePayload {
  const { width, height, cellMeters, channels } = unpackGrid(battleground.gridBuffer)
  const routes = routesByUnit(plan.routes)
  const overrides = trenchOverrides(plan.units, {
    bbox: battleground.bbox,
    width,
    height,
    cellMeters,
  })

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
      ...(overrides.length > 0 ? { overrides } : {}),
    },
    ...(battleground.isDay == null ? {} : { isDay: battleground.isDay }),
    units: plan.units.flatMap((unit) => expandUnit(unit, routes.get(unit.id))),
    objectives: plan.objectives.map((objective) => ({
      id: objective.id,
      name: objective.name,
      description: objective.description,
      position: objective.position,
      radiusMeters: objective.radiusMeters,
      ...(objective.side ? { side: objective.side } : {}),
    })),
  }
}

/** Gzipped JSON. The engine sniffs the gzip magic bytes rather than trusting a
 *  filename, and a raw grid this size is mostly repeated digits, so compressing
 *  is close to free and cuts the upload by an order of magnitude. */
export function encodeSimulationPayload(payload: EnginePayload): Buffer {
  return gzipSync(Buffer.from(JSON.stringify(payload), 'utf8'))
}
