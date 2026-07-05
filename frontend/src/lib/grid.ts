import { computeContourPlan, drawContours } from './contours'
import {
  TERRAIN_CLASS,
  TERRAIN_CLASS_NAMES,
  type BBoxDeg,
  type CellSample,
  type GridData,
  type HeatmapMetric,
} from '../types/terrain'

const GRID_MAGIC = 0x41544847
const GRID_VERSION = 1
const HEADER_BYTES = 16

/** Decode the server's binary grid (see server/src/services/grid.ts for layout). */
export function decodeGrid(buffer: ArrayBuffer, bbox: BBoxDeg): GridData {
  const view = new DataView(buffer)
  if (view.getUint32(0, true) !== GRID_MAGIC) throw new Error('bad grid magic')
  if (view.getUint16(4, true) !== GRID_VERSION) throw new Error('unsupported grid version')
  const width = view.getUint16(6, true)
  const height = view.getUint16(8, true)
  const cellMeters = view.getFloat32(12, true)
  const n = width * height

  const elevation = new Float32Array(buffer, HEADER_BYTES, n)
  const u8 = (channel: number) =>
    new Uint8Array(buffer, HEADER_BYTES + n * 4 + channel * n, n)

  return {
    bbox,
    width,
    height,
    cellMeters,
    elevation,
    cls: u8(0),
    slope: u8(1),
    cover: u8(2),
    concealment: u8(3),
    moveCost: u8(4),
    visibility: u8(5),
    vehicleMobility: u8(6),
    ambush: u8(7),
  }
}

/** Row-major index of the cell containing (lon, lat), or -1 if outside the bbox. */
export function cellIndexAt(grid: GridData, longitude: number, latitude: number): number {
  const { bbox, width, height } = grid
  const fx = (longitude - bbox.west) / (bbox.east - bbox.west)
  const fy = (bbox.north - latitude) / (bbox.north - bbox.south)
  if (fx < 0 || fx >= 1 || fy < 0 || fy >= 1) return -1
  return Math.floor(fy * height) * width + Math.floor(fx * width)
}

export function sampleCell(grid: GridData, longitude: number, latitude: number): CellSample | null {
  const i = cellIndexAt(grid, longitude, latitude)
  if (i < 0) return null
  return {
    longitude,
    latitude,
    elevation: grid.elevation[i],
    slopeDeg: grid.slope[i],
    cls: grid.cls[i],
    clsName: TERRAIN_CLASS_NAMES[grid.cls[i]] ?? 'Unknown',
    cover: grid.cover[i],
    concealment: grid.concealment[i],
    moveCostFactor: grid.moveCost[i] / 20,
    visibility: grid.visibility[i],
    vehicleMobility: grid.vehicleMobility[i],
    ambush: grid.ambush[i],
  }
}

// ---------------------------------------------------------------------------
// Colormaps
// ---------------------------------------------------------------------------

type Rgba = [number, number, number, number]
type Stop = [number, Rgba]

/** Gradient stops per metric (position 0–1). Alpha bakes the drape translucency. */
const RAMPS: Partial<Record<HeatmapMetric, Stop[]>> = {
  cover: [
    [0, [239, 68, 68, 150]],
    [0.5, [234, 179, 8, 140]],
    [1, [59, 130, 246, 165]],
  ],
  concealment: [
    [0, [239, 68, 68, 140]],
    [0.5, [234, 179, 8, 135]],
    [1, [34, 197, 94, 165]],
  ],
  movement: [
    [0, [34, 197, 94, 150]],
    [0.45, [234, 179, 8, 145]],
    [1, [239, 68, 68, 170]],
  ],
  visibility: [
    [0, [34, 197, 94, 130]],
    [0.55, [234, 179, 8, 140]],
    [1, [239, 68, 68, 175]],
  ],
  vehicle: [
    [0, [239, 68, 68, 150]],
    [0.5, [234, 179, 8, 140]],
    [1, [34, 197, 94, 165]],
  ],
  ambush: [
    [0, [217, 70, 239, 0]],
    [0.55, [217, 70, 239, 110]],
    [1, [217, 70, 239, 210]],
  ],
  slope: [
    [0, [251, 146, 60, 0]],
    [0.5, [251, 146, 60, 120]],
    [1, [220, 38, 38, 200]],
  ],
  elevation: [
    [0, [30, 58, 95, 165]],
    [0.35, [63, 107, 79, 160]],
    [0.65, [138, 143, 90, 160]],
    [0.85, [185, 141, 94, 165]],
    [1, [232, 224, 208, 175]],
  ],
}

const CLASS_COLORS: Record<number, Rgba> = {
  [TERRAIN_CLASS.OPEN]: [138, 143, 106, 130],
  [TERRAIN_CLASS.GRASS]: [109, 166, 90, 140],
  [TERRAIN_CLASS.SCRUB]: [79, 127, 71, 150],
  [TERRAIN_CLASS.FOREST]: [31, 94, 51, 170],
  [TERRAIN_CLASS.WETLAND]: [63, 127, 114, 150],
  [TERRAIN_CLASS.WATER]: [47, 109, 184, 175],
  [TERRAIN_CLASS.URBAN]: [143, 143, 150, 140],
  [TERRAIN_CLASS.BUILDING]: [203, 213, 225, 190],
  [TERRAIN_CLASS.ROAD]: [217, 201, 121, 175],
  [TERRAIN_CLASS.BARREN]: [176, 160, 138, 140],
}

function rampColor(stops: Stop[], t: number): Rgba {
  const x = Math.max(0, Math.min(1, t))
  for (let i = 1; i < stops.length; i++) {
    if (x <= stops[i][0]) {
      const [p0, c0] = stops[i - 1]
      const [p1, c1] = stops[i]
      const f = p1 === p0 ? 0 : (x - p0) / (p1 - p0)
      return [
        c0[0] + (c1[0] - c0[0]) * f,
        c0[1] + (c1[1] - c0[1]) * f,
        c0[2] + (c1[2] - c0[2]) * f,
        c0[3] + (c1[3] - c0[3]) * f,
      ]
    }
  }
  return stops[stops.length - 1][1]
}

/** CSS gradient string matching a metric's ramp — keeps panel legends honest. */
export function legendGradient(metric: HeatmapMetric): string {
  const stops = RAMPS[metric]
  if (!stops) return 'linear-gradient(to right, transparent, transparent)'
  const css = stops
    .map(([p, [r, g, b, a]]) => `rgba(${r | 0},${g | 0},${b | 0},${Math.max(a / 255, 0.25)}) ${p * 100}%`)
    .join(', ')
  return `linear-gradient(to right, ${css})`
}

export function elevationRange(grid: GridData): [number, number] {
  let min = Infinity
  let max = -Infinity
  for (const v of grid.elevation) {
    if (v < min) min = v
    if (v > max) max = v
  }
  return [min, max]
}

/** Plain-text legend for the "contours" metric -- a gradient bar doesn't meaningfully
 *  represent iso-line spacing, so the panel shows this instead (same reasoning
 *  "landcover" already uses to skip the gradient bar). */
export function contourLegendLabel(grid: GridData): string {
  const [min, max] = elevationRange(grid)
  const plan = computeContourPlan(min, max)
  return plan ? `${plan.step}m intervals` : 'Flat terrain — no contours'
}

function metricValue(grid: GridData, metric: HeatmapMetric, i: number, elevRange: [number, number]): number {
  switch (metric) {
    case 'cover':
      return grid.cover[i] / 100
    case 'concealment':
      return grid.concealment[i] / 100
    case 'movement':
      // 20 (×1.0) → 0, 120 (×6) → 1
      return Math.min(1, (grid.moveCost[i] - 15) / 105)
    case 'visibility':
      return grid.visibility[i] / 100
    case 'vehicle':
      return grid.vehicleMobility[i] / 100
    case 'ambush':
      return grid.ambush[i] / 100
    case 'slope':
      return Math.min(1, grid.slope[i] / 40)
    case 'elevation': {
      const [min, max] = elevRange
      return max > min ? (grid.elevation[i] - min) / (max - min) : 0
    }
    default:
      return 0
  }
}

const HEATMAP_UPSCALE = 3

/** Rasterize a metric to a crisp (nearest-neighbor upscaled) canvas for draping
 *  over terrain as a single-tile imagery layer. */
export function renderHeatmapCanvas(grid: GridData, metric: HeatmapMetric): HTMLCanvasElement {
  const { width, height } = grid
  const base = document.createElement('canvas')
  base.width = width
  base.height = height
  const ctx = base.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')

  // Contours are traced/stroked directly at upscaled resolution below (vector paths,
  // not a per-pixel fill), so `base` is left fully transparent here -- canvases start
  // blank, nothing to fill.
  if (metric !== 'contours') {
    const elevRange: [number, number] = metric === 'elevation' ? elevationRange(grid) : [0, 0]
    const image = ctx.createImageData(width, height)
    const stops = RAMPS[metric]
    for (let i = 0; i < width * height; i++) {
      let color: Rgba
      if (metric === 'landcover') {
        color = CLASS_COLORS[grid.cls[i]] ?? [0, 0, 0, 0]
      } else if (stops) {
        color = rampColor(stops, metricValue(grid, metric, i, elevRange))
      } else {
        color = [0, 0, 0, 0]
      }
      const o = i * 4
      image.data[o] = color[0]
      image.data[o + 1] = color[1]
      image.data[o + 2] = color[2]
      image.data[o + 3] = color[3]
    }
    ctx.putImageData(image, 0, 0)
  }

  const out = document.createElement('canvas')
  out.width = width * HEATMAP_UPSCALE
  out.height = height * HEATMAP_UPSCALE
  const outCtx = out.getContext('2d')
  if (!outCtx) throw new Error('2d context unavailable')
  outCtx.imageSmoothingEnabled = false
  outCtx.drawImage(base, 0, 0, out.width, out.height)

  if (metric === 'contours') {
    const [min, max] = elevationRange(grid)
    const plan = computeContourPlan(min, max)
    if (plan) drawContours(outCtx, grid, plan.levels, HEATMAP_UPSCALE)
  }

  return out
}
