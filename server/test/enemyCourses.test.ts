import { describe, expect, test } from 'bun:test'
import { enemyCoursesBody } from '../src/routes/routeStudies'

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

  test('requires an intent object at all', () => {
    expect(enemyCoursesBody.safeParse({}).success).toBe(false)
  })
})
