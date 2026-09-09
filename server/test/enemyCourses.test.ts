import { describe, expect, test } from 'bun:test'
import { enemyCoursesBody, unknownIntentObjectiveIds } from '../src/routes/routeStudies'

const body = (intent: Record<string, unknown> = {}) => ({ intent })

describe('enemyCoursesBody', () => {
  test('accepts a full intent', () => {
    const parsed = enemyCoursesBody.safeParse(
      body({ objective_ids: ['obj1'], narrative: 'They want the bridge.' }),
    )

    expect(parsed.success).toBe(true)
  })

  test('no named objectives means every objective is in play', () => {
    expect(enemyCoursesBody.parse(body()).intent.objective_ids).toEqual([])
  })

  test('narrative defaults to empty rather than being required', () => {
    expect(enemyCoursesBody.parse(body()).intent.narrative).toBe('')
  })

  test('strips the retired posture field from older clients', () => {
    expect(enemyCoursesBody.parse(body({ posture: 'attacking' })).intent).toEqual({
      objective_ids: [],
      narrative: '',
    })
  })

  test('caps the narrative so a paste cannot blow out the prompt', () => {
    expect(enemyCoursesBody.safeParse(body({ narrative: 'x'.repeat(4001) })).success).toBe(false)
  })

  test('rejects blank, duplicate, and oversized objective selections', () => {
    expect(enemyCoursesBody.safeParse(body({ objective_ids: [''] })).success).toBe(false)
    expect(enemyCoursesBody.safeParse(body({ objective_ids: ['obj1', 'obj1'] })).success).toBe(false)
    expect(enemyCoursesBody.safeParse(body({
      objective_ids: Array.from({ length: 101 }, (_, index) => `obj${index}`),
    })).success)
      .toBe(false)
  })

  test('requires an intent object at all', () => {
    expect(enemyCoursesBody.safeParse({}).success).toBe(false)
  })
})

describe('unknownIntentObjectiveIds', () => {
  const objectives = [
    { id: 'obj1', name: 'Bridge', lon: 1, lat: 2 },
    { id: 'obj2', name: 'Depot', lon: 2, lat: 3 },
  ]

  test('accepts selected objectives belonging to the study', () => {
    expect(unknownIntentObjectiveIds({ objective_ids: ['obj2'], narrative: '' }, objectives))
      .toEqual([])
  })

  test('returns unknown objective ids once and deterministically', () => {
    expect(unknownIntentObjectiveIds(
      { objective_ids: ['z', 'obj1', 'a', 'z'], narrative: '' },
      objectives,
    )).toEqual(['a', 'z'])
  })
})
