import { describe, expect, test } from 'bun:test'
import { cellCenter, type GridGeo } from '../src/lib/cells'
import { packGrid } from '../src/services/grid'
import { buildPlanBrief, type MovementDrawing, type ObjectiveDrawing, type DeploymentDrawing } from '../src/services/planBrief'
import { TERRAIN_CLASS, type GridChannels } from '../src/types'
import type { PlacedObjective, PlacedRoute, PlacedUnit } from '../src/db/planTypes'

/** Same 10×10 / 11.132 m-per-cell equatorial grid the cell math is tested on. */
const GEO: GridGeo = {
  bbox: { west: 0, south: 0, east: 0.001, north: 0.001 },
  width: 10,
  height: 10,
  cellMeters: 11.132,
}
const N = GEO.width * GEO.height

/** Uniform terrain, so every mean is exact and any deviation in a summary can
 *  only have come from the cells the drawing actually covers. */
function makeChannels(overrides: Partial<Record<number, number>> = {}): GridChannels {
  const fill = (v: number) => new Uint8Array(N).fill(v)
  const cls = fill(TERRAIN_CLASS.OPEN)
  for (const [index, value] of Object.entries(overrides)) cls[Number(index)] = value as number
  return {
    height: Float32Array.from({ length: N }, (_, i) => 100 + i),
    cls,
    slope: fill(4),
    cover: fill(10),
    concealment: fill(20),
    moveCost: fill(30), // ×1.5
    visibility: fill(40),
    vehicleMobility: fill(50),
    ambush: fill(60),
  }
}

function battleground(channels: GridChannels) {
  return {
    id: 'bg-1',
    name: 'Test Ground',
    bbox: GEO.bbox,
    width: GEO.width,
    height: GEO.height,
    cellMeters: GEO.cellMeters,
    weather: null,
    gridBuffer: packGrid(channels, GEO.width, GEO.height, GEO.cellMeters),
  }
}

function brief(
  parts: { units?: PlacedUnit[]; objectives?: PlacedObjective[]; routes?: PlacedRoute[] },
  channels: GridChannels = makeChannels(),
) {
  return buildPlanBrief({
    plan: {
      id: 'plan-1',
      name: 'Hill Assault',
      units: parts.units ?? [],
      objectives: parts.objectives ?? [],
      routes: parts.routes ?? [],
    },
    battleground: battleground(channels),
  })
}

function unit(overrides: Partial<PlacedUnit> = {}): PlacedUnit {
  return {
    id: 'u1',
    side: 'blue',
    name: 'Alpha',
    typeLabel: 'Blue Force Section',
    position: cellCenter(GEO, 2, 3),
    symbolKind: 'blueSection',
    rotationRadians: 0,
    ...overrides,
  }
}

function route(overrides: Partial<PlacedRoute> = {}): PlacedRoute {
  return {
    id: 'r1',
    side: 'red',
    startUnitId: 'u1',
    points: [cellCenter(GEO, 0, 5), cellCenter(GEO, 9, 5)],
    endRef: null,
    movementType: 'charge',
    loadout: { bodyMassKg: 75, loadMassKg: 25, preset: 'fighting' },
    ...overrides,
  }
}

describe('battleground envelope', () => {
  test('reports the grid dimensions and the cell-space convention', () => {
    const result = brief({})
    expect(result.planId).toBe('plan-1')
    expect(result.planName).toBe('Hill Assault')
    expect(result.battleground.width).toBe(10)
    expect(result.battleground.height).toBe(10)
    expect(result.battleground.widthMeters).toBeCloseTo(111.32, 2)
    expect(result.cellSpace).toMatchObject({ origin: 'north-west', order: 'row-major' })
  })
})

describe('what kind of drawing is it', () => {
  test('a placed section is a side-tagged deployment', () => {
    const [drawing] = brief({ units: [unit()] }).drawings as DeploymentDrawing[]
    expect(drawing.kind).toBe('deployment')
    expect(drawing.label).toBe('blue section deployment')
    expect(drawing.side).toBe('blue')
    expect(drawing.echelon).toBe('section')
  })

  test('a red platoon reads as a red platoon deployment', () => {
    const [drawing] = brief({
      units: [unit({ side: 'red', symbolKind: 'redPlatoon', typeLabel: 'Red Force Platoon' })],
    }).drawings as DeploymentDrawing[]
    expect(drawing.label).toBe('red platoon deployment')
    expect(drawing.echelon).toBe('platoon')
  })

  test('a unit placed from an ORBAT template carries its establishment', () => {
    const [drawing] = brief({
      units: [unit({ templateId: 'tmpl-1', strength: 7, visionRangeM: 300 })],
    }).drawings as DeploymentDrawing[]
    expect(drawing.establishment).toEqual({ strength: 7, visionRangeM: 300 })
  })

  test('a unit with no template has no establishment, so the engine defaults', () => {
    const [drawing] = brief({ units: [unit()] }).drawings as DeploymentDrawing[]
    expect(drawing.establishment).toBeNull()
  })

  test('a half-specified establishment is treated as none rather than guessed', () => {
    const [drawing] = brief({
      units: [unit({ strength: 7 })],
    }).drawings as DeploymentDrawing[]
    expect(drawing.establishment).toBeNull()
  })

  test('trenches are fortifications, not troop deployments', () => {
    const drawings = brief({
      units: [
        unit({ id: 't1', symbolKind: 'trench', side: 'red' }),
        unit({ id: 't2', symbolKind: 'preparedTrench', side: 'red' }),
      ],
    }).drawings as DeploymentDrawing[]
    expect(drawings.map((d) => d.kind)).toEqual(['fortification', 'fortification'])
    expect(drawings.map((d) => d.label)).toEqual([
      'trench fortification',
      'prepared trench fortification',
    ])
    expect(drawings.every((d) => d.echelon === 'position')).toBe(true)
  })

  test('a drawn route is a side-tagged movement arrow carrying its gait', () => {
    const [drawing] = brief({ routes: [route()] }).drawings as MovementDrawing[]
    expect(drawing.kind).toBe('movement')
    expect(drawing.label).toBe('red movement arrow (charge)')
    expect(drawing.movementType).toBe('charge')
    expect(drawing.loadout.loadMassKg).toBe(25)
  })
})

describe('which part of the terrain is it over', () => {
  test('a marker resolves to its grid cell and that cell’s military properties', () => {
    const [drawing] = brief({ units: [unit()] }).drawings as DeploymentDrawing[]
    expect(drawing.cell).not.toBeNull()
    expect(drawing.cell).toMatchObject({ x: 2, y: 3, index: 32 })
    expect(drawing.cell?.terrain).toMatchObject({
      clsName: 'Open Ground',
      cover: 10,
      concealment: 20,
      visibility: 40,
      moveCostFactor: 1.5,
      slopeDeg: 4,
      elevationM: 132,
    })
  })

  test('a marker dropped outside the battleground has no cell', () => {
    const [drawing] = brief({
      units: [unit({ position: { longitude: 0.005, latitude: 0.0005 } })],
    }).drawings as DeploymentDrawing[]
    expect(drawing.cell).toBeNull()
  })

  test('a movement arrow resolves to the ordered cells it crosses', () => {
    const [drawing] = brief({ routes: [route()] }).drawings as MovementDrawing[]
    expect(drawing.path.map((c) => c.x)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])
    expect(drawing.path.every((c) => c.y === 5)).toBe(true)
    expect(drawing.path[0].terrain.clsName).toBe('Open Ground')
    expect(drawing.lengthMeters).toBeCloseTo(9 * 11.132, 0)
  })

  test('an objective resolves to its centre cell and its ground footprint', () => {
    const objective: PlacedObjective = {
      id: 'o1',
      name: 'OBJ ALPHA',
      description: 'Capture & Hold',
      position: cellCenter(GEO, 5, 5),
      radiusMeters: 12,
    }
    const [drawing] = brief({ objectives: [objective] }).drawings as ObjectiveDrawing[]
    expect(drawing.kind).toBe('objective')
    expect(drawing.cell).toMatchObject({ x: 5, y: 5, index: 55 })
    expect(drawing.footprintCells).toHaveLength(5)
    expect(drawing.footprint.cellCount).toBe(5)
    expect(drawing.footprint.dominantClass).toBe('Open Ground')
  })
})

describe('terrain summaries', () => {
  test('a corridor over uniform ground averages to that ground', () => {
    const [drawing] = brief({ routes: [route()] }).drawings as MovementDrawing[]
    expect(drawing.corridor).toMatchObject({
      cellCount: 10,
      meanCover: 10,
      meanConcealment: 20,
      meanVisibility: 40,
      meanMoveCostFactor: 1.5,
      maxSlopeDeg: 4,
      crossesWater: false,
      dominantClass: 'Open Ground',
    })
  })

  test('a corridor crossing water is flagged and counted by class', () => {
    // cell (4, 5) -> index 54, straddling the eastward route above
    const [drawing] = brief({ routes: [route()] }, makeChannels({ 54: TERRAIN_CLASS.WATER }))
      .drawings as MovementDrawing[]
    expect(drawing.corridor.crossesWater).toBe(true)
    expect(drawing.corridor.classCounts).toEqual({ 'Open Ground': 9, Water: 1 })
    expect(drawing.corridor.dominantClass).toBe('Open Ground')
  })

  test('elevation range spans the cells actually covered', () => {
    const [drawing] = brief({ routes: [route()] }).drawings as MovementDrawing[]
    // row 5 = indices 50..59, height = 100 + index
    expect(drawing.corridor.minElevationM).toBe(150)
    expect(drawing.corridor.maxElevationM).toBe(159)
  })

  test('a drawing entirely off the grid summarizes to nothing rather than NaN', () => {
    const [drawing] = brief({
      routes: [
        route({
          points: [
            { longitude: 0.005, latitude: 0.005 },
            { longitude: 0.006, latitude: 0.005 },
          ],
        }),
      ],
    }).drawings as MovementDrawing[]
    expect(drawing.path).toEqual([])
    expect(drawing.corridor.cellCount).toBe(0)
    expect(drawing.corridor.dominantClass).toBeNull()
    expect(Number.isNaN(drawing.corridor.meanCover)).toBe(false)
  })
})

describe('drawing set', () => {
  test('every drawn element appears exactly once, keyed by its own id', () => {
    const result = brief({
      units: [unit({ id: 'u1' }), unit({ id: 'u2', symbolKind: 'trench', side: 'red' })],
      objectives: [
        {
          id: 'o1',
          name: 'OBJ ALPHA',
          description: '',
          position: cellCenter(GEO, 5, 5),
          radiusMeters: 12,
        },
      ],
      routes: [route({ id: 'r1' })],
    })
    expect(result.drawings.map((d) => d.id)).toEqual(['u1', 'u2', 'o1', 'r1'])
    expect(result.drawings.map((d) => d.kind)).toEqual([
      'deployment',
      'fortification',
      'objective',
      'movement',
    ])
  })
})
