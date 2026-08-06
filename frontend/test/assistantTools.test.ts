import { beforeEach, describe, expect, test } from 'bun:test'
import { assistantTools } from '../src/assistant/tools'
import { registerAssistantHost } from '../src/assistant/bridge'
import { useConfirm } from '../src/assistant/confirm'
import { useBattleground } from '../src/state/battleground'
import { usePlan } from '../src/state/plan'
import { TERRAIN_CLASS, type GridData } from '../src/types/terrain'

/** 10×10 grid of uniform forest over a 0.001° box at the equator. */
const BBOX = { west: 0, south: 0, east: 0.001, north: 0.001 }
const N = 100

function grid(): GridData {
  const fill = (v: number) => new Uint8Array(N).fill(v)
  return {
    bbox: BBOX,
    width: 10,
    height: 10,
    cellMeters: 11.132,
    elevation: new Float32Array(N).fill(120),
    cls: fill(TERRAIN_CLASS.FOREST),
    slope: fill(8),
    cover: fill(80),
    concealment: fill(90),
    moveCost: fill(40),
    visibility: fill(15),
    vehicleMobility: fill(5),
    ambush: fill(70),
  }
}

/** Centre of cell (x, y) in the fixture grid. */
function at(x: number, y: number) {
  return {
    longitude: BBOX.west + ((x + 0.5) / 10) * (BBOX.east - BBOX.west),
    latitude: BBOX.north - ((y + 0.5) / 10) * (BBOX.north - BBOX.south),
  }
}

function battlefieldReady() {
  useBattleground.setState({ phase: 'ready', grid: grid() })
}

function battlefieldMissing() {
  useBattleground.setState({ phase: 'idle', grid: null })
}

beforeEach(() => {
  usePlan.getState().clearPlan()
  useConfirm.setState({ pending: null, lastOutcome: null })
  battlefieldReady()
})

describe('guarding on a generated battlefield', () => {
  test('placement tools refuse before terrain exists', () => {
    battlefieldMissing()
    const answer = assistantTools.place_unit({ side: 'blue', echelon: 'section', ...at(1, 1) })
    expect(answer).toContain('No battlefield is generated yet')
    expect(usePlan.getState().units).toHaveLength(0)
  })

  test('terrain sampling refuses before terrain exists', () => {
    battlefieldMissing()
    expect(assistantTools.get_terrain_at(at(1, 1))).toContain('No battlefield is generated yet')
  })
})

describe('place_unit', () => {
  test('places a unit and reports its callsign', () => {
    const answer = assistantTools.place_unit({ side: 'blue', echelon: 'platoon', ...at(2, 2) })
    expect(answer).toBe('Placed blue platoon Alpha.')
    expect(usePlan.getState().units[0]).toMatchObject({ side: 'blue', symbolKind: 'bluePlatoon' })
  })

  test('asks again when side or echelon is missing', () => {
    expect(assistantTools.place_unit({ side: 'blue', ...at(1, 1) })).toContain('Tell me the side')
    expect(usePlan.getState().units).toHaveLength(0)
  })

  test('asks again when coordinates are missing or out of range', () => {
    expect(assistantTools.place_unit({ side: 'blue', echelon: 'section' })).toContain(
      'longitude and latitude',
    )
    expect(
      assistantTools.place_unit({ side: 'blue', echelon: 'section', longitude: 999, latitude: 0 }),
    ).toContain('longitude and latitude')
  })

  test('accepts numeric strings, which is how the model often sends them', () => {
    const point = at(3, 3)
    const answer = assistantTools.place_unit({
      side: 'red',
      echelon: 'section',
      longitude: String(point.longitude),
      latitude: String(point.latitude),
    })
    expect(answer).toBe('Placed red section Alpha.')
  })
})

describe('place_fortification and place_objective', () => {
  test('a trench is placed as a red fortification', () => {
    expect(assistantTools.place_fortification({ kind: 'trench', ...at(1, 1) })).toContain('trench')
    expect(usePlan.getState().units[0]).toMatchObject({ symbolKind: 'trench', side: 'red' })
  })

  test('an unknown fortification kind asks for clarification', () => {
    expect(assistantTools.place_fortification({ kind: 'bunker', ...at(1, 1) })).toContain(
      'trench or a prepared trench',
    )
  })

  test('an explicit objective radius overrides the default', () => {
    const answer = assistantTools.place_objective({ ...at(5, 5), radius_meters: 300 })
    expect(answer).toContain('300 metre radius')
    expect(usePlan.getState().objectives[0].radiusMeters).toBe(300)
  })

  test('objectives fall back to the store default radius', () => {
    assistantTools.place_objective(at(5, 5))
    expect(usePlan.getState().objectives[0].radiusMeters).toBe(150)
  })
})

describe('draw_route', () => {
  test('anchors the route to the named unit and reports distance', () => {
    assistantTools.place_unit({ side: 'blue', echelon: 'section', ...at(1, 1) })
    const answer = assistantTools.draw_route({
      unit_callsign: 'alpha',
      waypoints: [at(1, 5)],
      movement_type: 'prowl',
    })

    const route = usePlan.getState().routes[0]
    expect(route.movementType).toBe('prowl')
    expect(route.side).toBe('blue')
    // the unit's own position is always the first point
    expect(route.points[0]).toEqual(usePlan.getState().units[0].position)
    expect(route.points).toHaveLength(2)
    expect(answer).toContain('Drew a prowl route for Alpha')
  })

  test('names the available units when the callsign is unknown', () => {
    assistantTools.place_unit({ side: 'blue', echelon: 'section', ...at(1, 1) })
    const answer = assistantTools.draw_route({ unit_callsign: 'Zulu', waypoints: [at(2, 2)] })
    expect(answer).toContain('Current units: Alpha')
    expect(usePlan.getState().routes).toHaveLength(0)
  })

  test('says so when there are no units at all', () => {
    expect(assistantTools.draw_route({ unit_callsign: 'Alpha', waypoints: [at(1, 1)] })).toContain(
      'no units on the map yet',
    )
  })

  test('rejects a route with no waypoints', () => {
    assistantTools.place_unit({ side: 'blue', echelon: 'section', ...at(1, 1) })
    expect(assistantTools.draw_route({ unit_callsign: 'Alpha', waypoints: [] })).toContain(
      'at least one waypoint',
    )
  })

  test('an unrecognised load preset falls back to fighting order', () => {
    assistantTools.place_unit({ side: 'blue', echelon: 'section', ...at(1, 1) })
    assistantTools.draw_route({
      unit_callsign: 'Alpha',
      waypoints: [at(1, 4)],
      load_preset: 'nonsense',
    })
    expect(usePlan.getState().routes[0].loadout.preset).toBe('fighting')
  })
})

describe('reading the map', () => {
  test('get_terrain_at describes the cell in plain language', () => {
    const answer = assistantTools.get_terrain_at(at(4, 4))
    expect(answer).toContain('Dense Forest')
    expect(answer).toContain('120 metres elevation')
    expect(answer).toContain('Cover 80')
  })

  test('get_terrain_at rejects points off the battlefield', () => {
    expect(assistantTools.get_terrain_at({ longitude: 50, latitude: 50 })).toContain(
      'outside the generated battlefield',
    )
  })

  test('get_plan_state reports an empty plan', () => {
    expect(assistantTools.get_plan_state()).toBe('The plan is empty.')
  })

  test('get_plan_state lists units, objectives and routes', () => {
    assistantTools.place_unit({ side: 'blue', echelon: 'section', ...at(1, 1) })
    assistantTools.place_objective(at(8, 8))
    assistantTools.draw_route({ unit_callsign: 'Alpha', waypoints: [at(4, 4)] })

    const answer = assistantTools.get_plan_state()
    expect(answer).toContain('Alpha')
    expect(answer).toContain('OBJ ALPHA')
    expect(answer).toContain('routes:')
  })

  test('analyze_plan says so when nothing is drawn', () => {
    expect(assistantTools.analyze_plan()).toContain('No routes are drawn yet')
  })

  test('analyze_plan reports exposure and confidence once a route exists', () => {
    assistantTools.place_unit({ side: 'blue', echelon: 'section', ...at(1, 1) })
    assistantTools.draw_route({ unit_callsign: 'Alpha', waypoints: [at(1, 8)] })
    const answer = assistantTools.analyze_plan()
    expect(answer).toMatch(/\d+ route/)
    expect(answer).toContain('confidence')
  })
})

describe('removing things is gated behind confirmation', () => {
  test('delete_element parks the removal instead of doing it', () => {
    assistantTools.place_unit({ side: 'blue', echelon: 'section', ...at(1, 1) })
    const answer = assistantTools.delete_element({ name: 'Alpha' })

    expect(answer).toContain('Confirm on screen')
    // Nothing is gone until the operator agrees.
    expect(usePlan.getState().units).toHaveLength(1)
    expect(useConfirm.getState().pending?.summary).toBe('Remove Alpha?')
  })

  test('confirming performs the removal and reports it', () => {
    assistantTools.place_unit({ side: 'blue', echelon: 'section', ...at(1, 1) })
    assistantTools.delete_element({ name: 'Alpha' })
    useConfirm.getState().confirm()

    expect(usePlan.getState().units).toHaveLength(0)
    expect(useConfirm.getState().lastOutcome).toBe('Removed Alpha.')
    expect(useConfirm.getState().pending).toBeNull()
  })

  test('cancelling leaves the plan untouched', () => {
    assistantTools.place_unit({ side: 'blue', echelon: 'section', ...at(1, 1) })
    assistantTools.delete_element({ name: 'Alpha' })
    useConfirm.getState().cancel()

    expect(usePlan.getState().units).toHaveLength(1)
    expect(useConfirm.getState().lastOutcome).toContain('Cancelled')
  })

  test('the prompt warns when routes will go with the unit', () => {
    assistantTools.place_unit({ side: 'blue', echelon: 'section', ...at(1, 1) })
    assistantTools.draw_route({ unit_callsign: 'Alpha', waypoints: [at(1, 5)] })

    const answer = assistantTools.delete_element({ name: 'Alpha' })
    expect(answer).toContain('1 route')
    expect(useConfirm.getState().pending?.summary).toBe('Remove Alpha and 1 attached route?')
  })

  test('delete_element reports an unknown name without prompting', () => {
    expect(assistantTools.delete_element({ name: 'Zulu' })).toContain('Nothing on the map')
    expect(useConfirm.getState().pending).toBeNull()
  })

  test('clear_plan is gated too, and reports the count once confirmed', () => {
    assistantTools.place_unit({ side: 'blue', echelon: 'section', ...at(1, 1) })
    assistantTools.place_objective(at(2, 2))

    expect(assistantTools.clear_plan()).toContain('Confirm on screen')
    expect(usePlan.getState().units).toHaveLength(1)

    useConfirm.getState().confirm()
    expect(usePlan.getState().units).toHaveLength(0)
    expect(useConfirm.getState().lastOutcome).toContain('2 elements removed')
  })

  test('clearing an already-empty plan does not prompt', () => {
    expect(assistantTools.clear_plan()).toBe('The plan is already empty.')
    expect(useConfirm.getState().pending).toBeNull()
  })

  test('takeOutcome hands the result over exactly once', () => {
    assistantTools.place_unit({ side: 'blue', echelon: 'section', ...at(1, 1) })
    assistantTools.delete_element({ name: 'Alpha' })
    useConfirm.getState().confirm()

    expect(useConfirm.getState().takeOutcome()).toBe('Removed Alpha.')
    expect(useConfirm.getState().takeOutcome()).toBeNull()
  })
})

describe('view controls', () => {
  test('set_heatmap switches the active layer', () => {
    expect(assistantTools.set_heatmap({ metric: 'cover' })).toBe('Showing the cover layer.')
    expect(useBattleground.getState().heatmap).toBe('cover')
    expect(assistantTools.set_heatmap({ metric: 'none' })).toBe('Cleared the heatmap.')
  })

  test('set_view_mode rejects an unknown mode', () => {
    expect(assistantTools.set_view_mode({ mode: 'hologram' })).toContain('globe, topo or photo')
  })

  test('set_view_mode goes through the registered host', () => {
    const seen: string[] = []
    const unregister = registerAssistantHost({ setViewMode: (mode) => seen.push(mode) })
    expect(assistantTools.set_view_mode({ mode: 'topo' })).toBe('Switched to topo view.')
    expect(seen).toEqual(['topo'])
    unregister()
  })

  test('a capability the current page does not provide explains itself', () => {
    expect(assistantTools.set_view_mode({ mode: 'globe' })).toContain('battleground map')
  })
})
