import { requireHost } from './bridge'
import { requestConfirmation } from './confirm'
import { useBattleground } from '../state/battleground'
import { findElementByName, usePlan } from '../state/plan'
import { listPlans } from '../lib/api'
import { sampleCell } from '../lib/grid'
import { analyzePlan } from '../lib/validate'
import { defaultLoadout, useSettings, type DefaultLoadPreset } from '../state/settings'
import { LOAD_PRESETS, type MovementType } from '../types/movement'
import type { ViewMode } from '../components/globe/ViewModeToggle'
import type { HeatmapMetric } from '../types/terrain'
import type { LonLat, PlaceableMode } from '../types/entities'

/**
 * The assistant's tool implementations.
 *
 * Each returns a short plain-language string, because the return value is spoken
 * back through the model — a JSON blob would be read aloud verbatim. Failures
 * return a sentence too rather than throwing, so a misheard instruction turns
 * into a conversational correction instead of a dead session.
 *
 * Names and parameter shapes must match server/src/services/assistantAgent.ts,
 * which is what gets pushed to ElevenLabs by `bun run agent:sync`.
 */

/** Loosely-typed args as they arrive from the model. */
type Args = Record<string, unknown>

const str = (args: Args, key: string): string | null => {
  const value = args[key]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

const num = (args: Args, key: string): number | null => {
  const value = args[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value)
  }
  return null
}

function coords(args: Args): LonLat | null {
  const longitude = num(args, 'longitude')
  const latitude = num(args, 'latitude')
  if (longitude === null || latitude === null) return null
  if (Math.abs(longitude) > 180 || Math.abs(latitude) > 85) return null
  return { longitude, latitude }
}

/** Waypoints arrive as an array of {longitude, latitude} objects. */
function waypoints(args: Args): LonLat[] {
  const raw = args.waypoints
  if (!Array.isArray(raw)) return []
  const points: LonLat[] = []
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object') continue
    const point = coords(entry as Args)
    if (point) points.push(point)
  }
  return points
}

const UNIT_MODE: Record<string, PlaceableMode> = {
  'blue:section': 'place-blue-section',
  'blue:platoon': 'place-blue-platoon',
  'red:section': 'place-red-section',
  'red:platoon': 'place-red-platoon',
}

const FORTIFICATION_MODE: Record<string, PlaceableMode> = {
  trench: 'place-trench',
  prepared_trench: 'place-prepared-trench',
}

const round = (n: number) => Math.round(n)

function requireBattlefield(): string | null {
  const { phase, grid } = useBattleground.getState()
  if (phase !== 'ready' || !grid) {
    return 'No battlefield is generated yet. Search for the ground, select an area, then generate it.'
  }
  return null
}

/** Describes what the plan currently holds, for get_plan_state and after edits. */
function planSummary(): string {
  const { units, objectives, routes } = usePlan.getState()
  if (units.length === 0 && objectives.length === 0 && routes.length === 0) {
    return 'The plan is empty.'
  }

  const parts: string[] = []
  if (units.length > 0) {
    parts.push(
      units
        .map((u) => `${u.name} (${u.side} ${u.typeLabel.toLowerCase().replace(/^(blue|red) force /, '')})`)
        .join(', '),
    )
  }
  if (objectives.length > 0) {
    parts.push(`objectives: ${objectives.map((o) => o.name).join(', ')}`)
  }
  if (routes.length > 0) {
    const byUnit = routes.map((r) => {
      const start = units.find((u) => u.id === r.startUnitId)
      return `${start?.name ?? 'unknown'} on ${r.movementType}`
    })
    parts.push(`routes: ${byUnit.join(', ')}`)
  }
  return parts.join('. ')
}

export const assistantTools = {
  async search_ground(args: Args): Promise<string> {
    const query = str(args, 'query')
    if (!query) return 'I need a place name to search for.'

    try {
      const hits = await requireHost('searchGround')(query)
      if (hits.length === 0) return `No match for "${query}".`
      const best = hits[0]
      const others = hits.slice(1, 3).map((h) => h.name)
      return (
        `Found ${best.name} at ${best.longitude.toFixed(5)}, ${best.latitude.toFixed(5)}. Camera moved there.` +
        (others.length > 0 ? ` Other matches: ${others.join('; ')}.` : '')
      )
    } catch (error: unknown) {
      return errorMessage(error, 'search failed')
    }
  },

  select_area(args: Args): string {
    const center = coords(args)
    if (!center) return 'I need a longitude and latitude to centre the selection on.'
    const size = num(args, 'size_meters') ?? 400

    try {
      const extent = requireHost('selectArea')(center.longitude, center.latitude, size)
      return `Selected ${round(extent.widthMeters)} by ${round(extent.heightMeters)} metres of ground. Ready to generate.`
    } catch (error: unknown) {
      return errorMessage(error, 'could not select that area')
    }
  },

  async generate_battleground(args: Args): Promise<string> {
    const name = str(args, 'name')
    if (!name) return 'What should I call this battleground?'

    try {
      await requireHost('generateBattleground')(name)
      const { meta, grid } = useBattleground.getState()
      if (!grid || !meta) return 'Terrain generation finished but returned no grid.'
      const weather = meta.weather
      return (
        `Battlefield "${name}" is ready — ${grid.width} by ${grid.height} cells at ${grid.cellMeters} metre resolution.` +
        (weather
          ? ` Conditions: ${round(weather.temperatureC)} degrees, ${round(weather.windSpeedKmh)} k p h wind, ${weather.isDay ? 'daylight' : 'night'}.`
          : '')
      )
    } catch (error: unknown) {
      return errorMessage(error, 'terrain generation failed')
    }
  },

  place_unit(args: Args): string {
    const blocked = requireBattlefield()
    if (blocked) return blocked

    const position = coords(args)
    if (!position) return 'I need a longitude and latitude to place the unit.'

    const side = str(args, 'side')?.toLowerCase()
    const echelon = str(args, 'echelon')?.toLowerCase()
    const mode = UNIT_MODE[`${side}:${echelon}`]
    if (!mode) return 'Tell me the side (blue or red) and the size (section or platoon).'

    const id = usePlan.getState().place(mode, position)
    const unit = usePlan.getState().units.find((u) => u.id === id)
    return `Placed ${side} ${echelon} ${unit?.name ?? ''}.`.replace(/\s+/g, ' ').trim()
  },

  place_fortification(args: Args): string {
    const blocked = requireBattlefield()
    if (blocked) return blocked

    const position = coords(args)
    if (!position) return 'I need a longitude and latitude to place the fortification.'

    const mode = FORTIFICATION_MODE[str(args, 'kind')?.toLowerCase() ?? '']
    if (!mode) return 'Is that a trench or a prepared trench?'

    const id = usePlan.getState().place(mode, position)
    const unit = usePlan.getState().units.find((u) => u.id === id)
    return `Placed ${unit?.typeLabel.toLowerCase() ?? 'fortification'} ${unit?.name ?? ''}.`
      .replace(/\s+/g, ' ')
      .trim()
  },

  place_objective(args: Args): string {
    const blocked = requireBattlefield()
    if (blocked) return blocked

    const position = coords(args)
    if (!position) return 'I need a longitude and latitude for the objective.'

    const id = usePlan.getState().place('place-objective', position)
    const objective = usePlan.getState().objectives.find((o) => o.id === id)
    if (!objective) return 'Failed to place the objective.'

    const radius = num(args, 'radius_meters')
    if (radius !== null && radius > 0) {
      // The store stamps a default radius; honour an explicit one by replacing
      // the objective rather than mutating it.
      usePlan.setState((s) => ({
        objectives: s.objectives.map((o) => (o.id === id ? { ...o, radiusMeters: radius } : o)),
      }))
    }
    return `Placed ${objective.name} with a ${radius ?? objective.radiusMeters} metre radius.`
  },

  draw_route(args: Args): string {
    const blocked = requireBattlefield()
    if (blocked) return blocked

    const callsign = str(args, 'unit_callsign')
    if (!callsign) return 'Which unit is this route for?'

    const { units } = usePlan.getState()
    const unit = units.find((u) => u.name.toLowerCase() === callsign.toLowerCase())
    if (!unit) {
      return units.length === 0
        ? 'There are no units on the map yet — place one first.'
        : `No unit called "${callsign}". Current units: ${units.map((u) => u.name).join(', ')}.`
    }

    const points = waypoints(args)
    if (points.length < 1) return 'I need at least one waypoint for the route.'

    // Routes are anchored to their start unit, so the unit's own position is
    // always the first point regardless of what the model supplied.
    const full = [unit.position, ...points]
    // Fall back to the operator's saved planning defaults, not module constants
    // -- otherwise a voice-drawn route carries a different gait and body mass
    // than one drawn by hand, and their ETA/energy estimates disagree.
    const settings = useSettings.getState()
    const movementType = (str(args, 'movement_type') ?? settings.defaultMovementType) as MovementType

    const requested = str(args, 'load_preset')
    const explicit: DefaultLoadPreset | null =
      requested === 'light' || requested === 'fighting' || requested === 'approach'
        ? requested
        : null
    // An explicit preset overrides the carried mass but keeps the operator's
    // own body mass, which is a property of the soldier, not the order.
    const base = defaultLoadout()
    const loadout = explicit
      ? { ...base, loadMassKg: LOAD_PRESETS[explicit].loadMassKg, preset: explicit }
      : base

    usePlan.getState().addRoute({
      side: unit.side,
      startUnitId: unit.id,
      points: full,
      endRef: null,
      movementType,
      loadout,
    })

    const { grid } = useBattleground.getState()
    const analysis = analyzePlan(usePlan.getState().routes, grid)
    if (!analysis) return `Drew a ${movementType} route for ${unit.name}.`

    const metrics = analysis.routes[analysis.routes.length - 1]
    const warnings = analysis.warnings.filter((w) => w.severity === 'critical')

    return (
      `Drew a ${movementType} route for ${unit.name}: ${round(metrics?.lengthMeters ?? 0)} metres, ` +
      `about ${round(metrics?.etaMinutes ?? 0)} minutes.` +
      (warnings.length > 0
        ? ` Critical: ${[...new Set(warnings.map((w) => w.message))].join('; ')}.`
        : ' No critical warnings.')
    )
  },

  get_plan_state(): string {
    return planSummary()
  },

  get_terrain_at(args: Args): string {
    const blocked = requireBattlefield()
    if (blocked) return blocked

    const position = coords(args)
    if (!position) return 'I need a longitude and latitude to sample.'

    const grid = useBattleground.getState().grid!
    const cell = sampleCell(grid, position.longitude, position.latitude)
    if (!cell) return 'That point is outside the generated battlefield.'

    return (
      `${cell.clsName}: ${round(cell.elevation)} metres elevation, ${round(cell.slopeDeg)} degree slope. ` +
      `Cover ${cell.cover}, concealment ${cell.concealment}, exposure ${cell.visibility}, ambush potential ${cell.ambush}. ` +
      `Going is ${cell.moveCostFactor.toFixed(1)} times the cost of clear ground.`
    )
  },

  analyze_plan(): string {
    const blocked = requireBattlefield()
    if (blocked) return blocked

    const { grid } = useBattleground.getState()
    const analysis = analyzePlan(usePlan.getState().routes, grid)
    if (!analysis || analysis.routes.length === 0) {
      return 'No routes are drawn yet, so there is nothing to analyse.'
    }

    const criticals = analysis.warnings.filter((w) => w.severity === 'critical')
    const confidence =
      criticals.length > 0 || analysis.exposure > 0.35
        ? 'low'
        : analysis.exposure > 0.15
          ? 'medium'
          : 'high'

    const warningText =
      analysis.warnings.length === 0
        ? 'No warnings.'
        : [...new Set(analysis.warnings.map((w) => `${w.severity}: ${w.message}`))].join('; ')

    return (
      `${analysis.routes.length} route${analysis.routes.length === 1 ? '' : 's'}, ` +
      `${round(analysis.totalEtaMinutes)} minutes to objective, ` +
      `${round(analysis.exposure * 100)} percent plan exposure, confidence ${confidence}. ${warningText}`
    )
  },

  delete_element(args: Args): string {
    const name = str(args, 'name')
    if (!name) return 'Which element should I remove?'

    const state = usePlan.getState()
    const found = findElementByName(state, name)
    if (!found) return `Nothing on the map is called "${name}".`

    // Deleting a unit takes its routes with it, so say what will actually go.
    const attached =
      found.kind === 'unit'
        ? state.routes.filter(
            (r) => r.startUnitId === found.id || (r.endRef?.kind === 'unit' && r.endRef.id === found.id),
          ).length
        : state.routes.filter((r) => r.endRef?.kind === 'objective' && r.endRef.id === found.id).length

    return requestConfirmation({
      summary:
        attached > 0
          ? `Remove ${found.label} and ${attached} attached route${attached === 1 ? '' : 's'}?`
          : `Remove ${found.label}?`,
      spoken:
        attached > 0
          ? `That will also remove ${attached} route${attached === 1 ? '' : 's'} attached to ${found.label}. Confirm on screen to go ahead.`
          : `Confirm on screen to remove ${found.label}.`,
      commit: () => {
        usePlan.getState().deleteElement(found.id)
        return `Removed ${found.label}.`
      },
    })
  },

  clear_plan(): string {
    const { units, objectives, routes } = usePlan.getState()
    const total = units.length + objectives.length + routes.length
    if (total === 0) return 'The plan is already empty.'

    return requestConfirmation({
      summary: `Clear the whole plan — ${total} element${total === 1 ? '' : 's'}?`,
      spoken: `That would clear the entire plan, ${total} element${total === 1 ? '' : 's'}. Confirm on screen if you mean it.`,
      commit: () => {
        usePlan.getState().clearPlan()
        return `Cleared the plan — ${total} element${total === 1 ? '' : 's'} removed.`
      },
    })
  },

  set_heatmap(args: Args): string {
    const blocked = requireBattlefield()
    if (blocked) return blocked

    const metric = str(args, 'metric')?.toLowerCase() as HeatmapMetric | undefined
    if (!metric) return 'Which heatmap should I show?'
    useBattleground.getState().setHeatmap(metric)
    return metric === 'none' ? 'Cleared the heatmap.' : `Showing the ${metric} layer.`
  },

  set_view_mode(args: Args): string {
    const mode = str(args, 'mode')?.toLowerCase()
    if (mode !== 'globe' && mode !== 'topo' && mode !== 'photo') {
      return 'Pick globe, topo or photo.'
    }
    try {
      requireHost('setViewMode')(mode as ViewMode)
      return `Switched to ${mode} view.`
    } catch (error: unknown) {
      return errorMessage(error, 'could not switch view')
    }
  },

  async save_plan(args: Args): Promise<string> {
    const blocked = requireBattlefield()
    if (blocked) return blocked

    try {
      await requireHost('savePlan')(str(args, 'name') ?? undefined)
      return 'Plan saved.'
    } catch (error: unknown) {
      return errorMessage(error, 'could not save the plan')
    }
  },

  async list_plans(): Promise<string> {
    try {
      const plans = await listPlans()
      if (plans.length === 0) return 'There are no saved plans yet.'
      return `${plans.length} saved plan${plans.length === 1 ? '' : 's'}: ${plans
        .slice(0, 8)
        .map((p) => `${p.name} on ${p.battlegroundName}`)
        .join('; ')}.`
    } catch (error: unknown) {
      return errorMessage(error, 'could not list plans')
    }
  },
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

export type AssistantToolName = keyof typeof assistantTools
