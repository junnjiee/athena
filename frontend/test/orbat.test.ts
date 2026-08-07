import { beforeEach, describe, expect, test } from 'bun:test'
import { templateFor, useOrbat } from '../src/state/orbat'
import { usePlan } from '../src/state/plan'
import { STRENGTH_RANGE, VISION_RANGE_M } from '../src/types/orbat'

const AT = { longitude: 103.8, latitude: 1.35 }

beforeEach(() => {
  useOrbat.getState().resetToDefaults()
  usePlan.getState().clearPlan()
})

describe('templates', () => {
  test('ships with establishments for both sides and both echelons', () => {
    for (const side of ['blue', 'red'] as const) {
      expect(templateFor(side, 'section')).not.toBeNull()
      expect(templateFor(side, 'platoon')).not.toBeNull()
    }
  })

  test('adding creates an establishment on the requested side and echelon', () => {
    const id = useOrbat.getState().addTemplate('red', 'platoon')
    const added = useOrbat.getState().templates.find((t) => t.id === id)
    expect(added).toMatchObject({ side: 'red', echelon: 'platoon' })
  })

  test('strength and vision are clamped to physically sensible bounds', () => {
    const id = useOrbat.getState().addTemplate('blue', 'section')
    useOrbat.getState().updateTemplate(id, { strength: 9999, visionRangeM: 99999 })
    let t = useOrbat.getState().templates.find((x) => x.id === id)!
    expect(t.strength).toBe(STRENGTH_RANGE.max)
    expect(t.visionRangeM).toBe(VISION_RANGE_M.max)

    useOrbat.getState().updateTemplate(id, { strength: 0, visionRangeM: 1 })
    t = useOrbat.getState().templates.find((x) => x.id === id)!
    expect(t.strength).toBe(STRENGTH_RANGE.min)
    expect(t.visionRangeM).toBe(VISION_RANGE_M.min)
  })

  test('editing one establishment leaves the others alone', () => {
    const [first, second] = useOrbat.getState().templates
    useOrbat.getState().updateTemplate(first.id, { name: 'Renamed' })
    const after = useOrbat.getState().templates
    expect(after.find((t) => t.id === first.id)!.name).toBe('Renamed')
    expect(after.find((t) => t.id === second.id)!.name).toBe(second.name)
  })

  test('removing an establishment leaves the rest intact', () => {
    const before = useOrbat.getState().templates.length
    useOrbat.getState().removeTemplate(useOrbat.getState().templates[0].id)
    expect(useOrbat.getState().templates).toHaveLength(before - 1)
  })
})

describe('placement adopts the establishment', () => {
  test('a placed section carries strength and vision range from its template', () => {
    const template = templateFor('blue', 'section')!
    usePlan.getState().place('place-blue-section', AT)

    expect(usePlan.getState().units[0]).toMatchObject({
      templateId: template.id,
      strength: template.strength,
      visionRangeM: template.visionRangeM,
      typeLabel: template.name,
    })
  })

  test('a placed platoon uses the platoon establishment, not the section one', () => {
    const platoon = templateFor('red', 'platoon')!
    usePlan.getState().place('place-red-platoon', AT)
    expect(usePlan.getState().units[0].strength).toBe(platoon.strength)
  })

  test('edits to a template apply to units placed afterwards', () => {
    const template = templateFor('blue', 'section')!
    useOrbat.getState().updateTemplate(template.id, { strength: 5, visionRangeM: 450 })
    usePlan.getState().place('place-blue-section', AT)

    expect(usePlan.getState().units[0]).toMatchObject({ strength: 5, visionRangeM: 450 })
  })

  test('fortifications carry no establishment — they are ground, not troops', () => {
    usePlan.getState().place('place-trench', AT)
    const unit = usePlan.getState().units[0]
    expect(unit.templateId).toBeUndefined()
    expect(unit.strength).toBeUndefined()
    expect(unit.visionRangeM).toBeUndefined()
  })

  test('with every establishment deleted, placement still produces a bare marker', () => {
    for (const t of [...useOrbat.getState().templates]) {
      useOrbat.getState().removeTemplate(t.id)
    }
    usePlan.getState().place('place-blue-section', AT)

    const unit = usePlan.getState().units[0]
    expect(unit).toBeDefined()
    expect(unit.strength).toBeUndefined()
    // falls back to the placement tool's own label
    expect(unit.typeLabel).toBe('Blue Force Section')
  })
})
