import { estimateMovement } from './movement'
import { TERRAIN_CLASS_NAMES } from '../types/terrain'
import type { BattlegroundMeta, BBoxDeg, GridData, Weather } from '../types/terrain'
import type {
  ForceSide,
  LonLat,
  PlacedObjective,
  PlacedRoute,
  PlacedUnit,
  RouteEndpointRef,
  SymbolKind,
} from '../types/entities'
import type { MovementEstimate, MovementLoadout, MovementType } from '../types/movement'

/** Draft input contract for the (not-yet-built) Monte Carlo engine -- shaped to
 *  be plausible, not exact, since the engine's real API doesn't exist yet. */
export interface SimulationExport {
  generatedAt: string
  battleground: {
    id: string
    name: string
    bbox: BBoxDeg
    width: number
    height: number
    cellMeters: number
    widthMeters: number
    heightMeters: number
    weather: Weather | null
  }
  terrain: {
    bbox: BBoxDeg
    width: number
    height: number
    cellMeters: number
    widthMeters: number
    heightMeters: number
    /** cls code -> human-readable terrain class name */
    classNames: Record<number, string>
    /** row-major, row 0 = northernmost -- same layout as the decoded GridData channels */
    cells: {
      elevation: number[]
      cls: number[]
    }
  } | null
  units: Array<{
    id: string
    side: ForceSide
    name: string
    typeLabel: string
    position: LonLat
    symbolKind: SymbolKind
    rotationRadians: number
  }>
  objectives: Array<{
    id: string
    name: string
    description: string
    position: LonLat
    radiusMeters: number
  }>
  routes: Array<{
    id: string
    side: ForceSide
    startUnitId: string
    endRef: RouteEndpointRef | null
    points: LonLat[]
    movementType: MovementType
    loadout: MovementLoadout
    estimate: MovementEstimate
  }>
}

export interface SimulationExportInput {
  meta: BattlegroundMeta | null
  grid: GridData | null
  units: PlacedUnit[]
  objectives: PlacedObjective[]
  routes: PlacedRoute[]
}

export function buildSimulationExport({
  meta,
  grid,
  units,
  objectives,
  routes,
}: SimulationExportInput): SimulationExport {
  const weather = meta?.weather ?? null

  return {
    generatedAt: new Date().toISOString(),
    battleground: {
      id: meta?.id ?? '',
      name: meta?.name ?? '',
      bbox: meta?.bbox ?? { west: 0, south: 0, east: 0, north: 0 },
      width: meta?.width ?? 0,
      height: meta?.height ?? 0,
      cellMeters: meta?.cellMeters ?? 0,
      widthMeters: (meta?.width ?? 0) * (meta?.cellMeters ?? 0),
      heightMeters: (meta?.height ?? 0) * (meta?.cellMeters ?? 0),
      weather,
    },
    terrain: grid
      ? {
          bbox: grid.bbox,
          width: grid.width,
          height: grid.height,
          cellMeters: grid.cellMeters,
          widthMeters: grid.width * grid.cellMeters,
          heightMeters: grid.height * grid.cellMeters,
          classNames: TERRAIN_CLASS_NAMES,
          cells: {
            elevation: Array.from(grid.elevation),
            cls: Array.from(grid.cls),
          },
        }
      : null,
    units: units.map((u) => ({
      id: u.id,
      side: u.side,
      name: u.name,
      typeLabel: u.typeLabel,
      position: u.position,
      symbolKind: u.symbolKind,
      rotationRadians: u.rotationRadians,
    })),
    objectives: objectives.map((o) => ({
      id: o.id,
      name: o.name,
      description: o.description,
      position: o.position,
      radiusMeters: o.radiusMeters,
    })),
    routes: routes.map((r) => ({
      id: r.id,
      side: r.side,
      startUnitId: r.startUnitId,
      endRef: r.endRef,
      points: r.points,
      movementType: r.movementType,
      loadout: r.loadout,
      estimate: estimateMovement(r.points, r.movementType, r.loadout, grid, weather),
    })),
  }
}
