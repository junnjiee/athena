import { describe, expect, test } from 'bun:test'
import { assessCameraRoster, WAVE_ONE_FEEDS, KEYLESS_FEED_IDS, type CameraFeed } from '../src/services/sg/sources'
import { config } from '../src/config'

/** Finds a registered feed definition by id so parsers are tested as shipped. */
function feed(id: string) {
  const found = WAVE_ONE_FEEDS.find((f) => f.id === id)
  if (!found) throw new Error(`no such feed: ${id}`)
  return found
}

describe('station feeds', () => {
  // Shape copied from a live api-open.data.gov.sg/v2 rainfall response.
  const body = {
    code: 0,
    errorMsg: '',
    data: {
      stations: [
        { id: 'S218', deviceId: 'S218', name: 'Bukit Batok Street 34', location: { longitude: 103.75065, latitude: 1.36491 } },
        { id: 'S111', deviceId: 'S111', name: 'Scotts Road', location: { longitude: 103.8125, latitude: 1.31055 } },
        { id: 'S999', deviceId: 'S999', name: 'No Location', location: null },
      ],
      readings: [
        { timestamp: '2026-08-29T19:05:00+08:00', data: [{ stationId: 'S218', value: 0 }, { stationId: 'S111', value: 2.4 }] },
      ],
      readingType: 'TB1 Rainfall 5 Minute Total F',
      readingUnit: 'mm',
    },
  }

  test('joins readings onto stations so the browser never has to', () => {
    const { data, upstreamAt } = feed('rainfall').parse(body) as {
      data: { stations: Array<{ id: string; name: string; lat: number; lon: number; value: number | null }>; unit: string; timestamp: string | null }
      upstreamAt: string | null
    }

    expect(data.unit).toBe('mm')
    expect(data.timestamp).toBe('2026-08-29T19:05:00+08:00')
    expect(upstreamAt).toBe('2026-08-29T19:05:00+08:00')

    const scotts = data.stations.find((s) => s.id === 'S111')
    expect(scotts).toEqual({ id: 'S111', name: 'Scotts Road', lat: 1.31055, lon: 103.8125, value: 2.4 })
  })

  test('drops stations with no usable position rather than emitting NaN coordinates', () => {
    const { data } = feed('rainfall').parse(body) as { data: { stations: Array<{ id: string }> } }
    expect(data.stations.map((s) => s.id)).toEqual(['S218', 'S111'])
  })

  test('a station with no reading is present with a null value, not omitted', () => {
    const partial = {
      ...body,
      data: { ...body.data, readings: [{ timestamp: 't', data: [{ stationId: 'S218', value: 1 }] }] },
    }
    const { data } = feed('rainfall').parse(partial) as {
      data: { stations: Array<{ id: string; value: number | null }> }
    }
    expect(data.stations.find((s) => s.id === 'S111')?.value).toBeNull()
  })

  test('an upstream error code fails the parse instead of yielding empty data', () => {
    expect(() => feed('rainfall').parse({ code: 7, errorMsg: 'nope', data: {} })).toThrow(/upstream code 7/)
  })
})

describe('traffic images', () => {
  const camera = (id: string) => ({
    timestamp: '2026-08-29T19:11:03+08:00',
    image: `https://images.data.gov.sg/api/traffic-images/${id}.jpg`,
    location: { longitude: 103.7716543, latitude: 1.447023728 },
    camera_id: id,
    image_metadata: { height: 1080, width: 1920, md5: 'x' },
  })
  const body = (n: number) => ({
    items: [{ timestamp: '2026-08-29T19:11:03+08:00', cameras: Array.from({ length: n }, (_, i) => camera(String(2700 + i))) }],
    api_info: { status: 'healthy' },
  })

  test('normalizes a camera into a directly renderable record', () => {
    const { data } = feed('traffic-images').parse(body(1)) as { data: CameraFeed }
    expect(data.cameras[0]).toEqual({
      id: '2700',
      lat: 1.447023728,
      lon: 103.7716543,
      imageUrl: 'https://images.data.gov.sg/api/traffic-images/2700.jpg',
      capturedAt: '2026-08-29T19:11:03+08:00',
      width: 1920,
      height: 1080,
    })
  })

  test('flags the thinned roster the live feed is currently serving', () => {
    // Verified live: 8 cameras returned while api_info.status reads "healthy".
    const { data } = feed('traffic-images').parse(body(8)) as { data: CameraFeed }
    const note = assessCameraRoster(data)
    expect(note).toContain('8 of ~90')
    expect(note).toContain('not island-wide')
  })

  test('a full roster is not flagged', () => {
    const { data } = feed('traffic-images').parse(body(config.sgCameraRoster)) as { data: CameraFeed }
    expect(assessCameraRoster(data)).toBeNull()
  })

  test('an empty roster is called out distinctly from a thin one', () => {
    const { data } = feed('traffic-images').parse(body(0)) as { data: CameraFeed }
    expect(assessCameraRoster(data)).toBe('no cameras in the feed')
  })
})

describe('event feeds', () => {
  test('an empty lightning payload is the normal quiet state, not a failure', () => {
    const quiet = {
      code: 0,
      data: { records: [{ datetime: '2026-08-29T19:12:00+08:00', item: { isStationData: false, readings: [], type: 'observation' }, updatedTimestamp: 'x' }] },
    }
    const { data } = feed('lightning').parse(quiet) as { data: { events: unknown[]; timestamp: string | null } }
    expect(data.events).toEqual([])
    expect(data.timestamp).toBe('2026-08-29T19:12:00+08:00')
    // Crucially there is no `assess` on lightning: zero strikes must never be
    // reported as a degraded feed.
    expect(feed('lightning').assess).toBeUndefined()
  })

  test('reads strike positions defensively across field spellings', () => {
    const active = {
      code: 0,
      data: {
        records: [{
          datetime: '2026-08-29T19:12:00+08:00',
          item: {
            readings: [
              { location: { latitude: 1.35, longitude: 103.8 }, type: 'C', text: 'Cloud to Cloud', datetime: '2026-08-29T19:11:50+08:00' },
              { latitude: 1.29, longitude: 103.85, type: 'G' },
              { nonsense: true },
            ],
          },
        }],
      },
    }
    const { data } = feed('lightning').parse(active) as {
      data: { events: Array<{ lat: number; lon: number; kind: string | null; at: string | null }> }
    }
    expect(data.events).toHaveLength(2)
    expect(data.events[0]).toEqual({ lat: 1.35, lon: 103.8, kind: 'C', text: 'Cloud to Cloud', at: '2026-08-29T19:11:50+08:00' } as never)
    // A reading without its own datetime inherits the record's.
    expect(data.events[1]!.at).toBe('2026-08-29T19:12:00+08:00')
  })

  test('no records at all yields an empty feed rather than throwing', () => {
    const { data } = feed('flood-alerts').parse({ code: 0, data: { records: [] } }) as {
      data: { events: unknown[] }
    }
    expect(data.events).toEqual([])
  })
})

describe('two-hour forecast', () => {
  test('joins each area forecast to its label location', () => {
    const body = {
      code: 0,
      data: {
        area_metadata: [
          { name: 'Ang Mo Kio', label_location: { longitude: 103.839, latitude: 1.375 } },
          { name: 'Kallang', label_location: { longitude: 103.862, latitude: 1.312 } },
        ],
        items: [{
          timestamp: '2026-08-29T18:30:00+08:00',
          valid_period: { start: '2026-08-29T19:00:00+08:00', end: '2026-08-29T21:00:00+08:00', text: '7.00 pm to 9.00 pm' },
          forecasts: [
            { area: 'Ang Mo Kio', forecast: 'Windy' },
            { area: 'Kallang', forecast: 'Thundery Showers' },
            { area: 'Nowhere', forecast: 'Fair' },
          ],
        }],
      },
    }
    const { data } = feed('two-hr-forecast').parse(body) as {
      data: { areas: Array<{ name: string; lat: number; lon: number; forecast: string }>; validText: string | null }
    }
    expect(data.validText).toBe('7.00 pm to 9.00 pm')
    expect(data.areas).toHaveLength(2)
    expect(data.areas.find((a) => a.name === 'Kallang')).toEqual({
      name: 'Kallang', lat: 1.312, lon: 103.862, forecast: 'Thundery Showers',
    })
  })
})

describe('registry composition', () => {
  test('feed ids are unique', () => {
    const ids = WAVE_ONE_FEEDS.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  test('every keyless feed really is keyless, and DataMall feeds are gated', () => {
    expect(KEYLESS_FEED_IDS).toContain('rainfall')
    expect(KEYLESS_FEED_IDS).toContain('traffic-images')
    expect(KEYLESS_FEED_IDS).not.toContain('traffic-incidents')
    expect(feed('traffic-incidents').requires?.key).toBe('LTA_ACCOUNT_KEY')
  })

  test('every feed carries attribution and a licence — the SODL requires it', () => {
    for (const f of WAVE_ONE_FEEDS) {
      expect(f.attribution.length).toBeGreaterThan(0)
      expect(f.license).toBe('Singapore Open Data Licence')
      expect(f.ttlMs).toBeGreaterThan(0)
    }
  })

  test('weather and transport feeds sit on their correct base URLs', () => {
    // The v1/v2 split is a live trap: transport never migrated to v2.
    expect(String(feed('rainfall').url)).toContain('api-open.data.gov.sg/v2')
    expect(String(feed('traffic-images').url)).toContain('api.data.gov.sg/v1')
    expect(String(feed('taxi-availability').url)).toContain('api.data.gov.sg/v1')
  })
})
