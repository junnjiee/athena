import { TERRAIN_CLASS } from '../types'

const C = TERRAIN_CLASS

/** Effective occluder height added on top of ground elevation per terrain class.
 *  This is what makes LOS tactical rather than topographic: sightlines break on
 *  vegetation and structures, not just landform. Buildings use a conservative
 *  default because per-cell structure height isn't carried in the grid. */
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
export const DEFAULT_TARGET_HEIGHT_M = 1.7

/** Minimal grid view the LOS engine needs — matches GridChannels field names so
 *  callers can pass channels straight in. */
export interface LosTerrain {
  width: number
  height: number
  cellMeters: number
  /** row-major ground elevation, meters */
  elevation: Float32Array
  /** row-major TERRAIN_CLASS ids */
  cls: Uint8Array
}

export interface Observer {
  col: number
  row: number
  /** eye height above local ground, meters */
  eyeHeightM?: number
}

export interface ViewshedOptions {
  /** standing-soldier head height at the target cell */
  targetHeightM?: number
  /** cells beyond this ground distance are never visible (0 = unlimited) */
  maxRangeM?: number
}

function occluderTop(terrain: LosTerrain, i: number): number {
  return terrain.elevation[i] + (OCCLUDER_HEIGHT_M[terrain.cls[i]] ?? 0)
}

/** March one ray from the observer to (endCol, endRow) with a DDA line walk,
 *  marking every cell whose standing-target head clears the accumulated max
 *  sightline slope. R2-style: a cell is visible if ANY ray sees it. */
function marchRay(
  terrain: LosTerrain,
  visible: Uint8Array,
  obsCol: number,
  obsRow: number,
  eyeAbs: number,
  endCol: number,
  endRow: number,
  targetHeightM: number,
  maxRangeCells: number,
): void {
  const dc = endCol - obsCol
  const dr = endRow - obsRow
  const steps = Math.max(Math.abs(dc), Math.abs(dr))
  if (steps === 0) return
  const stepC = dc / steps
  const stepR = dr / steps

  let maxSlope = -Infinity
  const limit = maxRangeCells > 0 ? Math.min(steps, maxRangeCells) : steps
  for (let k = 1; k <= limit; k++) {
    const col = Math.round(obsCol + stepC * k)
    const row = Math.round(obsRow + stepR * k)
    if (col < 0 || col >= terrain.width || row < 0 || row >= terrain.height) return
    const i = row * terrain.width + col
    // distance in cell units is fine: slopes are only ever compared to each other
    const dist = Math.hypot(col - obsCol, row - obsRow)

    // Can we see a standing soldier's head here? Checked BEFORE this cell's own
    // occluder is accumulated — canopy conceals what's behind it, not the tree
    // line itself.
    const targetSlope = (terrain.elevation[i] + targetHeightM - eyeAbs) / dist
    if (targetSlope >= maxSlope) visible[i] = 1

    const occluderSlope = (occluderTop(terrain, i) - eyeAbs) / dist
    if (occluderSlope > maxSlope) maxSlope = occluderSlope
  }
}

/** Single-observer viewshed via radial sweep to every perimeter cell. Returns a
 *  0/1 mask the size of the grid. ~O(perimeter · radius) — sub-10 ms on 288²
 *  grids, so callers can afford one per enemy unit. */
export function computeViewshed(
  terrain: LosTerrain,
  observer: Observer,
  options: ViewshedOptions = {},
): Uint8Array {
  const { width, height } = terrain
  const visible = new Uint8Array(width * height)
  const obsCol = Math.max(0, Math.min(width - 1, Math.round(observer.col)))
  const obsRow = Math.max(0, Math.min(height - 1, Math.round(observer.row)))
  const eyeAbs =
    terrain.elevation[obsRow * width + obsCol] + (observer.eyeHeightM ?? DEFAULT_EYE_HEIGHT_M)
  const targetHeightM = options.targetHeightM ?? DEFAULT_TARGET_HEIGHT_M
  const maxRangeCells = options.maxRangeM ? Math.ceil(options.maxRangeM / terrain.cellMeters) : 0

  visible[obsRow * width + obsCol] = 1
  for (let col = 0; col < width; col++) {
    marchRay(terrain, visible, obsCol, obsRow, eyeAbs, col, 0, targetHeightM, maxRangeCells)
    marchRay(terrain, visible, obsCol, obsRow, eyeAbs, col, height - 1, targetHeightM, maxRangeCells)
  }
  for (let row = 1; row < height - 1; row++) {
    marchRay(terrain, visible, obsCol, obsRow, eyeAbs, 0, row, targetHeightM, maxRangeCells)
    marchRay(terrain, visible, obsCol, obsRow, eyeAbs, width - 1, row, targetHeightM, maxRangeCells)
  }
  return visible
}

/** Cumulative multi-observer viewshed: per cell, the share of observers that can
 *  see it, normalized 0-100. This is the "seen-by-enemy" danger field that the
 *  validator and the A* router consume. */
export function computeDangerField(
  terrain: LosTerrain,
  observers: Observer[],
  options: ViewshedOptions = {},
): Uint8Array {
  const n = terrain.width * terrain.height
  const danger = new Uint8Array(n)
  if (observers.length === 0) return danger

  const counts = new Uint16Array(n)
  for (const observer of observers) {
    const seen = computeViewshed(terrain, observer, options)
    for (let i = 0; i < n; i++) counts[i] += seen[i]
  }
  for (let i = 0; i < n; i++) {
    danger[i] = Math.round((counts[i] / observers.length) * 100)
  }
  return danger
}
