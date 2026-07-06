import { TERRAIN_CLASS, type GridData } from '../types/terrain'

/** Client-side mirror of server/src/services/los.ts (kept in sync by hand — the
 *  packages don't share code). Used by the Web Worker that computes a friendly
 *  unit's live viewshed without a server round-trip. */

const C = TERRAIN_CLASS

export const OCCLUDER_HEIGHT_M: Record<number, number> = {
  [C.OPEN]: 0,
  [C.GRASS]: 0.3,
  [C.SCRUB]: 2.5,
  [C.FOREST]: 12,
  [C.WETLAND]: 0.5,
  [C.WATER]: 0,
  [C.URBAN]: 4,
  [C.BUILDING]: 10,
  [C.ROAD]: 0,
  [C.BARREN]: 0,
}

export const DEFAULT_EYE_HEIGHT_M = 1.7

export interface LosTerrain {
  width: number
  height: number
  cellMeters: number
  elevation: Float32Array
  cls: Uint8Array
}

export interface Observer {
  col: number
  row: number
  eyeHeightM?: number
}

export function terrainFromGrid(grid: GridData): LosTerrain {
  return {
    width: grid.width,
    height: grid.height,
    cellMeters: grid.cellMeters,
    elevation: grid.elevation,
    cls: grid.cls,
  }
}

function occluderTop(terrain: LosTerrain, i: number): number {
  return terrain.elevation[i] + (OCCLUDER_HEIGHT_M[terrain.cls[i]] ?? 0)
}

function marchRay(
  terrain: LosTerrain,
  visible: Uint8Array,
  obsCol: number,
  obsRow: number,
  eyeAbs: number,
  endCol: number,
  endRow: number,
  targetHeightM: number,
): void {
  const dc = endCol - obsCol
  const dr = endRow - obsRow
  const steps = Math.max(Math.abs(dc), Math.abs(dr))
  if (steps === 0) return
  const stepC = dc / steps
  const stepR = dr / steps

  let maxSlope = -Infinity
  for (let k = 1; k <= steps; k++) {
    const col = Math.round(obsCol + stepC * k)
    const row = Math.round(obsRow + stepR * k)
    if (col < 0 || col >= terrain.width || row < 0 || row >= terrain.height) return
    const i = row * terrain.width + col
    const dist = Math.hypot(col - obsCol, row - obsRow)

    const targetSlope = (terrain.elevation[i] + targetHeightM - eyeAbs) / dist
    if (targetSlope >= maxSlope) visible[i] = 1

    const occluderSlope = (occluderTop(terrain, i) - eyeAbs) / dist
    if (occluderSlope > maxSlope) maxSlope = occluderSlope
  }
}

/** Single-observer viewshed (radial sweep, R2 approximation): 0/1 mask over the grid. */
export function computeViewshed(terrain: LosTerrain, observer: Observer, targetHeightM = 1.7): Uint8Array {
  const { width, height } = terrain
  const visible = new Uint8Array(width * height)
  const obsCol = Math.max(0, Math.min(width - 1, Math.round(observer.col)))
  const obsRow = Math.max(0, Math.min(height - 1, Math.round(observer.row)))
  const eyeAbs =
    terrain.elevation[obsRow * width + obsCol] + (observer.eyeHeightM ?? DEFAULT_EYE_HEIGHT_M)

  visible[obsRow * width + obsCol] = 1
  for (let col = 0; col < width; col++) {
    marchRay(terrain, visible, obsCol, obsRow, eyeAbs, col, 0, targetHeightM)
    marchRay(terrain, visible, obsCol, obsRow, eyeAbs, col, height - 1, targetHeightM)
  }
  for (let row = 1; row < height - 1; row++) {
    marchRay(terrain, visible, obsCol, obsRow, eyeAbs, 0, row, targetHeightM)
    marchRay(terrain, visible, obsCol, obsRow, eyeAbs, width - 1, row, targetHeightM)
  }
  return visible
}
