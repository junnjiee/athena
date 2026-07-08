import { cellIndexAt } from './grid'
import { TERRAIN_CLASS, type GridData, type Weather } from '../types/terrain'
import type { LonLat } from '../types/entities'
import {
  MOVEMENT_PROFILES,
  type MovementEstimate,
  type MovementLoadout,
  type MovementType,
} from '../types/movement'

/**
 * Transparent draw-time movement estimate. Pure, synchronous, testable.
 *
 * Speed model — Tobler's hiking function normalized to flat ground, so a gait's
 *   base speed is scaled by terrain grade (gentle downhill fastest, steep either
 *   way slowest). Uses tan(slope) as the gradient.
 * Energy model — Pandolf load-carriage equation (the military-standard metabolic
 *   cost of walking with load), with a terrain factor η per land-cover class and
 *   a Santee-style downhill discount. Multiplied by the gait's efficiency penalty.
 * Weather — scales speed and energy from the battlefield conditions.
 *
 * This is a preview, not physiology: the real per-soldier accumulation (heat
 * strain, glycogen, recovery) belongs to the future agent API, which reads the
 * same MovementProfile + MovementLoadout + per-segment terrain samples.
 */

const C = TERRAIN_CLASS

/** Pandolf terrain factor η per land-cover class (1.0 = blacktop road). */
const TERRAIN_FACTOR: Record<number, number> = {
  [C.ROAD]: 1.0,
  [C.OPEN]: 1.1,
  [C.GRASS]: 1.15,
  [C.BARREN]: 1.3,
  [C.URBAN]: 1.1,
  [C.SCRUB]: 1.5,
  [C.FOREST]: 1.8,
  [C.WETLAND]: 2.5,
  [C.WATER]: 3.5,
  [C.BUILDING]: 1.2,
}

const METERS_PER_DEG_LAT = 111_320

function metersPerDegLon(latDeg: number): number {
  return METERS_PER_DEG_LAT * Math.cos((latDeg * Math.PI) / 180)
}

/** Tobler speed factor relative to flat ground (1.0 at 0°). */
export function slopeSpeedFactor(slopeDeg: number, downhill: boolean): number {
  const grade = Math.tan((slopeDeg * Math.PI) / 180) * (downhill ? -1 : 1)
  const flat = Math.exp(-3.5 * 0.05)
  return Math.exp(-3.5 * Math.abs(grade + 0.05)) / flat
}

/** Pandolf metabolic rate (watts) for carrying load L over grade G% at speed V. */
export function pandolfWatts(
  bodyMassKg: number,
  loadMassKg: number,
  speedMs: number,
  gradePct: number,
  terrainFactor: number,
): number {
  const W = bodyMassKg
  const L = loadMassKg
  const V = speedMs
  const eta = terrainFactor
  const total = W + L

  // Standard Pandolf (uphill/level).
  let m = 1.5 * W + 2.0 * total * (L / W) ** 2 + eta * total * (1.5 * V * V + 0.35 * V * gradePct)

  // Santee downhill correction: descending costs less than the level term implies.
  if (gradePct < 0) {
    const g = gradePct
    const correction =
      eta *
      ((g * total * V) / 3.5 -
        (total * (g + 6) ** 2) / W +
        25 - V * V)
    m -= correction
  }

  // Never below resting metabolism.
  return Math.max(1.2 * W, m)
}

/** Speed & energy multipliers from battlefield weather (both default to 1.0). */
export function weatherFactors(weather: Weather | null | undefined): { speed: number; energy: number } {
  if (!weather) return { speed: 1, energy: 1 }
  let speed = 1
  let energy = 1
  if (weather.precipitationMm > 0.2) {
    speed *= 0.9 // wet/muddy footing
    energy *= 1.1
  }
  if (weather.windSpeedKmh > 25) energy *= 1.05
  if (weather.temperatureC > 30) {
    speed *= 0.95
    energy *= 1.1 // heat strain
  } else if (weather.temperatureC < 0) {
    energy *= 1.05
  }
  return { speed, energy }
}

interface Sample {
  stepM: number
  slopeDeg: number
  cls: number
  downhill: boolean
}

/** Walk the polyline at ~one-cell spacing, sampling grid slope + class. Falls
 *  back to flat clear ground where there's no grid. */
function sampleRoute(points: LonLat[], grid: GridData | null): Sample[] {
  const samples: Sample[] = []
  const step = grid?.cellMeters ?? 20
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    const mLat = METERS_PER_DEG_LAT
    const mLon = metersPerDegLon(a.latitude)
    const dx = (b.longitude - a.longitude) * mLon
    const dy = (b.latitude - a.latitude) * mLat
    const segLen = Math.hypot(dx, dy)
    if (segLen === 0) continue
    const count = Math.max(1, Math.round(segLen / step))
    let prevElev: number | null = null
    for (let k = 0; k < count; k++) {
      const f = (k + 0.5) / count
      const lon = a.longitude + (b.longitude - a.longitude) * f
      const lat = a.latitude + (b.latitude - a.latitude) * f
      let slopeDeg = 0
      let cls: number = C.OPEN
      let downhill = false
      if (grid) {
        const idx = cellIndexAt(grid, lon, lat)
        if (idx >= 0) {
          slopeDeg = grid.slope[idx]
          cls = grid.cls[idx]
          const elev = grid.elevation[idx]
          if (prevElev !== null) downhill = elev < prevElev
          prevElev = elev
        }
      }
      samples.push({ stepM: segLen / count, slopeDeg, cls, downhill })
    }
  }
  return samples
}

/** Estimate a route's cost for a gait + loadout over terrain + weather. */
export function estimateMovement(
  points: LonLat[],
  movementType: MovementType,
  loadout: MovementLoadout,
  grid: GridData | null,
  weather: Weather | null | undefined,
): MovementEstimate {
  const profile = MOVEMENT_PROFILES[movementType]
  const wf = weatherFactors(weather)
  const samples = sampleRoute(points, grid)

  let distanceM = 0
  let timeSec = 0
  let energyJ = 0
  let weightedWattsPerKg = 0

  for (const s of samples) {
    distanceM += s.stepM
    const speed = Math.max(
      0.05,
      profile.baseSpeedMs * slopeSpeedFactor(s.slopeDeg, s.downhill) * wf.speed,
    )
    const segSec = s.stepM / speed
    timeSec += segSec

    const gradePct = Math.tan((s.slopeDeg * Math.PI) / 180) * (s.downhill ? -100 : 100)
    const eta = TERRAIN_FACTOR[s.cls] ?? 1.2
    const watts =
      pandolfWatts(loadout.bodyMassKg, loadout.loadMassKg, speed, gradePct, eta) *
      profile.energyRate *
      wf.energy
    energyJ += watts * segSec
    weightedWattsPerKg += (watts / (loadout.bodyMassKg + loadout.loadMassKg)) * segSec
  }

  const durationMin = timeSec / 60
  const avgSpeedMs = timeSec > 0 ? distanceM / timeSec : 0

  // Fatigue: average metabolic intensity (W/kg above resting) blended with how
  // long the effort is sustained. A short rush spikes intensity but is bounded;
  // a long march accumulates.
  const avgWattsPerKg = timeSec > 0 ? weightedWattsPerKg / timeSec : 0
  const RESTING = 1.2
  const HARD = 12
  const intensityFrac = Math.min(1, Math.max(0, (avgWattsPerKg - RESTING) / (HARD - RESTING)))
  const durationAmp = 0.5 + 0.5 * Math.min(1, durationMin / 60)
  const fatigueIndex = Math.round(intensityFrac * durationAmp * 100)

  // Terrain drag: how much slower than this gait on flat clear ground.
  const flatTime = distanceM / (profile.baseSpeedMs * wf.speed)
  const terrainPenaltyPct = flatTime > 0 ? Math.round(((timeSec - flatTime) / flatTime) * 100) : 0

  return {
    distanceM,
    durationMin,
    energyKJ: energyJ / 1000,
    fatigueIndex,
    avgSpeedMs,
    terrainPenaltyPct,
  }
}
