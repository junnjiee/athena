import { create } from 'zustand'
import { fetchForecast } from '../lib/api'
import type { Forecast, ForecastHour } from '../types/forecast'

/**
 * The mission window: when the plan happens, not just where.
 *
 * Route estimates already produce durations, and the bottom bar shows a time to
 * objective, but nothing anchored those to a clock — so two units' timings
 * could not be related to each other, and "night" was a display toggle rather
 * than a fact about the mission (#57).
 *
 * H-hour is stored as an epoch millisecond so it survives serialization
 * unambiguously; the UI renders it in the AO's own timezone, which is what a
 * commander plans against.
 */

interface MissionState {
  /** Plan start, epoch ms. Null until the operator sets one. */
  hHour: number | null
  forecast: Forecast | null
  forecastState: 'idle' | 'loading' | 'error'

  setHHour: (at: number | null) => void
  /** Shifts H-hour by whole minutes; no-op when unset. */
  nudgeHHour: (minutes: number) => void
  loadForecast: (battlegroundId: string) => Promise<void>
  clearMission: () => void
}

/** Monotonic id of the newest forecast request, so a slower response for an
 *  abandoned battleground can be discarded instead of overwriting the current
 *  one. Module-level rather than store state: it is control flow, not UI. */
let forecastRequest = 0

export const useMission = create<MissionState>((set, get) => ({
  hHour: null,
  forecast: null,
  forecastState: 'idle',

  setHHour: (at) => set({ hHour: at }),

  nudgeHHour: (minutes) => {
    const current = get().hHour
    if (current === null) return
    set({ hHour: current + minutes * 60_000 })
  },

  async loadForecast(battlegroundId) {
    // Track which AO the newest request is for. Guarding on `loading` alone
    // would drop the request for a battleground the user just switched to, and
    // let the previous AO's response land as if it described the new ground.
    const request = ++forecastRequest
    set({ forecastState: 'loading', forecast: null })
    try {
      const forecast = await fetchForecast(battlegroundId)
      if (request !== forecastRequest) return
      set({ forecast, forecastState: 'idle' })
    } catch {
      // The forecast is enrichment; a failure must not block planning.
      if (request !== forecastRequest) return
      set({ forecast: null, forecastState: 'error' })
    }
  },

  clearMission: () => set({ hHour: null, forecast: null, forecastState: 'idle' }),
}))

/** Forecast hour nearest `when`, or null when it falls outside the window.
 *  Mirrors the server's `hourAt` so the UI and the brief agree. */
export function hourAt(forecast: Forecast | null, when: number): ForecastHour | null {
  if (!forecast || forecast.hours.length === 0) return null

  let best: ForecastHour | null = null
  let bestGap = Infinity
  for (const hour of forecast.hours) {
    const gap = Math.abs(new Date(hour.time).getTime() - when)
    if (gap < bestGap) {
      bestGap = gap
      best = hour
    }
  }
  return bestGap <= 90 * 60 * 1000 ? best : null
}

/** Sunrise/sunset for the day `when` falls on, in the AO's timezone. */
export function lightFor(forecast: Forecast | null, when: number) {
  if (!forecast) return null
  // Forecast timestamps are already local to the AO, so the date key comes from
  // the nearest hour's own string rather than from the operator's clock.
  const nearest = hourAt(forecast, when)
  const key = (nearest?.time ?? new Date(when).toISOString()).slice(0, 10)
  return forecast.light[key] ?? null
}
