import type { GridData } from '../types/terrain'
import type { ReplayLog } from '../types/replay'

/**
 * Putting a run back on the ground it was fought on.
 *
 * A replay is in cell space — row-major, row 0 northernmost, the same layout as
 * the packed grid — and the globe is in degrees. Everything here is that
 * conversion, plus the aggregate a commander actually wants from a batch: not
 * one run's track, but where soldiers *tend* to go and where they tend to die.
 */

export interface LonLat {
  longitude: number
  latitude: number
}

/** Centre of a cell, in degrees. Cells partition the bbox, so the half-cell
 *  offset is what puts a soldier in the middle of its square rather than on a
 *  corner. */
export function cellToLonLat(grid: GridData, x: number, y: number): LonLat {
  const { bbox, width, height } = grid
  return {
    longitude: bbox.west + ((x + 0.5) * (bbox.east - bbox.west)) / width,
    latitude: bbox.north - ((y + 0.5) * (bbox.north - bbox.south)) / height,
  }
}

export interface PathDensity {
  /** Per cell, the share of runs in which any soldier of that side stood there
   *  at some point: 0–1. This is the "where does this plan actually take
   *  people" answer, and it is why it is computed over runs rather than ticks —
   *  a soldier loitering does not make a cell more likely to be used. */
  blue: Float32Array
  red: Float32Array
  /** Per cell, how often a soldier became a casualty there, normalised to the
   *  worst cell. Where a plan gets people killed. */
  casualties: Float32Array
  runs: number
}

/**
 * Aggregate several runs of the same plan into per-cell likelihoods.
 *
 * Occupancy is counted once per run per cell, not once per tick: the question
 * is "how often does this plan put someone here", and a section that stops for
 * twenty ticks should not read as twenty times more likely than one that walks
 * through.
 */
export function buildPathDensity(
  grid: GridData,
  replays: readonly ReplayLog[],
): PathDensity {
  const cells = grid.width * grid.height
  const blue = new Float32Array(cells)
  const red = new Float32Array(cells)
  const casualties = new Float32Array(cells)

  for (const replay of replays) {
    const seenBlue = new Set<number>()
    const seenRed = new Set<number>()
    const dead = new Set<number>()

    for (const step of replay.steps) {
      for (const soldier of step.soldiers) {
        const index = soldier.position.y * grid.width + soldier.position.x
        if (index < 0 || index >= cells) continue

        if (soldier.survival_status === 'alive') {
          ;(soldier.team === 'blue' ? seenBlue : seenRed).add(index)
        } else if (!dead.has(soldier.soldier_index)) {
          // Count the cell a soldier fell in once, not on every later tick it
          // lies there.
          dead.add(soldier.soldier_index)
          casualties[index] += 1
        }
      }
    }

    for (const index of seenBlue) blue[index] += 1
    for (const index of seenRed) red[index] += 1
  }

  const runs = Math.max(1, replays.length)
  for (let i = 0; i < cells; i++) {
    blue[i] /= runs
    red[i] /= runs
  }

  let worst = 0
  for (let i = 0; i < cells; i++) worst = Math.max(worst, casualties[i])
  if (worst > 0) for (let i = 0; i < cells; i++) casualties[i] /= worst

  return { blue, red, casualties, runs: replays.length }
}

export type DensityLayer = 'blue' | 'red' | 'casualties'

const LAYER_RGB: Record<DensityLayer, [number, number, number]> = {
  blue: [75, 140, 240],
  red: [232, 86, 79],
  casualties: [255, 190, 90],
}

/**
 * Density as a drapeable image, one pixel per cell.
 *
 * Same shape as the terrain heatmaps: rendered once at grid resolution and
 * handed to Cesium as a single tile, so switching layers never touches
 * geometry.
 */
export function renderDensityCanvas(
  grid: GridData,
  density: PathDensity,
  layer: DensityLayer,
): HTMLCanvasElement {
  const { width, height } = grid
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')

  const values = density[layer]
  const [r, g, b] = LAYER_RGB[layer]
  const image = ctx.createImageData(width, height)

  for (let i = 0; i < width * height; i++) {
    const value = values[i]
    if (value <= 0) continue
    // Square-root so a cell used in one run of ten is still visible: the useful
    // signal here is "did anyone ever come this way", and a linear ramp buries
    // the rare paths that are often the interesting ones.
    const alpha = Math.min(1, Math.sqrt(value))
    image.data[i * 4] = r
    image.data[i * 4 + 1] = g
    image.data[i * 4 + 2] = b
    image.data[i * 4 + 3] = Math.round(alpha * 220)
  }

  ctx.putImageData(image, 0, 0)
  return canvas
}
