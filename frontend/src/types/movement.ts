/**
 * Movement model for drawn routes.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * FUTURE-API CONTRACT
 * ─────────────────────────────────────────────────────────────────────────
 * These types are the interface a future soldier-agent simulation consumes. A
 * drawn route carries a `movementType` (the gait) and a `MovementLoadout`
 * (body + carried mass). Together with the per-cell terrain the route crosses
 * (slope, land-cover class) and the battlefield weather, that is the complete
 * input an agent needs to model:
 *
 *   - speed         ← gait base speed × slope (Tobler) × weather
 *   - energy cost   ← Pandolf load-carriage metabolics (body + load + grade + speed)
 *   - fatigue       ← accumulated metabolic intensity over time
 *   - detectability ← gait stealth/noise/exposure + terrain concealment (future)
 *
 * Nothing here runs a simulation. `lib/movement.ts` computes a transparent
 * *estimate* at draw time so the operator sees how slope/load/weather bend a
 * route's cost; the real per-agent physiology lands when the agent API is wired.
 */

export type MovementType = 'prowl' | 'patrol' | 'charge'

export type Posture = 'prone' | 'crouch' | 'upright'

/** Static tactical characteristics of a gait. All 0–1 fields are unitless. */
export interface MovementProfile {
  type: MovementType
  label: string
  /** short operator-facing description */
  blurb: string
  /** sustainable speed on flat, clear ground (m/s) */
  baseSpeedMs: number
  /** concealment posture: 1 = maximally hidden/low silhouette */
  stealth: number
  /** acoustic signature: 1 = loudest */
  noise: number
  /** metabolic multiplier vs. an efficient walk (crawl & rush are both wasteful) */
  energyRate: number
  posture: Posture
  /** how exposed to observation this gait is vs. a standing walk (crawl < walk < rush) */
  exposureMultiplier: number
}

/** Ordered slowest/stealthiest → fastest/loudest; also the toolbar order. */
export const MOVEMENT_PROFILES: Record<MovementType, MovementProfile> = {
  prowl: {
    type: 'prowl',
    label: 'Prowl',
    blurb: 'Stealth stalk — crouched, quiet, deliberate',
    baseSpeedMs: 0.7,
    stealth: 0.85,
    noise: 0.25,
    energyRate: 1.8,
    posture: 'crouch',
    exposureMultiplier: 0.5,
  },
  patrol: {
    type: 'patrol',
    label: 'Patrol',
    blurb: 'Cautious tactical pace, alert and balanced',
    baseSpeedMs: 1.1,
    stealth: 0.55,
    noise: 0.45,
    energyRate: 1.15,
    posture: 'upright',
    exposureMultiplier: 0.85,
  },
  charge: {
    type: 'charge',
    label: 'Charge',
    blurb: 'Assault dash — close fast; loud and exhausting',
    baseSpeedMs: 3.0,
    stealth: 0.1,
    noise: 0.95,
    energyRate: 2.5,
    posture: 'upright',
    exposureMultiplier: 1.1,
  },
}

export const MOVEMENT_ORDER: MovementType[] = ['prowl', 'patrol', 'charge']

export const DEFAULT_MOVEMENT: MovementType = 'patrol'

/** Soldier mass model — the load side of the metabolic estimate. */
export interface MovementLoadout {
  /** operator body mass, kg */
  bodyMassKg: number
  /** carried equipment/load, kg */
  loadMassKg: number
  /** which preset this came from (for the UI); 'custom' if hand-set */
  preset: LoadPreset
}

export type LoadPreset = 'light' | 'fighting' | 'approach' | 'custom'

/** Standard infantry load classifications (kg of carried equipment). */
export const LOAD_PRESETS: Record<Exclude<LoadPreset, 'custom'>, { label: string; loadMassKg: number }> = {
  light: { label: 'Light', loadMassKg: 14 },
  fighting: { label: 'Fighting', loadMassKg: 25 },
  approach: { label: 'Approach', loadMassKg: 35 },
}

export const DEFAULT_BODY_MASS_KG = 75

export function loadoutFromPreset(preset: Exclude<LoadPreset, 'custom'>): MovementLoadout {
  return {
    bodyMassKg: DEFAULT_BODY_MASS_KG,
    loadMassKg: LOAD_PRESETS[preset].loadMassKg,
    preset,
  }
}

export const DEFAULT_LOADOUT: MovementLoadout = loadoutFromPreset('fighting')

/** Draw-time cost preview for a route under a gait + loadout + terrain + weather. */
export interface MovementEstimate {
  distanceM: number
  durationMin: number
  /** metabolic energy expenditure estimate, kilojoules */
  energyKJ: number
  /** 0–100 accumulated exertion index (intensity × duration) */
  fatigueIndex: number
  avgSpeedMs: number
  /** how much slower than flat-clear this route is, percent (terrain drag) */
  terrainPenaltyPct: number
}
