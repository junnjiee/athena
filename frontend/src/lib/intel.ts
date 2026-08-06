import { TERRAIN_CLASS, TERRAIN_CLASS_NAMES, type GridData } from '../types/terrain'
import { cellIndexAt } from './grid'
import type { LonLat } from '../types/entities'

/**
 * Terrain intelligence derived from the simulation grid.
 *
 * Athena computes a lot of information it never surfaced *as intelligence* —
 * the cover/concealment/visibility channels only ever drove heatmap drapes, and
 * the reasoning panel narrated pipeline progress rather than saying anything
 * about the ground once the pipeline finished (#56).
 *
 * Everything here is pure over a decoded grid so it can be tested without a
 * canvas, and so the voice assistant can read the same numbers the page shows.
 */

export interface ClassShare {
  cls: number
  name: string
  cells: number
  /** 0–100, share of the battlefield */
  percent: number
}

export interface TerrainBrief {
  cellCount: number
  areaKm2: number
  elevation: { min: number; max: number; relief: number }
  meanSlopeDeg: number
  /** land-cover breakdown, largest share first */
  composition: ClassShare[]
  /** 0–100 means across the whole battlefield */
  meanCover: number
  meanConcealment: number
  meanExposure: number
  /** share of the field a vehicle can cross at all, 0–100 */
  vehicleGoingPercent: number
  /** share of the field that is water, 0–100 — the hard obstacle */
  waterPercent: number
  /** plain-sentence assessments, ordered most significant first */
  observations: string[]
}

const pct = (n: number, total: number) => (total === 0 ? 0 : (n / total) * 100)
const round1 = (n: number) => Math.round(n * 10) / 10

/** Vehicle mobility at or below this is effectively impassable to vehicles. */
const VEHICLE_IMPASSABLE = 15
/** Visibility at or above this counts as dangerously exposed ground. */
const EXPOSED = 65

export function buildTerrainBrief(grid: GridData): TerrainBrief {
  const n = grid.width * grid.height

  let minElevation = Infinity
  let maxElevation = -Infinity
  let slopeSum = 0
  let coverSum = 0
  let concealSum = 0
  let exposureSum = 0
  let vehicleGoing = 0
  const classCells = new Map<number, number>()

  for (let i = 0; i < n; i++) {
    const e = grid.elevation[i]
    if (e < minElevation) minElevation = e
    if (e > maxElevation) maxElevation = e
    slopeSum += grid.slope[i]
    coverSum += grid.cover[i]
    concealSum += grid.concealment[i]
    exposureSum += grid.visibility[i]
    if (grid.vehicleMobility[i] > VEHICLE_IMPASSABLE) vehicleGoing++
    classCells.set(grid.cls[i], (classCells.get(grid.cls[i]) ?? 0) + 1)
  }

  const composition: ClassShare[] = [...classCells.entries()]
    .map(([cls, cells]) => ({
      cls,
      name: TERRAIN_CLASS_NAMES[cls] ?? 'Unknown',
      cells,
      percent: round1(pct(cells, n)),
    }))
    .sort((a, b) => b.cells - a.cells)

  const waterPercent = round1(pct(classCells.get(TERRAIN_CLASS.WATER) ?? 0, n))
  const areaM2 = n * grid.cellMeters * grid.cellMeters

  const brief: TerrainBrief = {
    cellCount: n,
    areaKm2: round1(areaM2 / 1_000_000),
    elevation: {
      min: round1(minElevation),
      max: round1(maxElevation),
      relief: round1(maxElevation - minElevation),
    },
    meanSlopeDeg: round1(slopeSum / n),
    composition,
    meanCover: round1(coverSum / n),
    meanConcealment: round1(concealSum / n),
    meanExposure: round1(exposureSum / n),
    vehicleGoingPercent: round1(pct(vehicleGoing, n)),
    waterPercent,
    observations: [],
  }

  return { ...brief, observations: assess(brief) }
}

/** Turns the numbers into sentences a commander would actually say. Ordered by
 *  how much each would change a plan. */
function assess(b: TerrainBrief): string[] {
  const out: string[] = []
  const dominant = b.composition[0]

  if (dominant && dominant.percent >= 60) {
    out.push(`${dominant.name} dominates the ground at ${dominant.percent}% of the battlefield.`)
  } else if (dominant) {
    const second = b.composition[1]
    out.push(
      second
        ? `Mixed ground — ${dominant.name} ${dominant.percent}%, ${second.name} ${second.percent}%.`
        : `${dominant.name} covers ${dominant.percent}% of the battlefield.`,
    )
  }

  if (b.elevation.relief >= 60) {
    out.push(
      `Strong relief: ${b.elevation.relief} m between low and high ground — expect dead ground and defilade.`,
    )
  } else if (b.elevation.relief <= 10) {
    out.push(`Essentially flat (${b.elevation.relief} m of relief) — little natural defilade.`)
  }

  if (b.meanSlopeDeg >= 15) {
    out.push(`Steep going overall (mean ${b.meanSlopeDeg}°); movement will cost well above map distance.`)
  }

  if (b.waterPercent >= 5) {
    out.push(`Water covers ${b.waterPercent}% of the field — check crossings before committing.`)
  }

  if (b.meanConcealment >= 65) {
    out.push(`High concealment (${b.meanConcealment}/100): approach is favoured, observation is not.`)
  } else if (b.meanExposure >= EXPOSED) {
    out.push(`Exposed ground (mean visibility ${b.meanExposure}/100) — movement will be seen.`)
  }

  if (b.vehicleGoingPercent <= 25) {
    out.push(`Vehicle going is poor: only ${b.vehicleGoingPercent}% of the field is trafficable.`)
  }

  return out
}

// ---------------------------------------------------------------------------
// Viewshed
// ---------------------------------------------------------------------------

export interface ViewshedResult {
  /** one byte per cell: 1 visible, 0 not */
  visible: Uint8Array
  visibleCells: number
  /** 0–100 share of cells within range that are visible */
  coveragePercent: number
  /** observer cell, or null when the point is off-grid */
  origin: { x: number; y: number } | null
  rangeMeters: number
}

/** Eye height above ground for a standing observer, metres. */
const OBSERVER_HEIGHT_M = 1.7
/** Target height — a soldier is visible if any part of them clears the terrain. */
const TARGET_HEIGHT_M = 1.7

/**
 * Line-of-sight from a point, by ray-marching the elevation model.
 *
 * For each cell within range, walks the straight line from observer to target
 * and checks whether terrain along the way rises above the sight line. This is
 * the standard rising-angle test: a target is visible when nothing between it
 * and the observer subtends a greater vertical angle.
 *
 * Ignores vegetation and buildings — only bare-earth elevation. Cover from
 * canopy is what the concealment channel is for, and mixing them here would
 * hide which effect produced the result.
 */
export function computeViewshed(
  grid: GridData,
  from: LonLat,
  rangeMeters: number,
): ViewshedResult {
  const { width, height, cellMeters } = grid
  const visible = new Uint8Array(width * height)
  const originIndex = cellIndexAt(grid, from.longitude, from.latitude)

  if (originIndex < 0) {
    return { visible, visibleCells: 0, coveragePercent: 0, origin: null, rangeMeters }
  }

  const ox = originIndex % width
  const oy = Math.floor(originIndex / width)
  const eye = grid.elevation[originIndex] + OBSERVER_HEIGHT_M
  const rangeCells = Math.max(1, Math.floor(rangeMeters / cellMeters))

  let inRange = 0
  let seen = 0

  const x0 = Math.max(0, ox - rangeCells)
  const x1 = Math.min(width - 1, ox + rangeCells)
  const y0 = Math.max(0, oy - rangeCells)
  const y1 = Math.min(height - 1, oy + rangeCells)

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - ox
      const dy = y - oy
      const distCells = Math.hypot(dx, dy)
      if (distCells > rangeCells) continue

      inRange++
      const target = y * width + x

      if (distCells < 1) {
        visible[target] = 1
        seen++
        continue
      }

      // March the sight line, tracking the steepest angle terrain has reached.
      // The target is visible if it clears that angle.
      const steps = Math.ceil(distCells)
      let maxAngle = -Infinity

      for (let s = 1; s < steps; s++) {
        const t = s / steps
        const sx = Math.round(ox + dx * t)
        const sy = Math.round(oy + dy * t)
        const groundM = grid.elevation[sy * width + sx]
        const alongM = distCells * t * cellMeters
        if (alongM === 0) continue
        const angle = (groundM - eye) / alongM
        if (angle > maxAngle) maxAngle = angle
      }

      const targetAngle =
        (grid.elevation[target] + TARGET_HEIGHT_M - eye) / (distCells * cellMeters)

      if (maxAngle <= targetAngle) {
        visible[target] = 1
        seen++
      }
    }
  }

  return {
    visible,
    visibleCells: seen,
    coveragePercent: round1(pct(seen, inRange)),
    origin: { x: ox, y: oy },
    rangeMeters,
  }
}
