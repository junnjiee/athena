import type { ForceSide } from './entities'
import type { LoadPreset } from './movement'

/**
 * Order of battle: the reusable force list a commander plans with.
 *
 * A placed marker on the map is an *instance*; a template is the establishment
 * it was stamped from. Templates carry the fields the simulation engine's
 * `Soldier` actually models — strength and vision range — so a deployment
 * drawing can hand them straight to the engine instead of it inventing
 * defaults per marker.
 */

export type Echelon = 'section' | 'platoon'

export interface UnitTemplate {
  id: string
  /** display name for the establishment, e.g. "Rifle Section" */
  name: string
  side: ForceSide
  echelon: Echelon
  /** soldiers in the unit — one engine agent each */
  strength: number
  /** how far a soldier of this unit can see, metres */
  visionRangeM: number
  /** carried-load class new routes for this unit start from */
  loadPreset: Exclude<LoadPreset, 'custom'>
  /** free-text note for the operator; never reaches the engine */
  notes: string
}

/** Sane starting establishments so the page is useful before anyone edits it.
 *  SAF-flavoured to match the tactical symbols the toolbar already offers. */
export const DEFAULT_TEMPLATES: Omit<UnitTemplate, 'id'>[] = [
  {
    name: 'Rifle Section',
    side: 'blue',
    echelon: 'section',
    strength: 7,
    visionRangeM: 300,
    loadPreset: 'fighting',
    notes: 'Standard seven-man section.',
  },
  {
    name: 'Rifle Platoon',
    side: 'blue',
    echelon: 'platoon',
    strength: 21,
    visionRangeM: 300,
    loadPreset: 'fighting',
    notes: 'Three sections plus platoon HQ.',
  },
  {
    name: 'Recon Section',
    side: 'blue',
    echelon: 'section',
    strength: 4,
    visionRangeM: 500,
    loadPreset: 'light',
    notes: 'Light order, longer observation range.',
  },
  {
    name: 'Enemy Section',
    side: 'red',
    echelon: 'section',
    strength: 7,
    visionRangeM: 300,
    loadPreset: 'fighting',
    notes: 'Assumed peer establishment.',
  },
  {
    name: 'Enemy Platoon',
    side: 'red',
    echelon: 'platoon',
    strength: 21,
    visionRangeM: 300,
    loadPreset: 'fighting',
    notes: 'Assumed peer establishment.',
  },
]

/** Bounds that keep a hand-typed value physically sensible. */
export const STRENGTH_RANGE = { min: 1, max: 60 } as const
export const VISION_RANGE_M = { min: 50, max: 2000 } as const
