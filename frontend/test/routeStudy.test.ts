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
    store().addMark('reserve', 0, 0, 'Depot')

    expect(store().draftMarks.reserves[0].name).toBe('Depot')
  })

  test('marks get distinct ids', () => {
    store().addMark('reserve', 0, 0)
    store().addMark('reserve', 1, 1)
    const [first, second] = store().draftMarks.reserves

    expect(first.id).not.toBe(second.id)
  })

  test('removing one leaves the others alone', () => {
    store().addMark('reserve', 0, 0, 'Keep')
    store().addMark('reserve', 1, 1, 'Drop')
    const drop = store().draftMarks.reserves[1]

    store().removeMark('reserve', drop.id)

    expect(store().draftMarks.reserves.map((m) => m.name)).toEqual(['Keep'])
  })

  test('removing a reserve never touches objectives', () => {
    store().addMark('reserve', 0, 0)
    store().addMark('objective', 0, 0)
    const reserve = store().draftMarks.reserves[0]

    store().removeMark('reserve', reserve.id)

    expect(store().draftMarks.objectives).toHaveLength(1)
  })

  test('renaming changes only the named mark', () => {
    store().addMark('objective', 0, 0)
    store().addMark('objective', 1, 1)
    const first = store().draftMarks.objectives[0]

    store().renameMark('objective', first.id, 'Bridge')

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
