import type { GridData } from '../types/terrain'

export interface ContourPlan {
  step: number
  levels: number[]
}

const NICE_STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000]
const TARGET_LINES = 10
const MAX_LINES = 15
const MIN_LINES = 5

/** Picks the smallest "nice" elevation step that keeps the contour count within a
 *  readable band (<=15 lines), preferring a count close to ~10. Falls back to the
 *  coarsest step for extreme ranges. Returns null for flat/degenerate terrain. */
export function computeContourPlan(min: number, max: number): ContourPlan | null {
  const range = max - min
  if (!(range > 0)) return null

  let best: { step: number; count: number } | null = null
  for (const step of NICE_STEPS) {
    const count = Math.floor(range / step)
    if (count < 1) break
    if (count <= MAX_LINES && (!best || Math.abs(count - TARGET_LINES) < Math.abs(best.count - TARGET_LINES))) {
      best = { step, count }
    }
    if (best && count <= MIN_LINES) break
  }

  const step = best?.step ?? NICE_STEPS[NICE_STEPS.length - 1]
  const first = Math.ceil(min / step) * step
  const levels: number[] = []
  for (let v = first; v <= max; v += step) levels.push(v)
  return { step, levels }
}

// 16-case marching-squares edge-pair lookup (corner bits: NW=1, NE=2, SE=4, SW=8).
// Each entry lists which edges (N/E/S/W) get connected; saddle cases (5, 10) are
// disambiguated at trace time via the average of the 4 corners.
type Edge = 'N' | 'E' | 'S' | 'W'
const CASE_EDGES: Partial<Record<number, [Edge, Edge][]>> = {
  1: [['W', 'N']],
  2: [['N', 'E']],
  3: [['W', 'E']],
  4: [['E', 'S']],
  6: [['N', 'S']],
  7: [['W', 'S']],
  8: [['S', 'W']],
  9: [['N', 'S']],
  11: [['E', 'S']],
  12: [['W', 'E']],
  13: [['N', 'E']],
  14: [['W', 'N']],
}

/** Standard marching squares over grid.elevation at one level. Returns flat
 *  [x0,y0,x1,y1, x0,y0,x1,y1, ...] segment endpoints in unscaled grid-cell space
 *  (floats, resolution-independent -- no DOM/Canvas dependency). */
export function traceContour(grid: GridData, level: number): number[] {
  const { width, height, elevation } = grid
  const segments: number[] = []

  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const nw = elevation[y * width + x]
      const ne = elevation[y * width + x + 1]
      const sw = elevation[(y + 1) * width + x]
      const se = elevation[(y + 1) * width + x + 1]

      const cellMin = Math.min(nw, ne, sw, se)
      const cellMax = Math.max(nw, ne, sw, se)
      if (level < cellMin || level > cellMax) continue

      const c = (nw >= level ? 1 : 0) | (ne >= level ? 2 : 0) | (se >= level ? 4 : 0) | (sw >= level ? 8 : 0)
      if (c === 0 || c === 15) continue

      const edgePoint = (edge: Edge): [number, number] => {
        switch (edge) {
          case 'N': {
            const t = ne === nw ? 0.5 : (level - nw) / (ne - nw)
            return [x + t, y]
          }
          case 'E': {
            const t = se === ne ? 0.5 : (level - ne) / (se - ne)
            return [x + 1, y + t]
          }
          case 'S': {
            const t = se === sw ? 0.5 : (level - sw) / (se - sw)
            return [x + t, y + 1]
          }
          case 'W': {
            const t = sw === nw ? 0.5 : (level - nw) / (sw - nw)
            return [x, y + t]
          }
        }
      }

      let pairs: [Edge, Edge][]
      if (c === 5) {
        const avg = (nw + ne + se + sw) / 4
        pairs = avg >= level ? [['N', 'E'], ['S', 'W']] : [['W', 'N'], ['E', 'S']]
      } else if (c === 10) {
        const avg = (nw + ne + se + sw) / 4
        pairs = avg >= level ? [['W', 'N'], ['E', 'S']] : [['N', 'E'], ['S', 'W']]
      } else {
        pairs = CASE_EDGES[c] ?? []
      }

      for (const [a, b] of pairs) {
        const [ax, ay] = edgePoint(a)
        const [bx, by] = edgePoint(b)
        segments.push(ax, ay, bx, by)
      }
    }
  }

  return segments
}

/** Strokes all levels' traced segments into ctx, scaling grid-cell coordinates by
 *  `scale` before moveTo/lineTo so the path is built directly in the target canvas's
 *  coordinate space with full float precision -- never a small raster later
 *  nearest-neighbor blown up (canvas path stroking is unaffected by
 *  imageSmoothingEnabled, which only governs bitmap drawImage/putImageData scaling). */
export function drawContours(
  ctx: CanvasRenderingContext2D,
  grid: GridData,
  levels: number[],
  scale: number,
  style?: { color?: string; lineWidth?: number },
): void {
  const { color = 'rgba(232, 224, 200, 0.8)', lineWidth = 1.1 } = style ?? {}
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = lineWidth
  ctx.lineJoin = 'round'
  ctx.beginPath()
  for (const level of levels) {
    const segs = traceContour(grid, level)
    for (let i = 0; i < segs.length; i += 4) {
      ctx.moveTo(segs[i] * scale, segs[i + 1] * scale)
      ctx.lineTo(segs[i + 2] * scale, segs[i + 3] * scale)
    }
  }
  ctx.stroke()
  ctx.restore()
}
