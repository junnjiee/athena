import { describe, expect, test } from 'bun:test'
import { buildTerrainBrief, computeViewshed } from '../src/lib/intel'
import { TERRAIN_CLASS, type GridData } from '../src/types/terrain'

const BBOX = { west: 0, south: 0, east: 0.001, north: 0.001 }

/** Square grid over a 0.001° box at the equator; 111.32 m a side. */
function makeGrid(size: number, overrides: Partial<GridData> = {}): GridData {
  const n = size * size
  const fill = (v: number) => new Uint8Array(n).fill(v)
  return {
    bbox: BBOX,
    width: size,
    height: size,
    cellMeters: 111.32 / size,
    elevation: new Float32Array(n).fill(100),
    cls: fill(TERRAIN_CLASS.GRASS),
    slope: fill(3),
    cover: fill(12),
    concealment: fill(25),
    moveCost: fill(22),
    visibility: fill(40),
    vehicleMobility: fill(70),
    ambush: fill(10),
    ...overrides,
  }
}

/** Centre of cell (x, y). */
function at(grid: GridData, x: number, y: number) {
  return {
    longitude: BBOX.west + ((x + 0.5) / grid.width) * (BBOX.east - BBOX.west),
    latitude: BBOX.north - ((y + 0.5) / grid.height) * (BBOX.north - BBOX.south),
  }
}

describe('buildTerrainBrief', () => {
  test('uniform ground reports one class at 100%', () => {
    const brief = buildTerrainBrief(makeGrid(10))
    expect(brief.composition).toHaveLength(1)
    expect(brief.composition[0]).toMatchObject({ name: 'Grassland', percent: 100 })
  })

  test('composition is ordered largest share first', () => {
    const grid = makeGrid(10)
    // 30 cells of forest over grass
    for (let i = 0; i < 30; i++) grid.cls[i] = TERRAIN_CLASS.FOREST
    const brief = buildTerrainBrief(grid)
    expect(brief.composition[0].name).toBe('Grassland')
    expect(brief.composition[1].name).toBe('Dense Forest')
    expect(brief.composition[1].percent).toBe(30)
  })

  test('relief is the span between lowest and highest ground', () => {
    const grid = makeGrid(10)
    grid.elevation[0] = 50
    grid.elevation[99] = 250
    const brief = buildTerrainBrief(grid)
    expect(brief.elevation).toMatchObject({ min: 50, max: 250, relief: 200 })
  })

  test('water share is reported separately from composition', () => {
    const grid = makeGrid(10)
    for (let i = 0; i < 10; i++) grid.cls[i] = TERRAIN_CLASS.WATER
    expect(buildTerrainBrief(grid).waterPercent).toBe(10)
  })

  test('vehicle going counts only cells a vehicle can actually cross', () => {
    const grid = makeGrid(10, { vehicleMobility: new Uint8Array(100).fill(0) })
    for (let i = 0; i < 25; i++) grid.vehicleMobility[i] = 80
    expect(buildTerrainBrief(grid).vehicleGoingPercent).toBe(25)
  })

  test('area comes from cell count and cell size', () => {
    const grid = makeGrid(10)
    grid.cellMeters = 100 // 10x10 cells of 100 m = 1 km²
    expect(buildTerrainBrief(grid).areaKm2).toBe(1)
  })
})

describe('terrain observations', () => {
  test('a dominant class is called out by name', () => {
    const grid = makeGrid(10, { cls: new Uint8Array(100).fill(TERRAIN_CLASS.FOREST) })
    const brief = buildTerrainBrief(grid)
    expect(brief.observations.join(' ')).toContain('Dense Forest dominates')
  })

  test('strong relief warns about dead ground', () => {
    const grid = makeGrid(10)
    grid.elevation[0] = 100
    grid.elevation[99] = 300
    expect(buildTerrainBrief(grid).observations.join(' ')).toContain('defilade')
  })

  test('flat ground says so rather than staying silent', () => {
    expect(buildTerrainBrief(makeGrid(10)).observations.join(' ')).toContain('flat')
  })

  test('significant water prompts a crossing check', () => {
    const grid = makeGrid(10)
    for (let i = 0; i < 20; i++) grid.cls[i] = TERRAIN_CLASS.WATER
    expect(buildTerrainBrief(grid).observations.join(' ')).toContain('crossings')
  })

  test('exposed ground is flagged when concealment is low', () => {
    const grid = makeGrid(10, {
      visibility: new Uint8Array(100).fill(85),
      concealment: new Uint8Array(100).fill(10),
    })
    expect(buildTerrainBrief(grid).observations.join(' ')).toContain('movement will be seen')
  })

  test('poor vehicle going is flagged', () => {
    const grid = makeGrid(10, { vehicleMobility: new Uint8Array(100).fill(0) })
    expect(buildTerrainBrief(grid).observations.join(' ')).toContain('Vehicle going is poor')
  })
})

describe('computeViewshed', () => {
  test('on flat ground everything within range is visible', () => {
    const grid = makeGrid(21)
    const result = computeViewshed(grid, at(grid, 10, 10), 1000)
    expect(result.coveragePercent).toBe(100)
    expect(result.origin).toEqual({ x: 10, y: 10 })
  })

  test('the observer always sees its own cell', () => {
    const grid = makeGrid(11)
    const result = computeViewshed(grid, at(grid, 5, 5), 1000)
    expect(result.visible[5 * 11 + 5]).toBe(1)
  })

  test('a ridge hides the ground directly behind it', () => {
    const grid = makeGrid(21)
    // A tall north-south wall at x = 12, observer to its west at x = 10.
    for (let y = 0; y < 21; y++) grid.elevation[y * 21 + 12] = 400

    const result = computeViewshed(grid, at(grid, 10, 10), 2000)
    // The wall itself is visible; ground beyond it on the same row is not.
    expect(result.visible[10 * 21 + 12]).toBe(1)
    expect(result.visible[10 * 21 + 15]).toBe(0)
    expect(result.visible[10 * 21 + 20]).toBe(0)
    // Ground short of the wall is still seen.
    expect(result.visible[10 * 21 + 11]).toBe(1)
    expect(result.coveragePercent).toBeLessThan(100)
  })

  test('standing on high ground sees over a lower ridge', () => {
    const grid = makeGrid(21)
    for (let y = 0; y < 21; y++) grid.elevation[y * 21 + 12] = 130
    // Observer on a hill well above the ridge line.
    grid.elevation[10 * 21 + 10] = 400

    const result = computeViewshed(grid, at(grid, 10, 10), 2000)
    expect(result.visible[10 * 21 + 15]).toBe(1)
  })

  test('range limits what is considered at all', () => {
    const grid = makeGrid(21)
    const near = computeViewshed(grid, at(grid, 10, 10), grid.cellMeters * 2)
    const far = computeViewshed(grid, at(grid, 10, 10), grid.cellMeters * 10)
    expect(near.visibleCells).toBeLessThan(far.visibleCells)
  })

  test('an observer off the battlefield reports no origin and sees nothing', () => {
    const grid = makeGrid(10)
    const result = computeViewshed(grid, { longitude: 50, latitude: 50 }, 500)
    expect(result.origin).toBeNull()
    expect(result.visibleCells).toBe(0)
    expect(result.coveragePercent).toBe(0)
  })
})
