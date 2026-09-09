import { describe, expect, test } from 'bun:test'
import { feedbackBody } from '../src/routes/routeStudies'
import { NEUTRAL_WEIGHTS } from '../src/services/engineClient'

describe('feedbackBody', () => {
  test('accepts a verdict on a named course', () => {
    expect(feedbackBody.safeParse({ courseName: 'Northern push', verdict: 'accepted' }).success).toBe(
      true,
    )
  })

  test('rejects a verdict the engine does not model', () => {
    expect(feedbackBody.safeParse({ courseName: 'X', verdict: 'maybe' }).success).toBe(false)
  })

  test('requires a course to attach the verdict to', () => {
    expect(feedbackBody.safeParse({ verdict: 'accepted' }).success).toBe(false)
  })

  test('will not accept an empty course name', () => {
    expect(feedbackBody.safeParse({ courseName: '', verdict: 'rejected' }).success).toBe(false)
  })
})

describe('NEUTRAL_WEIGHTS', () => {
  test('every axis starts neutral, so a fresh deployment ranks doctrinally', () => {
    expect(Object.values(NEUTRAL_WEIGHTS).every((w) => w === 0.5)).toBe(true)
  })

  test('covers exactly the axes the engine learns over', () => {
    // A weight the engine does not know silently does nothing; one it expects
    // and does not get would be read as zero, which is not neutral.
    expect(Object.keys(NEUTRAL_WEIGHTS).sort()).toEqual([
      'blockable',
      'complexity',
      'danger',
      'likelihood',
      'speed',
    ])
  })
})
