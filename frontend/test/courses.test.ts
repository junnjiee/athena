import { describe, expect, test } from 'bun:test'
import {
  POSTURE_LABEL,
  WEIGHT_LABEL,
  courseEmphasis,
  courseTags,
  emptyIntent,
  formatScore,
  intentIsEmpty,
  rejectedSummary,
  weightBias,
} from '../src/lib/courses'
import type { CourseOfAction, RankedCourses } from '../src/types/routeStudy'

function course(name: string, overrides: Partial<CourseOfAction> = {}): CourseOfAction {
  return {
    name,
    narrative: 'Pushes armour down the valley while fixing the ridge.',
    efforts: [
      { kind: 'main', corridor_id: 'cor_a', reserve_id: 'res1', rationale: 'fastest' },
      { kind: 'supporting', corridor_id: 'cor_b', reserve_id: 'res1', rationale: 'fixes' },
    ],
    likelihood: 0.72,
    danger: 0.4,
    ...overrides,
  }
}

describe('courseEmphasis', () => {
  test('maps each corridor to the effort riding on it', () => {
    expect(courseEmphasis(course('Valley thrust'))).toEqual(
      new Map([
        ['cor_a', 'main'],
        ['cor_b', 'supporting'],
      ]),
    )
  })

  test('a main effort outranks a supporting one on shared ground', () => {
    const shared = course('Double', {
      efforts: [
        { kind: 'supporting', corridor_id: 'cor_a', reserve_id: 'res2', rationale: '' },
        { kind: 'main', corridor_id: 'cor_a', reserve_id: 'res1', rationale: '' },
      ],
    })
    expect(courseEmphasis(shared).get('cor_a')).toBe('main')
  })

  test('no course means no emphasis', () => {
    expect(courseEmphasis(null).size).toBe(0)
  })
})

describe('courseTags', () => {
  test('names the doctrinal pair a commander reads first', () => {
    const likely = course('Likely')
    const dangerous = course('Dangerous')
    const ranked: RankedCourses = {
      courses: [likely, dangerous],
      most_likely: likely,
      most_dangerous: dangerous,
      rejected: [],
    }
    expect(courseTags(ranked, likely)).toEqual(['most likely'])
    expect(courseTags(ranked, dangerous)).toEqual(['most dangerous'])
  })

  test('one course can be both', () => {
    const only = course('Only')
    const ranked: RankedCourses = {
      courses: [only],
      most_likely: only,
      most_dangerous: only,
      rejected: [],
    }
    expect(courseTags(ranked, only)).toEqual(['most likely', 'most dangerous'])
  })
})

describe('formatScore', () => {
  test('reads as a percentage, because the model scored on a scale', () => {
    expect(formatScore(0.72)).toBe('72%')
    expect(formatScore(0)).toBe('0%')
    expect(formatScore(1)).toBe('100%')
  })
})

describe('intent', () => {
  test('an empty intent leaves the model nothing but geography', () => {
    expect(intentIsEmpty(emptyIntent())).toBe(true)
    expect(intentIsEmpty({ posture: 'attacking', objective_ids: [], narrative: '' })).toBe(false)
    expect(intentIsEmpty({ posture: 'unknown', objective_ids: [], narrative: 'Probing.' })).toBe(false)
    expect(intentIsEmpty({ posture: 'unknown', objective_ids: ['obj1'], narrative: '' })).toBe(false)
  })

  test('every posture the engine accepts has a label', () => {
    expect(Object.keys(POSTURE_LABEL)).toEqual([
      'attacking',
      'defending',
      'delaying',
      'withdrawing',
      'unknown',
    ])
  })
})

describe('rejectedSummary', () => {
  test('says which course named ground that does not exist', () => {
    expect(
      rejectedSummary([
        { course_name: 'Ghost push', corridor_id: 'cor_z', reason: 'unknown corridor' },
      ]),
    ).toEqual(['Ghost push — cor_z: unknown corridor'])
  })

  test('falls back to the reserve when no corridor was named', () => {
    expect(
      rejectedSummary([{ course_name: 'Ghost', reserve_id: 'res_z', reason: 'unknown reserve' }]),
    ).toEqual(['Ghost — res_z: unknown reserve'])
  })
})

describe('weightBias', () => {
  test('neutral weights read as unlearned', () => {
    expect(weightBias(0.5)).toBe('neutral')
  })

  test('drift away from neutral is named in both directions', () => {
    expect(weightBias(0.8)).toBe('favours')
    expect(weightBias(0.2)).toBe('discounts')
  })

  test('every learned axis has a label', () => {
    expect(Object.keys(WEIGHT_LABEL).sort()).toEqual([
      'blockable',
      'complexity',
      'danger',
      'likelihood',
      'speed',
    ])
  })
})
