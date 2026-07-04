import { config } from '../config'
import type { Weather } from '../types'

/** Current conditions from Open-Meteo (free, no key). Returns null on failure —
 *  weather is enrichment, never a reason to fail battlefield generation. */
export async function fetchWeather(lat: number, lon: number): Promise<Weather | null> {
  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    current:
      'temperature_2m,is_day,precipitation,cloud_cover,visibility,wind_speed_10m,wind_direction_10m',
    timezone: 'auto',
  })
  try {
    const res = await fetch(`${config.openMeteoUrl}?${params}`, {
      signal: AbortSignal.timeout(config.weatherTimeoutMs),
    })
    if (!res.ok) throw new Error(`open-meteo HTTP ${res.status}`)
    const body = (await res.json()) as {
      current?: Record<string, number>
    }
    const c = body.current
    if (!c) return null
    return {
      temperatureC: c.temperature_2m ?? 0,
      windSpeedKmh: c.wind_speed_10m ?? 0,
      windDirectionDeg: c.wind_direction_10m ?? 0,
      cloudCoverPct: c.cloud_cover ?? 0,
      precipitationMm: c.precipitation ?? 0,
      visibilityM: c.visibility ?? 10_000,
      isDay: c.is_day === 1,
    }
  } catch (error: unknown) {
    console.warn('[weather] fetch failed:', error instanceof Error ? error.message : error)
    return null
  }
}
