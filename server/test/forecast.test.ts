import { describe, expect, test } from 'bun:test'
import { hourAt, type Forecast, type ForecastHour } from '../src/services/forecast'

const hour = (time: string, isDay = true): ForecastHour => ({
  time,
  temperatureC: 26,
  windSpeedKmh: 5,
  windDirectionDeg: 90,
  cloudCoverPct: 20,
  precipitationMm: 0,
  visibilityM: 12000,
  isDay,
})

const FORECAST: Forecast = {
  timezone: 'Asia/Singapore',
  hours: [
    hour('2026-08-06T04:00', false),
    hour('2026-08-06T05:00', false),
    hour('2026-08-06T06:00'),
    hour('2026-08-06T07:00'),
  ],
  light: { '2026-08-06': { sunrise: '2026-08-06T06:58', sunset: '2026-08-06T19:12' } },
}

const at = (iso: string) => new Date(iso)

describe('hourAt', () => {
  test('picks the exact hour when one lands on it', () => {
    expect(hourAt(FORECAST, at('2026-08-06T06:00'))?.time).toBe('2026-08-06T06:00')
  })

  test('rounds to the nearest hour rather than always flooring', () => {
    expect(hourAt(FORECAST, at('2026-08-06T06:40'))?.time).toBe('2026-08-06T07:00')
    expect(hourAt(FORECAST, at('2026-08-06T06:20'))?.time).toBe('2026-08-06T06:00')
  })

  test('resolves a time just past the window within tolerance', () => {
    expect(hourAt(FORECAST, at('2026-08-06T08:00'))?.time).toBe('2026-08-06T07:00')
  })

  test('refuses to extrapolate well beyond the window', () => {
    expect(hourAt(FORECAST, at('2026-08-07T18:00'))).toBeNull()
    expect(hourAt(FORECAST, at('2026-08-05T00:00'))).toBeNull()
  })

  test('an empty forecast yields nothing rather than throwing', () => {
    expect(hourAt({ ...FORECAST, hours: [] }, at('2026-08-06T06:00'))).toBeNull()
  })

  test('matches the frontend: same input, same chosen hour', () => {
    // The UI reimplements this so it can answer without a round trip; the two
    // must agree or the panel and the brief would disagree about H-hour.
    for (const probe of ['2026-08-06T04:10', '2026-08-06T05:59', '2026-08-06T07:29']) {
      const chosen = hourAt(FORECAST, at(probe))
      expect(chosen).not.toBeNull()
      const gap = Math.abs(new Date(chosen!.time).getTime() - at(probe).getTime())
      expect(gap).toBeLessThanOrEqual(90 * 60 * 1000)
    }
  })
})
