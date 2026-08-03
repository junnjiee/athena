import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  DEFAULT_BODY_MASS_KG,
  DEFAULT_MOVEMENT,
  LOAD_PRESETS,
  type LoadPreset,
  type MovementLoadout,
  type MovementType,
} from '../types/movement'

/**
 * Operator preferences.
 *
 * Persisted to localStorage rather than the server: these are per-machine
 * display and drawing defaults, and the app has no user accounts yet. Moving
 * them server-side is tracked in the settings follow-up issue.
 *
 * Planning defaults seed the drawing tools; they don't retroactively change
 * routes already drawn, which keep whatever gait/loadout they were drawn with.
 */

/** Presets a user can pick as their default — 'custom' only ever arises from
 *  hand-editing a specific route, so it isn't a meaningful default. */
export type DefaultLoadPreset = Exclude<LoadPreset, 'custom'>

interface SettingsState {
  defaultMovementType: MovementType
  defaultLoadPreset: DefaultLoadPreset
  bodyMassKg: number
  /** show grid references as MGRS rather than decimal degrees */
  useMGRS: boolean
  /** start new battlefields with the night overlay on */
  nightByDefault: boolean
  /** let the assistant dock appear on the battleground map */
  assistantEnabled: boolean

  setDefaultMovementType: (type: MovementType) => void
  setDefaultLoadPreset: (preset: DefaultLoadPreset) => void
  setBodyMassKg: (kg: number) => void
  setUseMGRS: (use: boolean) => void
  setNightByDefault: (night: boolean) => void
  setAssistantEnabled: (enabled: boolean) => void
  resetToDefaults: () => void
}

const DEFAULTS = {
  defaultMovementType: DEFAULT_MOVEMENT,
  defaultLoadPreset: 'fighting' as DefaultLoadPreset,
  bodyMassKg: DEFAULT_BODY_MASS_KG,
  useMGRS: true,
  nightByDefault: false,
  assistantEnabled: true,
}

/** Body mass outside this range is a mis-entry, not a soldier. */
const MIN_BODY_MASS_KG = 40
const MAX_BODY_MASS_KG = 150

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULTS,

      setDefaultMovementType: (defaultMovementType) => set({ defaultMovementType }),
      setDefaultLoadPreset: (defaultLoadPreset) => set({ defaultLoadPreset }),
      setBodyMassKg: (kg) =>
        set({ bodyMassKg: Math.min(Math.max(Math.round(kg), MIN_BODY_MASS_KG), MAX_BODY_MASS_KG) }),
      setUseMGRS: (useMGRS) => set({ useMGRS }),
      setNightByDefault: (nightByDefault) => set({ nightByDefault }),
      setAssistantEnabled: (assistantEnabled) => set({ assistantEnabled }),
      resetToDefaults: () => set({ ...DEFAULTS }),
    }),
    { name: 'athena-settings' },
  ),
)

/** The loadout new routes start from, per the operator's saved preferences. */
export function defaultLoadout(): MovementLoadout {
  const { bodyMassKg, defaultLoadPreset } = useSettings.getState()
  return {
    bodyMassKg,
    loadMassKg: LOAD_PRESETS[defaultLoadPreset].loadMassKg,
    preset: defaultLoadPreset,
  }
}
