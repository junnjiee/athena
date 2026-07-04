import { sampleCell } from './grid'
import { TERRAIN_CLASS, type GridData } from '../types/terrain'
import type { LonLat, PlacedRoute } from '../types/entities'

export type WarningKind = 'steep' | 'water' | 'exposed' | 'slow'
export type WarningSeverity = 'critical' | 'warning'

export interface PlanWarning {
  id: string
  routeId: string
  kind: WarningKind
  severity: WarningSeverity
  message: string
  position: LonLat
}

export interface RouteMetrics {
  routeId: string
  lengthMeters: number
  etaMinutes: number
  /** fraction (0–1) of the route through high-visibility ground */
  exposure: number
}

export interface PlanAnalysis {
  warnings: PlanWarning[]
  routes: RouteMetrics[]
  totalEtaMinutes: number
  /** worst route exposure, 0–1 */
  exposure: number
}

const WALK_SPEED_MS = 1.4
const STEEP_SLOPE_DEG = 30
const EXPOSED_VISIBILITY = 65
/** consecutive samples that must offend before a warning is raised */
const MIN_RUN = 3

interface Sample {
  lon: number
  lat: number
  stepMeters: number
  slope: number
  cls: number
  visibility: number
  moveCostFactor: number
}

function metersPerDegree(latDeg: number): { lat: number; lon: number } {
  return { lat: 111_320, lon: 111_320 * Math.cos((latDeg * Math.PI) / 180) }
}

/** Walk the polyline at ~one grid-cell intervals, sampling the military grid. */
function sampleRoute(points: LonLat[], grid: GridData): Sample[] {
  const samples: Sample[] = []
  const step = grid.cellMeters
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    const mpd = metersPerDegree(a.latitude)
    const dx = (b.longitude - a.longitude) * mpd.lon
    const dy = (b.latitude - a.latitude) * mpd.lat
    const segLen = Math.hypot(dx, dy)
    const count = Math.max(1, Math.round(segLen / step))
    for (let k = 0; k < count; k++) {
      const f = k / count
      const lon = a.longitude + (b.longitude - a.longitude) * f
      const lat = a.latitude + (b.latitude - a.latitude) * f
      const cell = sampleCell(grid, lon, lat)
      if (!cell) continue
      samples.push({
        lon,
        lat,
        stepMeters: segLen / count,
        slope: cell.slopeDeg,
        cls: cell.cls,
        visibility: cell.visibility,
        moveCostFactor: cell.moveCostFactor,
      })
    }
  }
  return samples
}

interface RunDetector {
  offending: (s: Sample) => boolean
  kind: WarningKind
  severity: WarningSeverity
  message: (runMeters: number) => string
}

const DETECTORS: RunDetector[] = [
  {
    offending: (s) => s.cls === TERRAIN_CLASS.WATER,
    kind: 'water',
    severity: 'critical',
    message: (m) => `Water crossing — ${Math.round(m)} m without a bridge`,
  },
  {
    offending: (s) => s.slope >= STEEP_SLOPE_DEG,
    kind: 'steep',
    severity: 'warning',
    message: (m) => `Steep slope ≥${STEEP_SLOPE_DEG}° for ${Math.round(m)} m`,
  },
  {
    offending: (s) => s.visibility >= EXPOSED_VISIBILITY && s.cls !== TERRAIN_CLASS.WATER,
    kind: 'exposed',
    severity: 'warning',
    message: (m) => `Exposed crossing — ${Math.round(m)} m in open view`,
  },
  {
    offending: (s) => s.moveCostFactor >= 3 && s.cls !== TERRAIN_CLASS.WATER,
    kind: 'slow',
    severity: 'warning',
    message: (m) => `Slow going — ${Math.round(m)} m of difficult terrain`,
  },
]

/** Collapse consecutive offending samples into one warning at the run's midpoint. */
function detectRuns(routeId: string, samples: Sample[], detector: RunDetector): PlanWarning[] {
  const warnings: PlanWarning[] = []
  let runStart = -1
  let runMeters = 0
  const flush = (endIdx: number) => {
    if (runStart < 0) return
    const runLen = endIdx - runStart
    if (runLen >= MIN_RUN) {
      const mid = samples[runStart + Math.floor(runLen / 2)]
      warnings.push({
        id: `${routeId}:${detector.kind}:${runStart}`,
        routeId,
        kind: detector.kind,
        severity: detector.severity,
        message: detector.message(runMeters),
        position: { longitude: mid.lon, latitude: mid.lat },
      })
    }
    runStart = -1
    runMeters = 0
  }
  samples.forEach((s, i) => {
    if (detector.offending(s)) {
      if (runStart < 0) runStart = i
      runMeters += s.stepMeters
    } else {
      flush(i)
    }
  })
  flush(samples.length)
  return warnings
}

export function analyzeRoute(route: PlacedRoute, grid: GridData): { warnings: PlanWarning[]; metrics: RouteMetrics } {
  const samples = sampleRoute(route.points, grid)
  const warnings = DETECTORS.flatMap((d) => detectRuns(route.id, samples, d))

  let lengthMeters = 0
  let effortSeconds = 0
  let exposedMeters = 0
  for (const s of samples) {
    lengthMeters += s.stepMeters
    effortSeconds += (s.stepMeters * s.moveCostFactor) / WALK_SPEED_MS
    if (s.visibility >= EXPOSED_VISIBILITY) exposedMeters += s.stepMeters
  }

  return {
    warnings,
    metrics: {
      routeId: route.id,
      lengthMeters,
      etaMinutes: effortSeconds / 60,
      exposure: lengthMeters > 0 ? exposedMeters / lengthMeters : 0,
    },
  }
}

/** Validate every route in the plan against the simulation grid. */
export function analyzePlan(routes: PlacedRoute[], grid: GridData | null): PlanAnalysis | null {
  if (!grid || routes.length === 0) return null
  const results = routes.map((r) => analyzeRoute(r, grid))
  const metrics = results.map((r) => r.metrics)
  return {
    warnings: results.flatMap((r) => r.warnings),
    routes: metrics,
    totalEtaMinutes: Math.max(...metrics.map((m) => m.etaMinutes), 0),
    exposure: Math.max(...metrics.map((m) => m.exposure), 0),
  }
}
