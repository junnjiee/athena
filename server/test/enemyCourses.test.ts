import { describe, expect, test } from 'bun:test'
import { enemyCoursesBody } from '../src/routes/routeStudies'

const body = (intent: Record<string, unknown> = {}) => ({ intent })

describe('enemyCoursesBody', () => {
  test('accepts a full intent', () => {
    const parsed = enemyCoursesBody.safeParse(
      body({ posture: 'attacking', objective_ids: ['obj1'], narrative: 'They want the bridge.' }),
    )

    expect(parsed.success).toBe(true)
  })

  test('an unstated posture is unknown rather than assumed', () => {
    // Guessing "attacking" would put words in the S2's mouth.
    expect(enemyCoursesBody.parse(body()).intent.posture).toBe('unknown')
  })

  test('no named objectives means every objective is in play', () => {
    expect(enemyCoursesBody.parse(body()).intent.objective_ids).toEqual([])
  })

  test('narrative defaults to empty rather than being required', () => {
    expect(enemyCoursesBody.parse(body()).intent.narrative).toBe('')
  })

  test('rejects a posture the engine does not model', () => {
    expect(enemyCoursesBody.safeParse(body({ posture: 'encircling' })).success).toBe(false)
  })

  test('caps the narrative so a paste cannot blow out the prompt', () => {
    expect(enemyCoursesBody.safeParse(body({ narrative: 'x'.repeat(4001) })).success).toBe(false)
  })

  test('requires an intent object at all', () => {
    expect(enemyCoursesBody.safeParse({}).success).toBe(false)
  })
})
