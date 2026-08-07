/** Wire contract with athena-server — keep in sync with
 *  server/src/services/forecast.ts. */

import type { Weather } from './terrain'

export interface ForecastHour extends Weather {
  /** ISO local time in the AO's own timezone, not the operator's */
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
