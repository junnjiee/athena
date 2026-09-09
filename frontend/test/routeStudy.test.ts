import { beforeEach, describe, expect, test } from 'bun:test'
import { useRouteStudy } from '../src/state/routeStudy'

const store = () => useRouteStudy.getState()

beforeEach(() => {
  store().reset()
})

describe('placing marks', () => {
  test('a reserve and an objective are kept apart', () => {
    store().addMark('reserve', 1, 2)
    store().addMark('objective', 3, 4)
    expect(store().draftMarks.reserves).toHaveLength(1)
    expect(store().draftMarks.objectives).toHaveLength(1)
    expect(store().draftMarks.reserves[0].lon).toBe(1)
  })

  test('marks are numbered per kind, not globally', () => {
    store().addMark('reserve', 0, 0)
    store().addMark('objective', 0, 0)
    store().addMark('reserve', 0, 0)
    expect(store().draftMarks.reserves.map((m) => m.name)).toEqual(['Reserve 1', 'Reserve 2'])
    expect(store().draftMarks.objectives.map((m) => m.name)).toEqual(['Objective 1'])
  })

  test('an explicit name wins over the fallback', () => {
    store().addMark('reserve', 0, 0, { name: 'Depot' })
    expect(store().draftMarks.reserves[0].name).toBe('Depot')
  })

  test('new reserves start assessed until the operator confirms two sources', () => {
    store().addMark('reserve', 0, 0)
    expect(store().draftMarks.reserves[0].intelligence_status).toBe('assessed')
  })

  test('reserve intelligence fields update without moving the mark', () => {
    const id = store().addMark('reserve', 1, 2)
    store().updateMark('reserve', id, {
      level: 'K3',
      owning_formation: '1/903',
      intelligence_status: 'confirmed',
      locality: 'TOMA 1b',
    })
    expect(store().draftMarks.reserves[0]).toMatchObject({
      lon: 1,
      lat: 2,
      level: 'K3',
      owning_formation: '1/903',
      intelligence_status: 'confirmed',
      locality: 'TOMA 1b',
    })
  })

  test('a reserve keeps structured task organisation and explicit order of move', () => {
    const id = store().addMark('reserve', 1, 2)
    store().updateMark('reserve', id, {
      task_organization: [
        {
          id: 'drc',
          designation: 'DRC',
          echelon: 'company',
          modifier: 'full',
          order_of_move: 1,
          platforms: [{ id: 'btr', platform: 'BTR-90', establishment_count: 10 }],
        },
        {
          id: 'abg',
          designation: 'ABG',
          echelon: 'battalion',
          modifier: '-',
          order_of_move: 2,
          platforms: [],
        },
      ],
    })

    expect(store().draftMarks.reserves[0].task_organization?.map((element) => element.designation))
      .toEqual(['DRC', 'ABG'])
  })

  test('a reserve keeps normalized doctrinal timing stages', () => {
    const id = store().addMark('reserve', 1, 2)
    store().updateMark('reserve', id, {
      timing: { decision_minutes: 5, readiness_minutes: 10.5, deployment_minutes: 15 },
    })

    expect(store().draftMarks.reserves[0].timing).toEqual({
      decision_minutes: 5,
      readiness_minutes: 10.5,
      deployment_minutes: 15,
    })
  })

  test('an objective drawn as ground keeps its bounds', () => {
    const bbox = { west: 1, south: 2, east: 3, north: 4 }
    store().addMark('objective', 2, 3, { bbox })
    expect(store().draftMarks.objectives[0].bbox).toEqual(bbox)
  })

  test('an objective clicked as a point carries no bounds', () => {
    store().addMark('objective', 2, 3)
    expect(store().draftMarks.objectives[0].bbox).toBeUndefined()
  })

  test('the mark just placed is the one the panel calls out', () => {
    store().addMark('reserve', 0, 0)
    expect(store().lastMarkId).toBe(store().draftMarks.reserves[0].id)
    store().clearLastMark()
    expect(store().lastMarkId).toBeNull()
  })

  test('marks get distinct ids', () => {
    store().addMark('reserve', 0, 0)
    store().addMark('reserve', 1, 1)
    const [first, second] = store().draftMarks.reserves
    expect(first.id).not.toBe(second.id)
  })

  test('removing one leaves the others alone', () => {
    store().addMark('reserve', 0, 0, { name: 'Keep' })
    store().addMark('reserve', 1, 1, { name: 'Drop' })
    store().removeMark('reserve', store().draftMarks.reserves[1].id)
    expect(store().draftMarks.reserves.map((m) => m.name)).toEqual(['Keep'])
  })

  test('removing a reserve never touches objectives', () => {
    store().addMark('reserve', 0, 0)
    store().addMark('objective', 0, 0)
    store().removeMark('reserve', store().draftMarks.reserves[0].id)
    expect(store().draftMarks.objectives).toHaveLength(1)
  })

  test('renaming changes only the named mark', () => {
    store().addMark('objective', 0, 0)
    store().addMark('objective', 1, 1)
    store().renameMark('objective', store().draftMarks.objectives[0].id, 'Bridge')
    expect(store().draftMarks.objectives.map((m) => m.name)).toEqual(['Bridge', 'Objective 2'])
  })

  test('clearing the draft empties both lists', () => {
    store().addMark('reserve', 0, 0)
    store().addMark('objective', 0, 0)
    store().clearDraft()
    expect(store().draftMarks).toEqual({ reserves: [], objectives: [] })
  })
})

describe('corridor selection', () => {
  test('selects and deselects', () => {
    store().selectCorridor('cor_a')
    expect(store().selectedCorridorId).toBe('cor_a')
    store().selectCorridor(null)
    expect(store().selectedCorridorId).toBeNull()
  })
})

describe('reset', () => {
  test('returns the store to idle', () => {
    store().addMark('reserve', 0, 0)
    store().selectCorridor('cor_a')
    store().reset()
    expect(store().phase).toBe('idle')
    expect(store().study).toBeNull()
    expect(store().selectedCorridorId).toBeNull()
    expect(store().draftMarks.reserves).toEqual([])
  })
})

describe('editing without a study loaded', () => {
  test('renaming a corridor is a no-op rather than a crash', async () => {
    await store().renameCorridor('cor_a', 'Northern valley')
    expect(store().study).toBeNull()
  })
})
