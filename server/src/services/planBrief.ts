import {
  cellAt,
  cellsWithinRadius,
  polylineLengthMeters,
  rasterizePolyline,
  type GridCell,
  type GridGeo,
} from '../lib/cells'
import { unpackGrid } from './grid'
import { TERRAIN_CLASS, TERRAIN_CLASS_NAMES } from '../types'
import type { BBox, GridChannels, Weather } from '../types'
import type {
  ForceSide,
  LonLat,
  MovementLoadout,
  MovementType,
  PlacedObjective,
  PlacedRoute,
  PlacedUnit,
  RouteEndpointRef,
  SymbolKind,
} from '../db/planTypes'

/**
 * "Drawn plan over the terrain" — the bridge payload for issue #26.
 *
 * A saved plan stores drawings as bare lon/lat, which tells a consumer nothing
 * about *what ground* each drawing sits on. This module answers both halves of
 * the question the engine actually asks:
 *
 *   - which part of the terrain is this drawing over?  → grid cells + per-cell
 *     military properties, in the same row-major cell space as the sim grid
 *   - what kind of drawing is it?                      → an explicit `kind` +
 *     `label` ("red deployment", "blue movement arrow", …)
 *
 * Everything here is derived; nothing is persisted. The grid is decoded from
 * the battleground's stored buffer on each request.
 */

export type DrawingKind = 'deployment' | 'fortification' | 'objective' | 'movement'

/** Force echelon a placed marker represents. Trenches are ground, not troops. */
export type Echelon = 'section' | 'platoon' | 'position'

/** Per-cell military properties, decoded from the packed grid channels. */
export interface CellTerrain {
  elevationM: number
  slopeDeg: number
  cls: number
  clsName: string
  /** 0–100 */
  cover: number
  /** 0–100 */
  concealment: number
  /** unitless multiplier, 1.0 = clear ground walking pace */
  moveCostFactor: number
  /** how exposed a unit standing here is, 0–100 */
  visibility: number
  /** 0–100 */
  vehicleMobility: number
  /** 0–100 */
  ambush: number
}

export type PlacedCell = GridCell & { terrain: CellTerrain }

/** Aggregate of the ground a multi-cell drawing covers, so an agent prompt can
 *  describe a route or objective without replaying every cell. */
export interface TerrainSummary {
  cellCount: number
  meanCover: number
  meanConcealment: number
  meanVisibility: number
  meanMoveCostFactor: number
  minElevationM: number
  maxElevationM: number
  maxSlopeDeg: number
  crossesWater: boolean
  /** cell counts keyed by human-readable terrain class name */
  classCounts: Record<string, number>
  /** the class covering the most cells, or null when the drawing is off-grid */
  dominantClass: string | null
}

interface DrawingBase {
  id: string
  kind: DrawingKind
  /** operator-facing description, e.g. "blue platoon deployment" */
  label: string
}

export interface DeploymentDrawing extends DrawingBase {
  kind: 'deployment' | 'fortification'
  side: ForceSide
  name: string
  typeLabel: string
  echelon: Echelon
  position: LonLat
  /** facing, clockwise-from-north radians */
  facingRadians: number
  /** null when the marker was placed outside the battleground bbox */
  cell: PlacedCell | null
}

export interface ObjectiveDrawing extends DrawingBase {
  kind: 'objective'
  name: string
  description: string
  position: LonLat
  radiusMeters: number
  cell: PlacedCell | null
  footprintCells: GridCell[]
  footprint: TerrainSummary
}

export interface MovementDrawing extends DrawingBase {
  kind: 'movement'
  side: ForceSide
  startUnitId: string
  endRef: RouteEndpointRef | null
  movementType: MovementType
  loadout: MovementLoadout
  points: LonLat[]
  lengthMeters: number
  /** ordered cells the arrow crosses, start → end */
  path: PlacedCell[]
  corridor: TerrainSummary
}

export type Drawing = DeploymentDrawing | ObjectiveDrawing | MovementDrawing

export interface PlanBrief {
  planId: string
  planName: string
  generatedAt: string
  battleground: {
    id: string
    name: string
    bbox: BBox
    width: number
    height: number
    cellMeters: number
    widthMeters: number
    heightMeters: number
    weather: Weather | null
  }
  /** cell-space convention, spelled out for the engine-side consumer */
  cellSpace: {
    origin: 'north-west'
    order: 'row-major'
    description: string
  }
  drawings: Drawing[]
}

export interface PlanBriefInput {
  plan: {
    id: string
    name: string
    units: PlacedUnit[]
    objectives: PlacedObjective[]
    routes: PlacedRoute[]
  }
  battleground: {
    id: string
    name: string
    bbox: BBox
    width: number
    height: number
    cellMeters: number
    weather: Weather | null
    gridBuffer: Buffer
  }
}

const ECHELON_BY_SYMBOL: Record<SymbolKind, Echelon> = {
  blueSection: 'section',
  bluePlatoon: 'platoon',
  redSection: 'section',
  redPlatoon: 'platoon',
  trench: 'position',
  preparedTrench: 'position',
}

const FORTIFICATION_SYMBOLS: ReadonlySet<SymbolKind> = new Set<SymbolKind>(['trench', 'preparedTrench'])

const FORTIFICATION_LABELS: Partial<Record<SymbolKind, string>> = {
  trench: 'trench fortification',
  preparedTrench: 'prepared trench fortification',
}

function sampleCell(channels: GridChannels, cell: GridCell): PlacedCell {
  const i = cell.index
  const cls = channels.cls[i]
  return {
    ...cell,
    terrain: {
      elevationM: channels.height[i],
      slopeDeg: channels.slope[i],
      cls,
      clsName: TERRAIN_CLASS_NAMES[cls] ?? 'Unknown',
      cover: channels.cover[i],
      concealment: channels.concealment[i],
      moveCostFactor: channels.moveCost[i] / 20,
      visibility: channels.visibility[i],
      vehicleMobility: channels.vehicleMobility[i],
      ambush: channels.ambush[i],
    },
  }
}

const EMPTY_SUMMARY: TerrainSummary = {
  cellCount: 0,
  meanCover: 0,
  meanConcealment: 0,
  meanVisibility: 0,
  meanMoveCostFactor: 0,
  minElevationM: 0,
  maxElevationM: 0,
  maxSlopeDeg: 0,
  crossesWater: false,
  classCounts: {},
  dominantClass: null,
}

const round1 = (n: number) => Math.round(n * 10) / 10
const round2 = (n: number) => Math.round(n * 100) / 100

function summarize(channels: GridChannels, cells: readonly GridCell[]): TerrainSummary {
  if (cells.length === 0) return EMPTY_SUMMARY

  let cover = 0
  let concealment = 0
  let visibility = 0
  let moveCost = 0
  let minElevation = Infinity
  let maxElevation = -Infinity
  let maxSlope = 0
  let crossesWater = false
  const classCounts: Record<string, number> = {}

  for (const { index } of cells) {
    cover += channels.cover[index]
    concealment += channels.concealment[index]
    visibility += channels.visibility[index]
    moveCost += channels.moveCost[index] / 20
    const elevation = channels.height[index]
    if (elevation < minElevation) minElevation = elevation
    if (elevation > maxElevation) maxElevation = elevation
    if (channels.slope[index] > maxSlope) maxSlope = channels.slope[index]
    const cls = channels.cls[index]
    if (cls === TERRAIN_CLASS.WATER) crossesWater = true
    const name = TERRAIN_CLASS_NAMES[cls] ?? 'Unknown'
    classCounts[name] = (classCounts[name] ?? 0) + 1
  }

  const n = cells.length
  const dominantClass = Object.entries(classCounts).reduce<[string, number] | null>(
    (best, entry) => (best === null || entry[1] > best[1] ? entry : best),
    null,
  )

  return {
    cellCount: n,
    meanCover: round1(cover / n),
    meanConcealment: round1(concealment / n),
    meanVisibility: round1(visibility / n),
    meanMoveCostFactor: round2(moveCost / n),
    minElevationM: round1(minElevation),
    maxElevationM: round1(maxElevation),
    maxSlopeDeg: maxSlope,
    crossesWater,
    classCounts,
    dominantClass: dominantClass?.[0] ?? null,
  }
}

function unitDrawing(unit: PlacedUnit, geo: GridGeo, channels: GridChannels): DeploymentDrawing {
  const fortification = FORTIFICATION_SYMBOLS.has(unit.symbolKind)
  const echelon = ECHELON_BY_SYMBOL[unit.symbolKind]
  const cell = cellAt(geo, unit.position.longitude, unit.position.latitude)

  return {
    id: unit.id,
    kind: fortification ? 'fortification' : 'deployment',
    label: fortification
      ? (FORTIFICATION_LABELS[unit.symbolKind] ?? 'fortification')
      : `${unit.side} ${echelon} deployment`,
    side: unit.side,
    name: unit.name,
    typeLabel: unit.typeLabel,
    echelon,
    position: unit.position,
    facingRadians: unit.rotationRadians,
    cell: cell && sampleCell(channels, cell),
  }
}

function objectiveDrawing(
  objective: PlacedObjective,
  geo: GridGeo,
  channels: GridChannels,
): ObjectiveDrawing {
  const cell = cellAt(geo, objective.position.longitude, objective.position.latitude)
  const footprintCells = cellsWithinRadius(geo, objective.position, objective.radiusMeters)

  return {
    id: objective.id,
    kind: 'objective',
    label: 'objective',
    name: objective.name,
    description: objective.description,
    position: objective.position,
    radiusMeters: objective.radiusMeters,
    cell: cell && sampleCell(channels, cell),
    footprintCells,
    footprint: summarize(channels, footprintCells),
  }
}

function routeDrawing(route: PlacedRoute, geo: GridGeo, channels: GridChannels): MovementDrawing {
  const path = rasterizePolyline(geo, route.points)

  return {
    id: route.id,
    kind: 'movement',
    label: `${route.side} movement arrow (${route.movementType})`,
    side: route.side,
    startUnitId: route.startUnitId,
    endRef: route.endRef,
    movementType: route.movementType,
    loadout: route.loadout,
    points: route.points,
    lengthMeters: round1(polylineLengthMeters(route.points)),
    path: path.map((cell) => sampleCell(channels, cell)),
    corridor: summarize(channels, path),
  }
}

/** Georeferences every drawing in a saved plan onto the battleground's terrain
 *  grid and tags it with the kind of drawing it is. */
export function buildPlanBrief({ plan, battleground }: PlanBriefInput): PlanBrief {
  const { width, height, cellMeters, channels } = unpackGrid(battleground.gridBuffer)
  const geo: GridGeo = { bbox: battleground.bbox, width, height, cellMeters }

  return {
    planId: plan.id,
    planName: plan.name,
    generatedAt: new Date().toISOString(),
    battleground: {
      id: battleground.id,
      name: battleground.name,
      bbox: battleground.bbox,
      width,
      height,
      cellMeters,
      widthMeters: width * cellMeters,
      heightMeters: height * cellMeters,
      weather: battleground.weather,
    },
    cellSpace: {
      origin: 'north-west',
      order: 'row-major',
      description:
        'x = column west→east, y = row north→south, index = y * width + x; ' +
        'each cell is cellMeters square on the ground.',
    },
    drawings: [
      ...plan.units.map((unit) => unitDrawing(unit, geo, channels)),
      ...plan.objectives.map((objective) => objectiveDrawing(objective, geo, channels)),
      ...plan.routes.map((route) => routeDrawing(route, geo, channels)),
    ],
  }
}
