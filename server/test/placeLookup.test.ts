import { describe, expect, test } from 'bun:test'
import { placeLookupQuery } from '../src/routes/places'
import {
  buildPlaceLookupQuery,
  lookupPlace,
  nearestPlace,
} from '../src/services/placeLookup'

describe('place lookup', () => {
  test('builds a bounded named-place query around the requested point', () => {
    const query = buildPlaceLookupQuery(103.7, 1.42, 12_345)
    expect(query).toContain('nwr(around:12345,1.42,103.7)')
    expect(query).toContain('["place"~"^(city|town|village|hamlet|borough|suburb|quarter|neighbourhood)$"]')
    expect(query).toContain('["name"]')
    expect(query).toContain('out tags center')
  })

  test('selects the nearest valid named place from nodes and area centres', () => {
    const result = nearestPlace([
      { type: 'node', id: 1, lat: 1.5, lon: 103.8, tags: { place: 'town', name: 'Far Town' } },
      { type: 'way', id: 2, center: { lat: 1.421, lon: 103.701 }, tags: { place: 'suburb', name: 'Near Ground' } },
      { type: 'node', id: 3, lat: 1.42, lon: 103.7, tags: { place: 'island', name: 'Wrong grammar' } },
      { type: 'node', id: 4, lat: 1.42, lon: 103.7, tags: { place: 'village' } },
    ], 103.7, 1.42)

    expect(result).toMatchObject({ name: 'Near Ground', kind: 'suburb' })
    expect(result?.distanceMeters).toBeLessThan(200)
  })

  test('returns null when the map has no usable locality', () => {
    expect(nearestPlace([], 0, 0)).toBeNull()
  })

  test('passes through the query runner for deterministic consumers', async () => {
    const result = await lookupPlace(103.7, 1.42, 5000, async () => [
      { type: 'node', id: 1, lat: 1.42, lon: 103.7, tags: { place: 'village', name: 'Lim Chu Kang' } },
    ])
    expect(result?.name).toBe('Lim Chu Kang')
  })

  test('validates shared endpoint coordinates and radius', () => {
    expect(placeLookupQuery.parse({ longitude: '103.7', latitude: '1.42' })).toEqual({
      longitude: 103.7,
      latitude: 1.42,
      radiusMeters: 10_000,
    })
    expect(placeLookupQuery.safeParse({ longitude: 200, latitude: 1 }).success).toBe(false)
    expect(placeLookupQuery.safeParse({ longitude: 103, latitude: 1, radiusMeters: 100_000 }).success).toBe(false)
  })
})
