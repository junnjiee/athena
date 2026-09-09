import { describe, expect, test } from 'bun:test'
import { needsResearch, objectiveMarkSchema, reserveMarkSchema } from '../src/routes/routeStudies'
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

  test('reserve intelligence edits persist without re-running the graph search', () => {
    const assessed: StudyMarks = {
      ...MARKS,
      reserves: [{
        ...MARKS.reserves[0],
        name: '302 Div Res 1',
        level: 'K4',
        owning_formation: '301 Div',
        intelligence_status: 'confirmed',
        intelligence_evidence: [{
          source_document_id: 'sitrep',
          source_document_name: 'SITREP.txt',
          excerpt: '302 Div Res 1 remains IVO TOMA 1b',
        }],
        locality: 'TOMA 1b',
      }],
    }
    expect(needsResearch(current, { marks: assessed })).toBe(false)
  })

  test('objective locality edits persist without re-running the graph search', () => {
    const named: StudyMarks = {
      ...MARKS,
      objectives: [{ ...MARKS.objectives[0], locality: 'MATO 1b' }],
    }
    expect(needsResearch(current, { marks: named })).toBe(false)
  })

  test('changing objective ground re-runs the graph search even when its centre stays put', () => {
    const currentGround: StudyMarks = {
      ...MARKS,
      objectives: [{
        ...MARKS.objectives[0],
        bbox: { west: 0.5, south: -0.5, east: 1.5, north: 0.5 },
      }],
    }
    const expanded: StudyMarks = {
      ...currentGround,
      objectives: [{
        ...currentGround.objectives[0],
        bbox: { west: 0.25, south: -0.5, east: 1.5, north: 0.5 },
      }],
    }

    expect(needsResearch({ ...current, marks: currentGround }, { marks: expanded })).toBe(true)
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

  test('explicitly running a stale study advances it to current ground', () => {
    expect(
      needsResearch(
        { ...current, graphRevision: 2 },
        { marks: MARKS, edgeOverrides: ['1:0'] },
        3,
      ),
    ).toBe(true)
  })

  test('presentation edits do not silently advance a stale study', () => {
    expect(needsResearch({ ...current, graphRevision: 2 }, {}, 3)).toBe(false)
  })
})

describe('reserve deployment intelligence', () => {
  test('accepts the fixed K ladder and two-source status', () => {
    expect(reserveMarkSchema.parse({
      id: 'r1',
      name: '302 Div Res 1',
      lon: 103.7,
      lat: 1.4,
      level: 'K4',
      owning_formation: '301 Div',
      intelligence_status: 'confirmed',
      intelligence_evidence: [{
        source_document_id: 'sitrep',
        source_document_name: 'SITREP.txt',
        excerpt: '302 Div Res 1 remains IVO TOMA 1b',
      }],
      locality: 'TOMA 1b',
      task_organization: [{
        id: 'drc',
        designation: 'DRC',
        echelon: 'company',
        modifier: 'full',
        order_of_move: 1,
        platforms: [{ id: 'btr', platform: 'BTR-90', establishment_count: 10 }],
      }],
      timing: { decision_minutes: 5, readiness_minutes: 10.5, deployment_minutes: 15 },
    })).toMatchObject({
      level: 'K4',
      intelligence_status: 'confirmed',
      intelligence_evidence: [{ source_document_name: 'SITREP.txt' }],
    })
  })

  test('legacy and new unconfirmed marks default to assessed', () => {
    expect(reserveMarkSchema.parse({ id: 'r1', name: 'Reserve 1', lon: 0, lat: 0 }))
      .toMatchObject({ intelligence_status: 'assessed' })
  })

  test('rejects duplicate evidence identities on a saved reserve', () => {
    const evidence = {
      source_document_id: 'sitrep', source_document_name: 'SITREP.txt', excerpt: 'Reserve seen',
    }
    expect(reserveMarkSchema.safeParse({
      id: 'r1', name: 'Reserve 1', lon: 0, lat: 0,
      intelligence_evidence: [evidence, { ...evidence, excerpt: 'Repeated' }],
    }).success).toBe(false)
  })

  test('rejects invented levels and intelligence states', () => {
    expect(reserveMarkSchema.safeParse({
      id: 'r1', name: 'Reserve', lon: 0, lat: 0, level: 'K5', intelligence_status: 'rumoured',
    }).success).toBe(false)
  })

  test('rejects free-text echelons, modifiers, and invalid platform counts', () => {
    expect(reserveMarkSchema.safeParse({
      id: 'r1',
      name: 'Reserve',
      lon: 0,
      lat: 0,
      task_organization: [{
        id: 'x', designation: 'ABG', echelon: 'large', modifier: 'half', order_of_move: 0,
        platforms: [{ id: 'p', platform: 'BTR-90', establishment_count: -1 }],
      }],
    }).success).toBe(false)
  })

  test('accepts incomplete nonnegative timing but rejects negative stages', () => {
    expect(reserveMarkSchema.safeParse({
      id: 'r1', name: 'Reserve', lon: 0, lat: 0, timing: { decision_minutes: 12.5 },
    }).success).toBe(true)
    expect(reserveMarkSchema.safeParse({
      id: 'r1', name: 'Reserve', lon: 0, lat: 0, timing: { readiness_minutes: -1 },
    }).success).toBe(false)
  })
})

describe('objective terrain references', () => {
  test('accepts a named locality on an objective', () => {
    expect(objectiveMarkSchema.parse({
      id: 'o1', name: 'Bridge', lon: 0, lat: 0, locality: 'MATO 1b',
    })).toMatchObject({ locality: 'MATO 1b' })
  })

  test('accepts real ground and rejects degenerate bounds', () => {
    const objective = {
      id: 'o1', name: 'Area', lon: 1, lat: 0,
      bbox: { west: 0.5, south: -0.5, east: 1.5, north: 0.5 },
    }
    expect(objectiveMarkSchema.safeParse(objective).success).toBe(true)
    expect(objectiveMarkSchema.safeParse({
      ...objective,
      bbox: { ...objective.bbox, north: objective.bbox.south },
    }).success).toBe(false)
  })
})
