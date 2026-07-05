import { TERRAIN_CLASS, type GridData } from '../types/terrain'

/** Deterministic PRNG so tree placement is stable across re-renders. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Paint a soft conifer/broadleaf silhouette; three hue variants for variety.
 *  `monochrome` swaps the green canopy/brown trunk for grayscale equivalents,
 *  keeping the same relative luminance spread across variants. */
export function treeSpriteDataUrl(variant: 0 | 1 | 2, monochrome = false): string {
  const canvas = document.createElement('canvas')
  canvas.width = 48
  canvas.height = 72
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  const greens = (monochrome
    ? [
        ['#3a3d40', '#54585c'],
        ['#34373a', '#4c5054'],
        ['#3f4245', '#5c6165'],
      ]
    : [
        ['#1d4a2a', '#2c6b3d'],
        ['#1a422f', '#276044'],
        ['#24512b', '#38763f'],
      ])[variant]

  // trunk
  ctx.fillStyle = monochrome ? '#232527' : '#3b2f23'
  ctx.fillRect(21, 52, 6, 18)

  // canopy: stacked blobs, darker at the base
  const layers: [number, number, number][] = [
    [24, 46, 17],
    [24, 34, 14],
    [24, 22, 11],
    [24, 12, 8],
  ]
  layers.forEach(([x, y, r], i) => {
    const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.2, x, y, r)
    g.addColorStop(0, greens[1])
    g.addColorStop(1, greens[0])
    ctx.fillStyle = g
    ctx.globalAlpha = 0.92 - i * 0.02
    ctx.beginPath()
    ctx.ellipse(x, y, r, r * 0.82, 0, 0, Math.PI * 2)
    ctx.fill()
  })
  ctx.globalAlpha = 1
  return canvas.toDataURL('image/png')
}

export interface TreeInstance {
  longitude: number
  latitude: number
  /** canopy height in meters */
  size: number
  variant: 0 | 1 | 2
}

const MAX_TREES = 4000

/** Scatter procedural trees inside forest (and lightly, scrub) cells of the grid. */
export function scatterTrees(grid: GridData): TreeInstance[] {
  const rand = mulberry32(grid.width * 73856093 + grid.height * 19349663)
  const forest: number[] = []
  const scrub: number[] = []
  for (let i = 0; i < grid.cls.length; i++) {
    if (grid.cls[i] === TERRAIN_CLASS.FOREST) forest.push(i)
    else if (grid.cls[i] === TERRAIN_CLASS.SCRUB) scrub.push(i)
  }
  if (forest.length + scrub.length === 0) return []

  const target = Math.min(MAX_TREES, Math.round(forest.length * 1.2 + scrub.length * 0.25))
  const { bbox, width, height } = grid
  const dLon = (bbox.east - bbox.west) / width
  const dLat = (bbox.north - bbox.south) / height

  const trees: TreeInstance[] = []
  const forestShare = forest.length * 1.2 / (forest.length * 1.2 + scrub.length * 0.25)
  for (let k = 0; k < target; k++) {
    const pool = rand() < forestShare && forest.length > 0 ? forest : scrub.length > 0 ? scrub : forest
    const cell = pool[Math.floor(rand() * pool.length)]
    const row = Math.floor(cell / width)
    const col = cell % width
    const isScrub = grid.cls[cell] === TERRAIN_CLASS.SCRUB
    trees.push({
      longitude: bbox.west + (col + rand()) * dLon,
      latitude: bbox.north - (row + rand()) * dLat,
      size: isScrub ? 3 + rand() * 3 : 8 + rand() * 7,
      variant: Math.floor(rand() * 3) as 0 | 1 | 2,
    })
  }
  return trees
}
