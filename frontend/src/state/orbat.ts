import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { persistedStorage } from './persistence'
import {
  DEFAULT_TEMPLATES,
  STRENGTH_RANGE,
  VISION_RANGE_M,
  type Echelon,
  type UnitTemplate,
} from '../types/orbat'
import type { ForceSide } from '../types/entities'

/**
 * The commander's order of battle — reusable unit establishments.
 *
 * Persisted to localStorage alongside settings: this is a per-operator working
 * set, not project data, and the app has no accounts yet. Server persistence is
 * tracked in the settings follow-up issue.
 */

interface OrbatState {
  templates: UnitTemplate[]

  addTemplate: (side: ForceSide, echelon: Echelon) => string
  updateTemplate: (id: string, patch: Partial<Omit<UnitTemplate, 'id'>>) => void
  removeTemplate: (id: string) => void
  resetToDefaults: () => void
}

const clamp = (n: number, min: number, max: number) =>
  Math.min(Math.max(Math.round(n), min), max)

/** Normalizes the numeric fields so a hand-typed value can't produce a unit of
 *  zero soldiers or a 40 km sightline. */
function sanitize(patch: Partial<Omit<UnitTemplate, 'id'>>): Partial<Omit<UnitTemplate, 'id'>> {
  const next = { ...patch }
  if (next.strength !== undefined) {
    next.strength = clamp(next.strength, STRENGTH_RANGE.min, STRENGTH_RANGE.max)
  }
  if (next.visionRangeM !== undefined) {
    next.visionRangeM = clamp(next.visionRangeM, VISION_RANGE_M.min, VISION_RANGE_M.max)
  }
  return next
}

function seeded(): UnitTemplate[] {
  return DEFAULT_TEMPLATES.map((t) => ({ ...t, id: crypto.randomUUID() }))
}

export const useOrbat = create<OrbatState>()(
  persist(
    (set) => ({
      templates: seeded(),

      addTemplate(side, echelon) {
        const id = crypto.randomUUID()
        set((s) => ({
          templates: [
            ...s.templates,
            {
              id,
              name: `New ${echelon}`,
              side,
              echelon,
              strength: echelon === 'platoon' ? 21 : 7,
              visionRangeM: 300,
              loadPreset: 'fighting',
              notes: '',
            },
          ],
        }))
        return id
      },

      updateTemplate: (id, patch) =>
        set((s) => ({
          templates: s.templates.map((t) => (t.id === id ? { ...t, ...sanitize(patch) } : t)),
        })),

      removeTemplate: (id) => set((s) => ({ templates: s.templates.filter((t) => t.id !== id) })),

      resetToDefaults: () => set({ templates: seeded() }),
    }),
    { name: 'athena-orbat', storage: persistedStorage },
  ),
)

/** The establishment a placement tool should stamp down: first template
 *  matching that side and echelon, or null when the operator has deleted them
 *  all (placement then falls back to bare markers). */
export function templateFor(side: ForceSide, echelon: Echelon): UnitTemplate | null {
  return useOrbat.getState().templates.find((t) => t.side === side && t.echelon === echelon) ?? null
}
