import { describe, expect, test } from 'bun:test'
import { needsResearch } from '../src/routes/routeStudies'
import type { StudyMarks } from '../src/db/studyTypes'

const MARKS: StudyMarks = {
  reserves: [{ id: 'r1', name: 'Assembly', lon: 0, lat: 0 }],
  objectives: [{ id: 'o1', name: 'Bridge', lon: 1, lat: 0 }],
}

const current = { marks: MARKS, edgeOverrides: ['1:0'] }

describe('needsResearch', () => {
  test('renaming a corridor does not re-run the search', () => {
    // Re-running would churn corridor identity, which is what the operator's
    // own edits are keyed on.
    expect(needsResearch(current, {})).toBe(false)
  })

  test('moving a mark re-runs it', () => {
    const moved: StudyMarks = {
      ...MARKS,
      objectives: [{ id: 'o1', name: 'Bridge', lon: 2, lat: 0 }],
    }
    expect(needsResearch(current, { marks: moved })).toBe(true)
  })

  test('adding a reserve re-runs it', () => {
    const extra: StudyMarks = {
      ...MARKS,
      reserves: [...MARKS.reserves, { id: 'r2', name: 'Depot', lon: 0.5, lat: 0.5 }],
    }
    expect(needsResearch(current, { marks: extra })).toBe(true)
  })

  test('marking ground impassable re-runs it', () => {
    expect(needsResearch(current, { edgeOverrides: ['1:0', '2:0'] })).toBe(true)
  })

  test('restoring ground re-runs it', () => {
    expect(needsResearch(current, { edgeOverrides: [] })).toBe(true)
  })

  test('the same overrides in another order do not', () => {
    expect(needsResearch({ ...current, edgeOverrides: ['a', 'b'] }, { edgeOverrides: ['b', 'a'] })).toBe(
      false,
    )
  })

  test('resubmitting identical marks does not', () => {
    expect(needsResearch(current, { marks: MARKS, edgeOverrides: ['1:0'] })).toBe(false)
  })
})
