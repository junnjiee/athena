import { config } from '../../config'
import type { FeedDefinition } from './feed'

/**
 * Wave 1 Singapore feed definitions.
 *
 * Every endpoint here was verified against the live service. Two things that
 * verification turned up and that the parsers below encode:
 *
 * 1. **data.gov.sg runs two live surfaces, not one.** Weather and environment
 *    moved to `api-open.data.gov.sg/v2`; traffic images, taxi and carpark
 *    availability never migrated and still answer only on
 *    `api.data.gov.sg/v1`. Mixing them up gets a 404, not a redirect.
 * 2. **The traffic-camera roster has been thinned.** The feed documents ~90
 *    cameras and served 90 as recently as mid-June 2026; since early July it
 *    has returned 8 checkpoint cameras while `api_info.status` still reads
 *    "healthy". `assessCameraRoster` is what stops that being invisible.
 */

const V2 = 'https://api-open.data.gov.sg/v2/real-time/api'
const V1 = 'https://api.data.gov.sg/v1/transport'

const SODL = 'Singapore Open Data Licence'
const NEA = 'National Environment Agency (data.gov.sg)'
const PUB = "PUB, Singapore's National Water Agency (data.gov.sg)"
const LTA_GOV = 'Land Transport Authority (data.gov.sg)'
const LTA_DM = 'Land Transport Authority (DataMall)'
const HDB = 'Housing & Development Board (data.gov.sg)'

/* ------------------------------------------------------------------ shapes */

export interface StationValue {
  id: string
  name: string
  lat: number
  lon: number
  value: number | null
}

export interface StationFeed {
  readingType: string
  unit: string
  timestamp: string | null
  stations: StationValue[]
}

export interface TrafficCamera {
  id: string
  lat: number
  lon: number
  imageUrl: string
  capturedAt: string
  width: number
  height: number
}

export interface CameraFeed {
  cameras: TrafficCamera[]
  /** Documented roster size, for the health check — not a promise of delivery. */
  documentedCount: number
  timestamp: string | null
}

export interface PointEvent {
  lat: number
  lon: number
  kind: string | null
  text: string | null
  at: string | null
}

export interface EventFeed {
  timestamp: string | null
  events: PointEvent[]
}

export interface AreaForecast {
  name: string
  lat: number
  lon: number
  forecast: string
}

export interface ForecastFeed {
  validFrom: string | null
  validTo: string | null
  validText: string | null
  areas: AreaForecast[]
}

/* ----------------------------------------------------------------- helpers */

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) throw new Error('expected an object')
  return value as Record<string, unknown>
}

function asArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('expected an array')
  return value
}

/** Unwraps the v2 `{code, data, errorMsg}` envelope, failing loudly on error codes. */
function v2Data(raw: unknown): Record<string, unknown> {
  const body = asRecord(raw)
  if (body.code !== undefined && body.code !== 0) {
    throw new Error(`upstream code ${String(body.code)}: ${String(body.errorMsg ?? 'unknown')}`)
  }
  return asRecord(body.data)
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** Reads `{latitude, longitude}` in any of the casings the feeds use. */
function coords(value: unknown): { lat: number; lon: number } | null {
  if (typeof value !== 'object' || value === null) return null
  const r = value as Record<string, unknown>
  const lat = numberOrNull(r.latitude ?? r.lat ?? r.Latitude)
  const lon = numberOrNull(r.longitude ?? r.lon ?? r.Longitude)
  return lat !== null && lon !== null ? { lat, lon } : null
}

/**
 * Five NEA feeds — rainfall, air temperature, humidity, wind speed, wind
 * direction — are byte-identical in shape: a station list and timestamped
 * readings keyed by station id. Joining them here means every station layer in
 * the browser gets one already-joined array instead of doing the same join five
 * times.
 */
function parseStationFeed(raw: unknown): { data: StationFeed; upstreamAt: string | null } {
  const data = v2Data(raw)
  const stations = asArray(data.stations)
  const readings = Array.isArray(data.readings) ? data.readings : []
  const latest = readings.length > 0 ? asRecord(readings[0]) : null
  const timestamp = latest ? (typeof latest.timestamp === 'string' ? latest.timestamp : null) : null

  const values = new Map<string, number | null>()
  if (latest && Array.isArray(latest.data)) {
    for (const entry of latest.data) {
      const r = asRecord(entry)
      if (typeof r.stationId === 'string') values.set(r.stationId, numberOrNull(r.value))
    }
  }

  const out: StationValue[] = []
  for (const entry of stations) {
    const r = asRecord(entry)
    const id = typeof r.id === 'string' ? r.id : null
    const position = coords(r.location)
    if (!id || !position) continue
    out.push({
      id,
      name: typeof r.name === 'string' ? r.name : id,
      lat: position.lat,
      lon: position.lon,
      value: values.get(id) ?? null,
    })
  }

  return {
    data: {
      readingType: typeof data.readingType === 'string' ? data.readingType : '',
      unit: typeof data.readingUnit === 'string' ? data.readingUnit : '',
      timestamp,
      stations: out,
    },
    upstreamAt: timestamp,
  }
}

/**
 * The `records[].item.readings[]` shape shared by lightning and flood alerts.
 *
 * An empty `readings` array is the *normal* quiet state — no strikes, no active
 * flood — and must never be mistaken for a broken feed. Both were quiet when
 * this was written, so the per-reading field names below are read defensively:
 * whatever combination of `location`/`lat`/`lon` and `type`/`text` arrives, an
 * unrecognised reading is skipped rather than throwing the whole feed away.
 */
function parseEventFeed(raw: unknown): { data: EventFeed; upstreamAt: string | null } {
  const data = v2Data(raw)
  const records = Array.isArray(data.records) ? data.records : []
  if (records.length === 0) return { data: { timestamp: null, events: [] }, upstreamAt: null }

  const record = asRecord(records[0])
  const timestamp = typeof record.datetime === 'string' ? record.datetime : null
  const item = typeof record.item === 'object' && record.item !== null ? asRecord(record.item) : {}
  const readings = Array.isArray(item.readings) ? item.readings : []

  const events: PointEvent[] = []
  for (const entry of readings) {
    if (typeof entry !== 'object' || entry === null) continue
    const r = entry as Record<string, unknown>
    const position = coords(r.location) ?? coords(r)
    if (!position) continue
    events.push({
      lat: position.lat,
      lon: position.lon,
      kind: typeof r.type === 'string' ? r.type : null,
      text: typeof r.text === 'string' ? r.text : null,
      at: typeof r.datetime === 'string' ? r.datetime : timestamp,
    })
  }

  return { data: { timestamp, events }, upstreamAt: timestamp }
}

function parseTwoHourForecast(raw: unknown): { data: ForecastFeed; upstreamAt: string | null } {
  const data = v2Data(raw)
  const areas = Array.isArray(data.area_metadata) ? data.area_metadata : []
  const items = Array.isArray(data.items) ? data.items : []
  const item = items.length > 0 ? asRecord(items[0]) : null

  const positions = new Map<string, { lat: number; lon: number }>()
  for (const entry of areas) {
    const r = asRecord(entry)
    const position = coords(r.label_location)
    if (typeof r.name === 'string' && position) positions.set(r.name, position)
  }

  const out: AreaForecast[] = []
  if (item && Array.isArray(item.forecasts)) {
    for (const entry of item.forecasts) {
      const r = asRecord(entry)
      const name = typeof r.area === 'string' ? r.area : null
      const position = name ? positions.get(name) : undefined
      if (!name || !position) continue
      out.push({
        name,
        lat: position.lat,
        lon: position.lon,
        forecast: typeof r.forecast === 'string' ? r.forecast : '',
      })
    }
  }

  const period =
    item && typeof item.valid_period === 'object' && item.valid_period !== null
      ? asRecord(item.valid_period)
      : {}
  const timestamp = item && typeof item.timestamp === 'string' ? item.timestamp : null

  return {
    data: {
      validFrom: typeof period.start === 'string' ? period.start : null,
      validTo: typeof period.end === 'string' ? period.end : null,
      validText: typeof period.text === 'string' ? period.text : null,
      areas: out,
    },
    upstreamAt: timestamp,
  }
}

function parseTrafficImages(raw: unknown): { data: CameraFeed; upstreamAt: string | null } {
  const body = asRecord(raw)
  const items = Array.isArray(body.items) ? body.items : []
  if (items.length === 0) {
    return { data: { cameras: [], documentedCount: config.sgCameraRoster, timestamp: null }, upstreamAt: null }
  }
  const item = asRecord(items[0])
  const timestamp = typeof item.timestamp === 'string' ? item.timestamp : null

  const cameras: TrafficCamera[] = []
  for (const entry of asArray(item.cameras)) {
    const r = asRecord(entry)
    const position = coords(r.location)
    const id = typeof r.camera_id === 'string' ? r.camera_id : null
    const imageUrl = typeof r.image === 'string' ? r.image : null
    if (!position || !id || !imageUrl) continue
    const meta =
      typeof r.image_metadata === 'object' && r.image_metadata !== null
        ? asRecord(r.image_metadata)
        : {}
    cameras.push({
      id,
      lat: position.lat,
      lon: position.lon,
      imageUrl,
      capturedAt: typeof r.timestamp === 'string' ? r.timestamp : (timestamp ?? ''),
      width: numberOrNull(meta.width) ?? 1920,
      height: numberOrNull(meta.height) ?? 1080,
    })
  }

  return {
    data: { cameras, documentedCount: config.sgCameraRoster, timestamp },
    upstreamAt: timestamp,
  }
}

/**
 * The camera feed's own `api_info.status` reported "healthy" while serving 8 of
 * a documented ~90 cameras, so upstream self-reporting cannot be trusted here.
 * Roster size against the documented count is the only honest signal available.
 */
export function assessCameraRoster(data: CameraFeed): string | null {
  const have = data.cameras.length
  const expected = data.documentedCount
  if (have === 0) return 'no cameras in the feed'
  if (have < expected * config.sgCameraDegradedRatio) {
    return `${have} of ~${expected} documented cameras — upstream roster is thinned, coverage is not island-wide`
  }
  return null
}

function parseTaxis(raw: unknown): { data: EventFeed; upstreamAt: string | null } {
  const body = asRecord(raw)
  const features = Array.isArray(body.features) ? body.features : []
  const events: PointEvent[] = []
  let timestamp: string | null = null

  for (const entry of features) {
    const feature = asRecord(entry)
    const properties =
      typeof feature.properties === 'object' && feature.properties !== null
        ? asRecord(feature.properties)
        : {}
    if (typeof properties.timestamp === 'string') timestamp = properties.timestamp
    const geometry =
      typeof feature.geometry === 'object' && feature.geometry !== null
        ? asRecord(feature.geometry)
        : {}
    if (!Array.isArray(geometry.coordinates)) continue
    for (const pair of geometry.coordinates) {
      if (!Array.isArray(pair) || pair.length < 2) continue
      const lon = numberOrNull(pair[0])
      const lat = numberOrNull(pair[1])
      if (lat === null || lon === null) continue
      events.push({ lat, lon, kind: 'taxi', text: null, at: timestamp })
    }
  }

  return { data: { timestamp, events }, upstreamAt: timestamp }
}

/* ------------------------------------------------------------- definitions */

/** A DataMall feed we can define now and light up the moment a key exists. */
function dataMall(path: string): Pick<FeedDefinition<never>, 'headers' | 'requires'> {
  return {
    headers: { AccountKey: config.ltaAccountKey, accept: 'application/json' },
    requires: {
      key: 'LTA_ACCOUNT_KEY',
      value: config.ltaAccountKey || undefined,
      hint: `request a free key at datamall.lta.gov.sg to enable ${path}`,
    },
  }
}

function stationFeed(id: string, path: string, ttlMs: number): FeedDefinition<StationFeed> {
  return {
    id,
    url: `${V2}/${path}`,
    ttlMs,
    attribution: NEA,
    license: SODL,
    parse: parseStationFeed,
  }
}

export const WAVE_ONE_FEEDS: FeedDefinition<never>[] = [
  // --- weather: the five station feeds share one parser -------------------
  stationFeed('rainfall', 'rainfall', 5 * 60_000),
  stationFeed('air-temperature', 'air-temperature', 60_000),
  stationFeed('relative-humidity', 'relative-humidity', 60_000),
  stationFeed('wind-speed', 'wind-speed', 60_000),
  stationFeed('wind-direction', 'wind-direction', 60_000),

  {
    id: 'two-hr-forecast',
    url: `${V2}/two-hr-forecast`,
    ttlMs: 5 * 60_000,
    attribution: NEA,
    license: SODL,
    parse: parseTwoHourForecast,
  },

  // --- acute hazards ------------------------------------------------------
  {
    id: 'lightning',
    url: `${V2}/weather?api=lightning`,
    ttlMs: 2 * 60_000,
    attribution: NEA,
    license: SODL,
    parse: parseEventFeed,
  },
  {
    id: 'flood-alerts',
    url: `${V2}/weather/flood-alerts`,
    ttlMs: 2 * 60_000,
    attribution: PUB,
    license: SODL,
    parse: parseEventFeed,
  },

  // --- transport (v1 — never migrated to v2) ------------------------------
  {
    id: 'traffic-images',
    url: `${V1}/traffic-images`,
    ttlMs: 60_000,
    attribution: LTA_GOV,
    license: SODL,
    parse: parseTrafficImages,
    assess: assessCameraRoster,
  },
  {
    id: 'taxi-availability',
    url: `${V1}/taxi-availability`,
    ttlMs: 60_000,
    attribution: LTA_GOV,
    license: SODL,
    parse: parseTaxis,
  },

  // --- LTA DataMall: defined now, live the moment a key is set ------------
  {
    id: 'traffic-incidents',
    url: 'https://datamall2.mytransport.sg/ltaodataservice/TrafficIncidents',
    ttlMs: 2 * 60_000,
    attribution: LTA_DM,
    license: SODL,
    ...dataMall('TrafficIncidents'),
    parse: (raw: unknown) => {
      const body = asRecord(raw)
      const rows = Array.isArray(body.value) ? body.value : []
      const events: PointEvent[] = []
      for (const entry of rows) {
        const r = asRecord(entry)
        const position = coords({ latitude: r.Latitude, longitude: r.Longitude })
        if (!position) continue
        events.push({
          lat: position.lat,
          lon: position.lon,
          kind: typeof r.Type === 'string' ? r.Type : null,
          text: typeof r.Message === 'string' ? r.Message : null,
          at: null,
        })
      }
      return { data: { timestamp: null, events }, upstreamAt: null }
    },
  },
] as unknown as FeedDefinition<never>[]

/** Feed ids that need no credentials — the keyless-first demo surface. */
export const KEYLESS_FEED_IDS = WAVE_ONE_FEEDS.filter((feed) => !feed.requires).map((feed) => feed.id)

/** Only for tests and diagnostics; the HDB carpark join lives in a later wave. */
export const SG_ATTRIBUTIONS = { SODL, NEA, PUB, LTA_GOV, LTA_DM, HDB }
