import { config } from '../config'
import type { Weather } from '../types'

/**
 * Hourly conditions across the mission window, plus the day's light table.
 *
 * `fetchWeather` answers "what is it like now", which is all the battlefield
 * reveal needed. A plan spans hours, so planning against a single instant hides
 * the thing that actually matters — that the approach march happens in daylight
 * and the assault doesn't (#57).
 *
 * Like current conditions, this is enrichment: failures return null rather than
 * breaking anything that depends on it.
 */

export interface ForecastHour extends Weather {
  /** ISO local time for the AO's own timezone, not the operator's */
  time: string
}

export interface LightTable {
  /** ISO local time; null when the sun doesn't rise or set that day */
  sunrise: string | null
  sunset: string | null
}

export interface Forecast {
  timezone: string
  hours: ForecastHour[]
  /** keyed by ISO date (YYYY-MM-DD) in the AO's timezone */
  light: Record<string, LightTable>
}

/** How far ahead to fetch. Three days covers any plausible mission window
 *  without pulling Open-Meteo's full 16-day default. */
const FORECAST_DAYS = 3

const num = (arr: unknown, i: number, fallback: number): number =>
  Array.isArray(arr) && typeof arr[i] === 'number' ? (arr[i] as number) : fallback

export async function fetchForecast(lat: number, lon: number): Promise<Forecast | null> {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    hourly:
      'temperature_2m,precipitation,cloud_cover,visibility,wind_speed_10m,wind_direction_10m,is_day',
    daily: 'sunrise,sunset',
    forecast_days: String(FORECAST_DAYS),
    timezone: 'auto',
  })

  try {
    const res = await fetch(`${config.openMeteoUrl}?${params}`, {
      signal: AbortSignal.timeout(config.weatherTimeoutMs),
    })
    if (!res.ok) throw new Error(`open-meteo HTTP ${res.status}`)

    const body = (await res.json()) as {
      timezone?: string
      hourly?: Record<string, unknown>
      daily?: Record<string, unknown>
    }
    const h = body.hourly
    const times = h?.time
    if (!Array.isArray(times)) return null

    const hours: ForecastHour[] = times.map((time, i) => ({
      time: String(time),
      temperatureC: num(h?.temperature_2m, i, 0),
      windSpeedKmh: num(h?.wind_speed_10m, i, 0),
      windDirectionDeg: num(h?.wind_direction_10m, i, 0),
      cloudCoverPct: num(h?.cloud_cover, i, 0),
      precipitationMm: num(h?.precipitation, i, 0),
      visibilityM: num(h?.visibility, i, 10_000),
      isDay: num(h?.is_day, i, 1) === 1,
    }))

    const light: Record<string, LightTable> = {}
    const days = body.daily?.time
    if (Array.isArray(days)) {
      const sunrise = body.daily?.sunrise
      const sunset = body.daily?.sunset
      days.forEach((day, i) => {
        const pick = (arr: unknown): string | null =>
          Array.isArray(arr) && typeof arr[i] === 'string' ? (arr[i] as string) : null
        light[String(day)] = { sunrise: pick(sunrise), sunset: pick(sunset) }
      })
    }

    return { timezone: body.timezone ?? 'UTC', hours, light }
  } catch (error: unknown) {
    console.warn('[forecast] fetch failed:', error instanceof Error ? error.message : error)
    return null
  }
}

/** The forecast hour nearest a given instant, or null when the window doesn't
 *  cover it. Used to answer "what will conditions be at H-hour". */
export function hourAt(forecast: Forecast, when: Date): ForecastHour | null {
  if (forecast.hours.length === 0) return null

  const target = when.getTime()
  let best: ForecastHour | null = null
  let bestGap = Infinity

  for (const hour of forecast.hours) {
    const gap = Math.abs(new Date(hour.time).getTime() - target)
    if (gap < bestGap) {
      bestGap = gap
      best = hour
    }
  }

  // Beyond half an hour past either end of the window there is no honest
  // answer -- better to say "outside the forecast" than to extrapolate.
  return bestGap <= 90 * 60 * 1000 ? best : null
}
