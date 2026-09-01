import { describe, expect, test } from 'bun:test'
import { buildPathDensity, cellToLonLat } from '../src/lib/replayGeo'
import type { ReplayLog } from '../src/types/replay'
import type { GridData } from '../src/types/terrain'

/** A run has to go back on the ground it was fought on, and a batch has to
 *  aggregate into "where does this plan take people" rather than one anecdote. */

const grid = {
  bbox: { west: 0, south: 0, east: 1, north: 1 },
  width: 10,
  height: 10,
} as unknown as GridData

function replay(track: Array<[number, number]>, dieAt?: [number, number]): ReplayLog {
  return {
    schema_version: 4,
    battlefield: { width: 10, height: 10, terrain_classes: [] },
    steps: track.map(([x, y], step) => ({
      step,
      soldiers: [
        {
          soldier_index: 0,
          team: 'blue' as const,
          position: { x, y, z: 0 },
          survival_status:
            dieAt && x === dieAt[0] && y === dieAt[1]
              ? ('casualty' as const)
              : ('alive' as const),
        },
      ],
      shots: [],
    })),
  }
}

describe('putting a run back on the ground', () => {
  test('a cell maps to its own centre, not its corner', () => {
    // Cells partition the bbox, so the half-cell offset is what puts a soldier
    // in the middle of its square.
    const first = cellToLonLat(grid, 0, 0)
    expect(first.longitude).toBeCloseTo(0.05, 10)
    expect(first.latitude).toBeCloseTo(0.95, 10)

    const last = cellToLonLat(grid, 9, 9)
    expect(last.longitude).toBeCloseTo(0.95, 10)
    expect(last.latitude).toBeCloseTo(0.05, 10)
  })

  test('row zero is the northernmost, matching the packed grid', () => {
    expect(cellToLonLat(grid, 0, 0).latitude).toBeGreaterThan(
      cellToLonLat(grid, 0, 9).latitude,
    )
  })
})

describe('where a plan takes people', () => {
  test('a cell used in every run reads as certain, one used in half as half', () => {
    const density = buildPathDensity(grid, [
      replay([[1, 1], [2, 1]]),
      replay([[1, 1], [3, 1]]),
    ])

    expect(density.blue[1 * 10 + 1]).toBe(1)
    expect(density.blue[1 * 10 + 2]).toBe(0.5)
    expect(density.blue[1 * 10 + 3]).toBe(0.5)
    expect(density.runs).toBe(2)
  })

  test('loitering does not make a cell look more likely', () => {
    // Occupancy is counted once per run per cell: a section that stops for
    // twenty ticks is not twenty times more likely to be there than one that
    // walks through.
    const density = buildPathDensity(grid, [
      replay([[4, 4], [4, 4], [4, 4], [4, 4]]),
    ])

    expect(density.blue[4 * 10 + 4]).toBe(1)
  })

  test('a casualty is counted where it fell, once', () => {
    // Not on every later tick it lies there.
    const density = buildPathDensity(grid, [
      replay([[1, 1], [5, 5], [5, 5], [5, 5]], [5, 5]),
    ])

    expect(density.casualties[5 * 10 + 5]).toBe(1)
    expect(density.casualties[1 * 10 + 1]).toBe(0)
  })

  test('no runs produce an empty field rather than a crash', () => {
    const density = buildPathDensity(grid, [])

    expect(density.runs).toBe(0)
    expect(density.blue.every((v) => v === 0)).toBe(true)
  })
})
