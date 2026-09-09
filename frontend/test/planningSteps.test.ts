import { describe, expect, test } from 'bun:test'
import {
  currentPlanningStep,
  planningSteps,
  type PlanningProgress,
} from '../src/lib/planningSteps'

const nothing: PlanningProgress = {
  hasSelection: false,
  hasArea: false,
  reserveCount: 0,
  objectiveCount: 0,
  hasStudy: false,
  marksDirty: false,
  hasCourses: false,
  unitCount: 0,
  hasBlockPlan: false,
}

describe('planningSteps', () => {
  test('a blank page points at selecting ground', () => {
    expect(currentPlanningStep(nothing)?.id).toBe('area')
  })

  test('a dragged but un-ingested selection points at the ingest', () => {
    expect(currentPlanningStep({ ...nothing, hasSelection: true })?.id).toBe('ingest')
  })

  test('an ingested area with no marks points at reserves', () => {
    expect(currentPlanningStep({ ...nothing, hasArea: true })?.id).toBe('reserves')
  })

  test('reserves without objectives points at objectives', () => {
    const progress = { ...nothing, hasArea: true, reserveCount: 2 }
    expect(currentPlanningStep(progress)?.id).toBe('objectives')
  })

  test('both kinds of mark and no result points at the run', () => {
    const progress = { ...nothing, hasArea: true, reserveCount: 1, objectiveCount: 1 }
    expect(currentPlanningStep(progress)?.id).toBe('run')
  })

  test('marks edited after a run points back at the run', () => {
    const progress = {
      ...nothing,
      hasArea: true,
      reserveCount: 1,
      objectiveCount: 1,
      hasStudy: true,
      marksDirty: true,
      hasCourses: true,
    }
    expect(currentPlanningStep(progress)?.id).toBe('run')
  })

  test('a finished study walks the three passes in order', () => {
    const ran = {
      ...nothing,
      hasArea: true,
      reserveCount: 1,
      objectiveCount: 1,
      hasStudy: true,
    }
    expect(currentPlanningStep(ran)?.id).toBe('enemy')
    expect(currentPlanningStep({ ...ran, hasCourses: true })?.id).toBe('force')
    expect(currentPlanningStep({ ...ran, hasCourses: true, unitCount: 3 })?.id).toBe('block')
  })

  test('nothing is current once every step is behind you', () => {
    const done = {
      hasSelection: true,
      hasArea: true,
      reserveCount: 1,
      objectiveCount: 1,
      hasStudy: true,
      marksDirty: false,
      hasCourses: true,
      unitCount: 3,
      hasBlockPlan: true,
    }
    expect(currentPlanningStep(done)).toBeNull()
    expect(planningSteps(done).every((step) => step.status === 'done')).toBe(true)
  })

  test('removing the reserves from a finished study walks the guide back', () => {
    const progress = {
      ...nothing,
      hasArea: true,
      objectiveCount: 1,
      hasStudy: true,
      hasCourses: true,
      unitCount: 2,
      hasBlockPlan: true,
    }
    expect(currentPlanningStep(progress)?.id).toBe('reserves')
  })

  test('the sequence is always eight steps long', () => {
    expect(planningSteps(nothing)).toHaveLength(8)
  })
})
