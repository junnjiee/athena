import { TERRAIN_CLASS, type GridData } from '../types/terrain'
import type { LonLat } from '../types/entities'

const C = TERRAIN_CLASS

/** Flat binary min-heap keyed by an external fScore array — no per-node objects,
 *  so the open set stays GC-free across an 80k-node search. */
class MinHeap {
  private readonly heap: number[] = []
  private readonly key: Float64Array

  constructor(key: Float64Array) {
    this.key = key
  }

  get size(): number {
    return this.heap.length
  }

  push(node: number): void {
    const h = this.heap
    h.push(node)
    let i = h.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (this.key[h[parent]] <= this.key[h[i]]) break
      ;[h[parent], h[i]] = [h[i], h[parent]]
      i = parent
    }
  }

  pop(): number {
    const h = this.heap
    const top = h[0]
    const last = h.pop() as number
    if (h.length > 0) {
      h[0] = last
      let i = 0
      const n = h.length
      for (;;) {
        const l = 2 * i + 1
        const r = 2 * i + 2
        let smallest = i
        if (l < n && this.key[h[l]] < this.key[h[smallest]]) smallest = l
        if (r < n && this.key[h[r]] < this.key[h[smallest]]) smallest = r
        if (smallest === i) break
        ;[h[smallest], h[i]] = [h[i], h[smallest]]
        i = smallest
      }
    }
    return top
  }
}

export type UnitKind = 'infantry' | 'mechanized'

export interface RouteRequest {
  start: LonLat
  goal: LonLat
  unitKind: UnitKind
  /** risk aversion 0 (fastest) → 1 (most concealed) */
  lambda: number
}

export interface RoutePath {
  /** simplified polyline in lon/lat, start → goal */
  points: LonLat[]
  lengthMeters: number
  /** movement-cost-weighted travel-time proxy, minutes */
  etaMinutes: number
  /** fraction (0–1) of the route watched by the enemy (uses danger field if present) */
  exposure: number
}

const SQRT2 = Math.SQRT2
const WALK_SPEED_MS = 1.4
/** danger scaling: at lambda=1 a fully-seen cell costs (1 + MAX_DANGER_PENALTY)× */
const MAX_DANGER_PENALTY = 8

interface Grid {
  width: number
  height: number
  cellMeters: number
  moveCost: Uint8Array
  cls: Uint8Array
  vehicleMobility: Uint8Array
  danger?: Uint8Array
}

function isImpassable(grid: Grid, i: number, unitKind: UnitKind): boolean {
  if (grid.cls[i] === C.WATER || grid.cls[i] === C.BUILDING) return true
  if (unitKind === 'mechanized' && grid.vehicleMobility[i] === 0) return true
  return false
}

function cellCol(grid: Grid, lon: number, bbox: GridData['bbox']): number {
  return Math.floor(((lon - bbox.west) / (bbox.east - bbox.west)) * grid.width)
}
function cellRow(grid: Grid, lat: number, bbox: GridData['bbox']): number {
  return Math.floor(((bbox.north - lat) / (bbox.north - bbox.south)) * grid.height)
}

/** Per-cell entry cost: base move cost (slope-aware, already in the grid) scaled
 *  by a danger penalty weighted by the risk-aversion knob. */
function cellCost(grid: Grid, i: number, lambda: number): number {
  const move = grid.moveCost[i] / 20 // ×1.0 = clear ground
  const danger = (grid.danger?.[i] ?? 0) / 100
  return move * (1 + lambda * MAX_DANGER_PENALTY * danger)
}

const NEIGHBORS: [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, SQRT2],
  [1, -1, SQRT2],
  [-1, 1, SQRT2],
  [-1, -1, SQRT2],
]

/** A* over the cell graph (8-connectivity). Edge cost = geometric distance ×
 *  mean entry cost of the two cells × danger weighting. Returns the raw cell
 *  path (row-major indices) or null if unreachable. */
function search(grid: Grid, startIdx: number, goalIdx: number, unitKind: UnitKind, lambda: number): Int32Array | null {
  const n = grid.width * grid.height
  const gScore = new Float64Array(n).fill(Infinity)
  const fScore = new Float64Array(n).fill(Infinity)
  const cameFrom = new Int32Array(n).fill(-1)
  const closed = new Uint8Array(n)

  const goalCol = goalIdx % grid.width
  const goalRow = (goalIdx / grid.width) | 0
  // admissible heuristic: straight-line cell distance × cheapest possible entry cost
  const minEntry = 15 / 20 // ROAD base move cost / 20
  const heuristic = (i: number): number => {
    const col = i % grid.width
    const row = (i / grid.width) | 0
    return Math.hypot(col - goalCol, row - goalRow) * minEntry
  }

  const open = new MinHeap(fScore)
  gScore[startIdx] = 0
  fScore[startIdx] = heuristic(startIdx)
  open.push(startIdx)

  while (open.size > 0) {
    const current = open.pop()
    if (current === goalIdx) break
    if (closed[current]) continue
    closed[current] = 1

    const col = current % grid.width
    const row = (current / grid.width) | 0
    const currentCost = cellCost(grid, current, lambda)

    for (const [dc, dr, dist] of NEIGHBORS) {
      const nc = col + dc
      const nr = row + dr
      if (nc < 0 || nc >= grid.width || nr < 0 || nr >= grid.height) continue
      const neighbor = nr * grid.width + nc
      if (closed[neighbor] || isImpassable(grid, neighbor, unitKind)) continue

      const stepCost = dist * 0.5 * (currentCost + cellCost(grid, neighbor, lambda))
      const tentative = gScore[current] + stepCost
      if (tentative < gScore[neighbor]) {
        cameFrom[neighbor] = current
        gScore[neighbor] = tentative
        fScore[neighbor] = tentative + heuristic(neighbor)
        open.push(neighbor)
      }
    }
  }

  if (cameFrom[goalIdx] === -1 && startIdx !== goalIdx) return null
  const path: number[] = []
  let node = goalIdx
  while (node !== -1) {
    path.push(node)
    if (node === startIdx) break
    node = cameFrom[node]
  }
  path.reverse()
  return Int32Array.from(path)
}

/** Douglas–Peucker on cell coordinates — collapses the staircase into a clean
 *  polyline while staying within `epsilon` cells of the original path. */
function simplify(path: Int32Array, width: number, epsilon: number): number[] {
  if (path.length <= 2) return Array.from(path)
  const keep = new Uint8Array(path.length)
  keep[0] = 1
  keep[path.length - 1] = 1

  const colOf = (idx: number) => path[idx] % width
  const rowOf = (idx: number) => (path[idx] / width) | 0

  const stack: [number, number][] = [[0, path.length - 1]]
  while (stack.length > 0) {
    const [a, b] = stack.pop() as [number, number]
    const ax = colOf(a)
    const ay = rowOf(a)
    const bx = colOf(b)
    const by = rowOf(b)
    const dx = bx - ax
    const dy = by - ay
    const lenSq = dx * dx + dy * dy || 1
    let maxDist = 0
    let maxIdx = -1
    for (let i = a + 1; i < b; i++) {
      const px = colOf(i)
      const py = rowOf(i)
      const t = ((px - ax) * dx + (py - ay) * dy) / lenSq
      const cx = ax + t * dx
      const cy = ay + t * dy
      const d = Math.hypot(px - cx, py - cy)
      if (d > maxDist) {
        maxDist = d
        maxIdx = i
      }
    }
    if (maxDist > epsilon && maxIdx !== -1) {
      keep[maxIdx] = 1
      stack.push([a, maxIdx], [maxIdx, b])
    }
  }

  const out: number[] = []
  for (let i = 0; i < path.length; i++) if (keep[i]) out.push(path[i])
  return out
}

/** Suggest an optimal covered/concealed approach from start to goal. Returns null
 *  if the goal is unreachable for the unit type. Pure and synchronous — fast
 *  enough (single-digit ms on 80k nodes) to re-solve live as the risk slider drags. */
export function suggestRoute(grid: GridData, request: RouteRequest): RoutePath | null {
  const { bbox } = grid
  const clampCol = (c: number) => Math.max(0, Math.min(grid.width - 1, c))
  const clampRow = (r: number) => Math.max(0, Math.min(grid.height - 1, r))
  const startIdx = clampRow(cellRow(grid, request.start.latitude, bbox)) * grid.width + clampCol(cellCol(grid, request.start.longitude, bbox))
  const goalIdx = clampRow(cellRow(grid, request.goal.latitude, bbox)) * grid.width + clampCol(cellCol(grid, request.goal.longitude, bbox))

  const cellPath = search(grid, startIdx, goalIdx, request.unitKind, request.lambda)
  if (!cellPath) return null

  // metrics over the full (unsimplified) staircase for accuracy
  const metersLat = (bbox.north - bbox.south) / grid.height * 111_320
  const metersLon = (bbox.east - bbox.west) / grid.width * 111_320 * Math.cos(((bbox.north + bbox.south) / 2) * (Math.PI / 180))
  let lengthMeters = 0
  let effortSeconds = 0
  let exposedMeters = 0
  for (let k = 1; k < cellPath.length; k++) {
    const a = cellPath[k - 1]
    const b = cellPath[k]
    const dCol = (b % grid.width) - (a % grid.width)
    const dRow = ((b / grid.width) | 0) - ((a / grid.width) | 0)
    const segMeters = Math.hypot(dCol * metersLon, dRow * metersLat)
    lengthMeters += segMeters
    effortSeconds += (segMeters * (grid.moveCost[b] / 20)) / WALK_SPEED_MS
    if ((grid.danger?.[b] ?? 0) >= 50) exposedMeters += segMeters
  }

  const simplified = simplify(cellPath, grid.width, 1.2)
  const points: LonLat[] = simplified.map((idx) => {
    const col = idx % grid.width
    const row = (idx / grid.width) | 0
    return {
      longitude: bbox.west + ((col + 0.5) / grid.width) * (bbox.east - bbox.west),
      latitude: bbox.north - ((row + 0.5) / grid.height) * (bbox.north - bbox.south),
    }
  })

  return {
    points,
    lengthMeters,
    etaMinutes: effortSeconds / 60,
    exposure: lengthMeters > 0 ? exposedMeters / lengthMeters : 0,
  }
}
