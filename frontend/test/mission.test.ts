import { beforeEach, describe, expect, test } from 'bun:test'
import { hourAt, lightFor, useMission } from '../src/state/mission'
import type { Forecast, ForecastHour } from '../src/types/forecast'

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
  light: {
    '2026-08-06': { sunrise: '2026-08-06T06:58', sunset: '2026-08-06T19:12' },
  },
}

const at = (iso: string) => new Date(iso).getTime()

beforeEach(() => {
  useMission.getState().clearMission()
})

describe('hourAt', () => {
  test('picks the exact hour when one lands on it', () => {
    expect(hourAt(FORECAST, at('2026-08-06T06:00'))?.time).toBe('2026-08-06T06:00')
  })

  test('rounds to the nearest hour, not the earlier one', () => {
    expect(hourAt(FORECAST, at('2026-08-06T06:40'))?.time).toBe('2026-08-06T07:00')
    expect(hourAt(FORECAST, at('2026-08-06T06:20'))?.time).toBe('2026-08-06T06:00')
  })

  test('carries the day/night flag of the chosen hour', () => {
    expect(hourAt(FORECAST, at('2026-08-06T05:00'))?.isDay).toBe(false)
    expect(hourAt(FORECAST, at('2026-08-06T07:00'))?.isDay).toBe(true)
  })

  test('a time just outside the window still resolves within the tolerance', () => {
    expect(hourAt(FORECAST, at('2026-08-06T08:00'))?.time).toBe('2026-08-06T07:00')
  })

  test('well beyond the window there is no honest answer', () => {
    expect(hourAt(FORECAST, at('2026-08-07T18:00'))).toBeNull()
    expect(hourAt(FORECAST, at('2026-08-05T00:00'))).toBeNull()
  })

  test('an absent or empty forecast yields nothing rather than throwing', () => {
    expect(hourAt(null, at('2026-08-06T06:00'))).toBeNull()
    expect(hourAt({ ...FORECAST, hours: [] }, at('2026-08-06T06:00'))).toBeNull()
  })
})

describe('lightFor', () => {
  test('finds the light table for the day the time falls on', () => {
    expect(lightFor(FORECAST, at('2026-08-06T06:00'))).toEqual({
      sunrise: '2026-08-06T06:58',
      sunset: '2026-08-06T19:12',
    })
  })

  test('a day with no table returns null rather than a partial one', () => {
    expect(lightFor(FORECAST, at('2026-08-09T06:00'))).toBeNull()
  })

  test('no forecast means no light table', () => {
    expect(lightFor(null, at('2026-08-06T06:00'))).toBeNull()
  })
})

describe('H-hour', () => {
  test('starts unset', () => {
    expect(useMission.getState().hHour).toBeNull()
  })

  test('nudging shifts by whole minutes', () => {
    const base = at('2026-08-06T06:00')
    useMission.getState().setHHour(base)
    useMission.getState().nudgeHHour(15)
    expect(useMission.getState().hHour).toBe(base + 15 * 60_000)
    useMission.getState().nudgeHHour(-60)
    expect(useMission.getState().hHour).toBe(base - 45 * 60_000)
  })

  test('nudging an unset H-hour does nothing rather than inventing one', () => {
    useMission.getState().nudgeHHour(30)
    expect(useMission.getState().hHour).toBeNull()
  })

  test('clearMission resets the window and the forecast', () => {
    useMission.getState().setHHour(at('2026-08-06T06:00'))
    useMission.setState({ forecast: FORECAST })
    useMission.getState().clearMission()

    const state = useMission.getState()
    expect(state.hHour).toBeNull()
    expect(state.forecast).toBeNull()
    expect(state.forecastState).toBe('idle')
  })
})
