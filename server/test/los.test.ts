import { describe, expect, test } from 'bun:test'
import { computeDangerField, computeViewshed, type LosTerrain } from '../src/services/los'
import { TERRAIN_CLASS as C } from '../src/types'

const W = 21
const H = 21
const CELL = 10

function terrain(overrides?: { elevation?: (col: number, row: number) => number; cls?: (col: number, row: number) => number }): LosTerrain {
  const elevation = new Float32Array(W * H)
  const cls = new Uint8Array(W * H).fill(C.OPEN)
  for (let row = 0; row < H; row++) {
    for (let col = 0; col < W; col++) {
      if (overrides?.elevation) elevation[row * W + col] = overrides.elevation(col, row)
      if (overrides?.cls) cls[row * W + col] = overrides.cls(col, row)
    }
  }
  return { width: W, height: H, cellMeters: CELL, elevation, cls }
}

const CENTER = { col: 10, row: 10 }

describe('single-observer viewshed', () => {
  test('flat open ground: everything is visible', () => {
    const seen = computeViewshed(terrain(), CENTER)
    expect([...seen].every((v) => v === 1)).toBe(true)
  })

  test('a ridge hides the ground behind it but not its crest', () => {
    // 30 m wall along col 14, observer at col 10 looking east
    const t = terrain({ elevation: (col) => (col === 14 ? 30 : 0) })
    const seen = computeViewshed(t, CENTER)
    const row = 10
    expect(seen[row * W + 13]).toBe(1) // in front of the ridge
    expect(seen[row * W + 14]).toBe(1) // the crest itself
    expect(seen[row * W + 16]).toBe(0) // dead ground behind
    expect(seen[row * W + 20]).toBe(0)
  })

  test('forest canopy blocks LOS on flat terrain — the tree line is seen, the ground behind is not', () => {
    const t = terrain({ cls: (col) => (col === 14 ? C.FOREST : C.OPEN) })
    const seen = computeViewshed(t, CENTER)
    const row = 10
    expect(seen[row * W + 14]).toBe(1) // soldier at the tree line is visible
    expect(seen[row * W + 17]).toBe(0) // concealed behind canopy
  })

  test('an elevated observer sees over the canopy', () => {
    const t = terrain({ cls: (col) => (col === 14 ? C.FOREST : C.OPEN) })
    const seen = computeViewshed(t, { ...CENTER, eyeHeightM: 60 })
    expect(seen[10 * W + 17]).toBe(1)
  })

  test('maxRange truncates the sweep', () => {
    const seen = computeViewshed(terrain(), CENTER, { maxRangeM: 30 }) // 3 cells
    expect(seen[10 * W + 13]).toBe(1)
    expect(seen[10 * W + 15]).toBe(0)
  })
})

describe('multi-observer danger field', () => {
  test('two observers on open ground → 100 everywhere', () => {
    const danger = computeDangerField(terrain(), [
      { col: 2, row: 2 },
      { col: 18, row: 18 },
    ])
    expect(danger[5 * W + 5]).toBe(100)
    expect(danger[15 * W + 15]).toBe(100)
  })

  test('a wall splitting the map → each side seen by only its observer (50)', () => {
    // 50 m wall along col 10 with observers either side of it
    const t = terrain({ elevation: (col) => (col === 10 ? 50 : 0) })
    const danger = computeDangerField(t, [
      { col: 2, row: 10 },
      { col: 18, row: 10 },
    ])
    expect(danger[10 * W + 4]).toBe(50) // west side: west observer only
    expect(danger[10 * W + 16]).toBe(50) // east side: east observer only
  })

  test('no observers → all zeros', () => {
    const danger = computeDangerField(terrain(), [])
    expect([...danger].every((v) => v === 0)).toBe(true)
  })
})
