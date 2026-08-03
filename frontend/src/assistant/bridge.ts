import type { ViewMode } from '../components/globe/ViewModeToggle'
import type { LonLat } from '../types/entities'

/**
 * Imperative handles the assistant needs but that aren't application state.
 *
 * Most of what the assistant does goes straight through the zustand stores
 * (`state/plan.ts`, `state/battleground.ts`). Camera moves, the ground-selection
 * rectangle and the view-mode switch aren't state though — they're side effects
 * owned by whichever page currently holds the Cesium viewer. That page registers
 * its handlers here on mount, and the tool layer calls through this module.
 *
 * Same shape as `components/globe/ViewerBridge.tsx` uses for the viewer itself:
 * a module-level registry rather than prop-drilling through a context the
 * assistant lives outside of.
 */

export interface GeocodeHit {
  name: string
  longitude: number
  latitude: number
}

export interface AssistantHost {
  /** Geocode a place name and fly the camera to the best match. */
  searchGround: (query: string) => Promise<GeocodeHit[]>
  /** Draw the ground-selection box centred on a point; returns its true extent. */
  selectArea: (
    longitude: number,
    latitude: number,
    sizeMeters: number,
  ) => { widthMeters: number; heightMeters: number }
  /** Run the terrain pipeline over the current selection and resolve when the
   *  battlefield is ready (or reject with the pipeline's error). */
  generateBattleground: (name: string) => Promise<void>
  setViewMode: (mode: ViewMode) => void
  flyTo: (positions: LonLat[]) => void
  /** Persist the current plan; resolves with the saved plan's id. */
  savePlan: (name?: string) => Promise<string>
}

let host: Partial<AssistantHost> = {}

/** Called by the page that owns the map. Returns an unregister function. */
export function registerAssistantHost(handlers: Partial<AssistantHost>): () => void {
  host = { ...host, ...handlers }
  const keys = Object.keys(handlers) as (keyof AssistantHost)[]
  return () => {
    const next = { ...host }
    for (const key of keys) delete next[key]
    host = next
  }
}

/** Thrown when a tool needs a capability the current page doesn't provide —
 *  e.g. asking for a camera move while sitting on the Plans list. */
export class AssistantHostUnavailable extends Error {
  constructor(capability: keyof AssistantHost) {
    super(`"${capability}" is only available on the battleground map — navigate there first`)
    this.name = 'AssistantHostUnavailable'
  }
}

/** Fetches a registered handler, or throws a message the agent can speak. */
export function requireHost<K extends keyof AssistantHost>(capability: K): AssistantHost[K] {
  const handler = host[capability]
  if (!handler) throw new AssistantHostUnavailable(capability)
  return handler as AssistantHost[K]
}
