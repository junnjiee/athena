import { describe, expect, test } from 'bun:test'
import {
  blockInputsForRoutes,
  blockPlanMatchesResult,
  courseAssessmentInputsChanged,
  courseForFeedback,
  coursesRemainGrounded,
  corridorsForCourseAssessment,
  needsResearch,
  objectiveMarkSchema,
  reconcileCourseState,
  reconcileIntentWithObjectives,
  reserveBlockInputsChanged,
  reserveMarkSchema,
} from '../src/routes/routeStudies'
import type { BlockPlan, RankedCourses, StudyMarks, StudyResult } from '../src/db/studyTypes'

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
  test('accepts deployment intelligence and two-source status', () => {
    expect(reserveMarkSchema.parse({
      id: 'r1',
      name: '302 Div Res 1',
      lon: 103.7,
      lat: 1.4,
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

  test('rejects invented intelligence states', () => {
    expect(reserveMarkSchema.safeParse({
      id: 'r1', name: 'Reserve', lon: 0, lat: 0, intelligence_status: 'rumoured',
    }).success).toBe(false)
  })

  test('a retired K level on a legacy mark is dropped, not rejected', () => {
    // K nominals are ECA triggers now, assigned per course by the engine.
    const parsed = reserveMarkSchema.parse({ id: 'r1', name: 'Reserve', lon: 0, lat: 0, level: 'K4' })
    expect('level' in parsed).toBe(false)
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

describe('course corridor context', () => {
  const corridor = {
    id: 'cor_a',
    routes: [],
    choke_edge_ids: [],
    fastest_seconds: 600,
  }

  test('adds bounded one-line operator context without replacing the stable id', () => {
    const [assessable] = corridorsForCourseAssessment([corridor], {
      cor_a: { name: '  COBRA\nNORTH  ', category: ' main\tapproach ' },
    })

    expect(assessable).toEqual({
      ...corridor,
      operator_name: 'COBRA NORTH',
      operator_category: 'main approach',
    })
  })

  test('does not invent context for an unedited corridor', () => {
    expect(corridorsForCourseAssessment([corridor], {})).toEqual([corridor])
  })
})

describe('rerouted course reconciliation', () => {
  const result: StudyResult = {
    corridors: [{
      id: 'cor_a',
      routes: [{
        reserve_id: 'r1',
        objective_id: 'o1',
        edge_ids: ['edge_a'],
        node_ids: [1, 2],
        seconds: 60,
        length_meters: 100,
      }],
      choke_edge_ids: [],
      fastest_seconds: 60,
    }],
    unreachable: [],
  }
  const courses: RankedCourses = {
    courses: [{
      name: 'Advance',
      narrative: 'Use the live inlet.',
      efforts: [{
        kind: 'main',
        corridor_id: 'cor_a',
        reserve_id: 'r1',
        objective_id: 'o1',
        rationale: 'Fastest route.',
      }],
      likelihood: 0.8,
      danger: 0.7,
    }],
    most_likely: null,
    most_dangerous: null,
    rejected: [],
  }

  test('prunes only objective selections that disappeared', () => {
    expect(reconcileIntentWithObjectives({
      objective_ids: ['o2', 'o1', 'o3'],
      narrative: 'Retain the analyst narrative.',
    }, MARKS.objectives)).toEqual({
      objective_ids: ['o1'],
      narrative: 'Retain the analyst narrative.',
    })
  })

  test('leaves an absent assessment input absent', () => {
    expect(reconcileIntentWithObjectives(null, MARKS.objectives)).toBeNull()
    expect(coursesRemainGrounded(null, result)).toBe(true)
  })

  test('retains a saved assessment while its exact routed combination exists', () => {
    expect(coursesRemainGrounded(courses, result)).toBe(true)
  })

  test('invalidates the assessment when a selected intent objective disappears', () => {
    expect(reconcileCourseState(
      { objective_ids: ['o1', 'o2'], narrative: 'Seize either objective.' },
      courses,
      MARKS.objectives,
      result,
    )).toEqual({
      intent: { objective_ids: ['o1'], narrative: 'Seize either objective.' },
      courses: null,
    })
  })

  test.each([
    ['corridor', { corridor_id: 'cor_b' }],
    ['reserve', { reserve_id: 'r2' }],
    ['objective', { objective_id: 'o2' }],
  ])('invalidates an assessment whose %s changed', (_field, changed) => {
    const stale: RankedCourses = {
      ...courses,
      courses: [{
        ...courses.courses[0],
        efforts: [{ ...courses.courses[0].efforts[0], ...changed }],
      }],
    }
    expect(coursesRemainGrounded(stale, result)).toBe(false)
  })

  test('retains a legacy effort when its corridor and reserve still exist together', () => {
    const legacy: RankedCourses = {
      ...courses,
      courses: [{
        ...courses.courses[0],
        efforts: [{
          ...courses.courses[0].efforts[0],
          objective_id: undefined,
        }],
      }],
    }
    expect(coursesRemainGrounded(legacy, result)).toBe(true)
  })

  test('rejects a structurally empty saved course', () => {
    const empty: RankedCourses = {
      ...courses,
      courses: [{ ...courses.courses[0], efforts: [] }],
    }
    expect(coursesRemainGrounded(empty, result)).toBe(false)
  })

  test('invalidates when any model assessment input changes', () => {
    const current = { result, marks: MARKS, corridorEdits: {} }
    expect(courseAssessmentInputsChanged(current, current)).toBe(false)
    expect(courseAssessmentInputsChanged(current, {
      ...current,
      marks: {
        ...MARKS,
        reserves: [{ ...MARKS.reserves[0], timing: { decision_minutes: 5 } }],
      },
    })).toBe(true)
    expect(courseAssessmentInputsChanged(current, {
      ...current,
      marks: {
        ...MARKS,
        objectives: [{ ...MARKS.objectives[0], locality: 'MATO 1b' }],
      },
    })).toBe(true)
    expect(courseAssessmentInputsChanged(current, {
      ...current,
      corridorEdits: { cor_a: { name: 'COBRA' } },
    })).toBe(true)
    expect(courseAssessmentInputsChanged(current, {
      ...current,
      result: {
        ...result,
        corridors: [{ ...result.corridors[0], fastest_seconds: 90 }],
      },
    })).toBe(true)
  })

  test('feedback resolves exactly one grounded saved course', () => {
    expect(courseForFeedback(null, courses, MARKS, result, 'Advance')?.name).toBe('Advance')
    expect(courseForFeedback(null, courses, MARKS, result, 'Unknown')).toBeNull()
    expect(courseForFeedback(null, {
      ...courses,
      courses: [courses.courses[0], { ...courses.courses[0] }],
    }, MARKS, result, 'Advance')).toBeNull()
    expect(courseForFeedback(null, {
      ...courses,
      courses: [{
        ...courses.courses[0],
        efforts: [{ ...courses.courses[0].efforts[0], corridor_id: 'cor_stale' }],
      }],
    }, MARKS, result, 'Advance')).toBeNull()
  })
})

describe('rerouted block-plan inputs', () => {
  const plan: BlockPlan = {
    inlets: [{
      inlet_id: 'inlet_live',
      corridor_id: 'cor_old',
      inlet_number: 1,
      reserve_id: 'r1',
      objective_id: 'o1',
      edge_ids: ['edge_a', 'edge_b'],
      movement_seconds: 120,
      candidates: [],
    }, {
      inlet_id: 'inlet_stale',
      corridor_id: 'cor_old',
      inlet_number: 2,
      reserve_id: 'r1',
      objective_id: 'o2',
      edge_ids: ['edge_c'],
      movement_seconds: 180,
      candidates: [],
    }],
    allocation: [],
    unblockable: [],
    uncovered: [],
    sealing: [],
    block_points: [
      { inlet_id: 'inlet_live', lon: 1, lat: 2, enemy_movement_seconds: 60, snap_distance_meters: 3 },
      { inlet_id: 'inlet_stale', lon: 3, lat: 4, enemy_movement_seconds: 90, snap_distance_meters: 5 },
    ],
    delay_assessments: [
      { inlet_id: 'inlet_live', unit_id: 'unit1', delay_minutes: 30 },
      { inlet_id: 'inlet_stale', unit_id: 'unit2', delay_minutes: 40 },
    ],
    block_establishments: [
      {
        inlet_id: 'inlet_live', unit_id: 'unit1', block_point_lon: 1,
        block_point_lat: 2, established_minutes: 20,
      },
      {
        inlet_id: 'inlet_stale', unit_id: 'unit2', block_point_lon: 3,
        block_point_lat: 4, established_minutes: 25,
      },
    ],
  }
  const rerouted: StudyResult = {
    corridors: [{
      id: 'cor_new',
      routes: [{
        reserve_id: 'r1', objective_id: 'o1', edge_ids: ['edge_a', 'edge_b'],
        node_ids: [1, 2, 3], seconds: 120, length_meters: 200,
      }],
      choke_edge_ids: [],
      fastest_seconds: 120,
    }],
    unreachable: [],
  }

  test('retains inputs for an exact route even when corridors regroup', () => {
    expect(blockInputsForRoutes(plan, rerouted)).toEqual({
      blockPoints: [{ inlet_id: 'inlet_live', lon: 1, lat: 2 }],
      delayAssessments: [{ inlet_id: 'inlet_live', unit_id: 'unit1', delay_minutes: 30 }],
      blockEstablishments: [{
        inlet_id: 'inlet_live', unit_id: 'unit1', block_point_lon: 1,
        block_point_lat: 2, established_minutes: 20,
      }],
    })
  })

  test('drops inputs when any part of the stable route identity changes', () => {
    const changed: StudyResult = {
      ...rerouted,
      corridors: [{
        ...rerouted.corridors[0],
        routes: [{ ...rerouted.corridors[0].routes[0], edge_ids: ['edge_a', 'edge_d'] }],
      }],
    }
    expect(blockInputsForRoutes(plan, changed)).toEqual({
      blockPoints: [],
      delayAssessments: [],
      blockEstablishments: [],
    })
  })

  test('cannot carry inlet-bound inputs from a legacy corridor-only plan', () => {
    expect(blockInputsForRoutes({ ...plan, inlets: undefined }, rerouted)).toEqual({
      blockPoints: [],
      delayAssessments: [],
      blockEstablishments: [],
    })
  })

  test('reserve scenario edits require recalculation even when routing does not', () => {
    const retimed: StudyMarks = {
      ...MARKS,
      reserves: [{ ...MARKS.reserves[0], timing: { readiness_minutes: 15 } }],
    }
    expect(reserveBlockInputsChanged(MARKS, retimed)).toBe(true)
    expect(reserveBlockInputsChanged(MARKS, { ...MARKS })).toBe(false)
  })

  test('objective-only edits do not recalculate a block plan unless they reroute', () => {
    const renamed: StudyMarks = {
      ...MARKS,
      objectives: [{ ...MARKS.objectives[0], name: 'Crossing' }],
    }
    expect(reserveBlockInputsChanged(MARKS, renamed)).toBe(false)
  })

  test('recognizes a modern plan that exactly matches its stored routes', () => {
    const current: StudyResult = {
      corridors: [{
        id: 'cor_old',
        routes: plan.inlets!.map((inlet) => ({
          reserve_id: inlet.reserve_id,
          objective_id: inlet.objective_id,
          edge_ids: inlet.edge_ids,
          node_ids: [],
          seconds: inlet.movement_seconds!,
          length_meters: 0,
        })),
        choke_edge_ids: [],
        fastest_seconds: 120,
      }],
      unreachable: [],
    }
    expect(blockPlanMatchesResult(plan, current)).toBe(true)
    expect(blockPlanMatchesResult({
      ...plan,
      inlets: plan.inlets!.map(({ movement_seconds: _old, ...inlet }) => inlet),
    }, current)).toBe(true)
  })

  test('rejects missing, added, regrouped, or retimed routes', () => {
    expect(blockPlanMatchesResult(plan, rerouted)).toBe(false)
    const onlyLive = { ...plan, inlets: [plan.inlets![0]] }
    expect(blockPlanMatchesResult(onlyLive, rerouted)).toBe(false)
    expect(blockPlanMatchesResult({
      ...onlyLive,
      inlets: [{ ...onlyLive.inlets![0], corridor_id: 'cor_new', movement_seconds: 121 }],
    }, rerouted)).toBe(false)
    expect(blockPlanMatchesResult(null, rerouted)).toBe(true)
  })

  test('validates legacy plans by their corridor set', () => {
    const legacy = {
      ...plan,
      inlets: undefined,
      corridors: [{ corridor_id: 'cor_new', choke_edge_ids: [], candidates: [] }],
    }
    expect(blockPlanMatchesResult(legacy, rerouted)).toBe(true)
    expect(blockPlanMatchesResult({
      ...legacy,
      corridors: [{ ...legacy.corridors[0], corridor_id: 'cor_old' }],
    }, rerouted)).toBe(false)
  })
})
