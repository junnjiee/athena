import { describe, expect, test } from 'bun:test'
import type { Corridor, StudyResult } from '../src/db/studyTypes'
import { corridorGroundOverlap, reattachCorridorEdits } from '../src/services/corridorEdits'

function corridor(id: string, edgeIds: string[]): Corridor {
  return {
    id,
    routes: [{
      reserve_id: 'r1',
      objective_id: 'o1',
      edge_ids: edgeIds,
      node_ids: edgeIds.map((_, index) => index),
      seconds: 60,
      length_meters: 100,
    }],
    choke_edge_ids: [],
    fastest_seconds: 60,
  }
}

function result(...corridors: Corridor[]): StudyResult {
  return { corridors, unreachable: [] }
}

describe('corridor edit reattachment', () => {
  test('measures shared ground as Jaccard overlap', () => {
    expect(corridorGroundOverlap(corridor('old', ['a', 'b', 'c']), corridor('new', ['a', 'b', 'd'])))
      .toBe(0.5)
  })

  test('keeps an unchanged corridor id without inventing reattachment provenance', () => {
    const edits = reattachCorridorEdits(
      result(corridor('same', ['a', 'b'])),
      result(corridor('same', ['a', 'b'])),
      { same: { name: 'COBRA' } },
      1,
      2,
    )

    expect(edits).toEqual({ same: { name: 'COBRA' } })
  })

  test('carries an edit onto the strongest defensible revision match', () => {
    const edits = reattachCorridorEdits(
      result(corridor('old', ['a', 'b', 'c'])),
      result(corridor('weak', ['a', 'x', 'y']), corridor('new', ['a', 'b', 'c', 'd'])),
      { old: { name: 'COBRA', category: 'primary' } },
      4,
      5,
    )

    expect(edits).toEqual({
      new: {
        name: 'COBRA',
        category: 'primary',
        reattachment: {
          from_corridor_id: 'old',
          from_revision: 4,
          to_revision: 5,
          overlap: 0.75,
        },
      },
    })
  })

  test('drops an edit when every candidate is below the safety floor', () => {
    const edits = reattachCorridorEdits(
      result(corridor('old', ['a', 'b', 'c'])),
      result(corridor('unrelated', ['a', 'x', 'y'])),
      { old: { name: 'Do not mislabel' } },
      1,
      2,
    )

    expect(edits).toEqual({})
  })

  test('never attaches two old corridor edits to one new corridor', () => {
    const edits = reattachCorridorEdits(
      result(corridor('old-a', ['a', 'b']), corridor('old-b', ['a', 'b', 'c'])),
      result(corridor('new', ['a', 'b', 'c'])),
      { 'old-a': { name: 'Weaker' }, 'old-b': { name: 'Stronger' } },
      1,
      2,
    )

    expect(edits.new?.name).toBe('Stronger')
    expect(Object.keys(edits)).toHaveLength(1)
  })
})
