import { config } from '../config'
import { metersPerDegree } from '../lib/geo'
import { runOverpassQuery, type OverpassElement } from './osm'

export const PLACE_KINDS = [
  'city',
  'town',
  'village',
  'hamlet',
  'borough',
  'suburb',
  'quarter',
  'neighbourhood',
] as const

export type PlaceKind = (typeof PLACE_KINDS)[number]

export interface PlaceLookupResult {
  name: string
  kind: PlaceKind
  longitude: number
  latitude: number
  distanceMeters: number
}

const PLACE_PATTERN = PLACE_KINDS.join('|')

/** Keep the query point-shaped. AO callers choose a radius that covers their
 *  selected ground, while later consumers (IVO and document locations) can
 *  ask the same capability for a tighter or broader locality search. */
export function buildPlaceLookupQuery(
  longitude: number,
  latitude: number,
  radiusMeters: number,
): string {
  return `[out:json][timeout:${Math.floor(config.placeLookupTimeoutMs / 1000)}];
(
  nwr(around:${Math.round(radiusMeters)},${latitude},${longitude})["place"~"^(${PLACE_PATTERN})$"]["name"];
);
out tags center;`
}

function pointOf(element: OverpassElement): { longitude: number; latitude: number } | null {
  const longitude = element.type === 'node' ? element.lon : element.center?.lon
  const latitude = element.type === 'node' ? element.lat : element.center?.lat
  return Number.isFinite(longitude) && Number.isFinite(latitude)
    ? { longitude: longitude as number, latitude: latitude as number }
    : null
}

function distanceMeters(
  fromLongitude: number,
  fromLatitude: number,
  toLongitude: number,
  toLatitude: number,
): number {
  const mpd = metersPerDegree((fromLatitude + toLatitude) / 2)
  return Math.hypot(
    (toLongitude - fromLongitude) * mpd.lon,
    (toLatitude - fromLatitude) * mpd.lat,
  )
}

/** Resolves the nearest named settlement/locality. OSM's place=* hierarchy is
 *  intentionally retained in the result instead of flattened: later consumers
 *  can distinguish a city from a neighbourhood without another network call. */
export function nearestPlace(
  elements: OverpassElement[],
  longitude: number,
  latitude: number,
): PlaceLookupResult | null {
  const candidates: PlaceLookupResult[] = []
  for (const element of elements) {
    const name = element.tags?.name?.trim()
    const kind = element.tags?.place
    const point = pointOf(element)
    if (!name || !point || !PLACE_KINDS.includes(kind as PlaceKind)) continue
    candidates.push({
      name,
      kind: kind as PlaceKind,
      ...point,
      distanceMeters: Math.round(distanceMeters(longitude, latitude, point.longitude, point.latitude)),
    })
  }

  candidates.sort((a, b) => a.distanceMeters - b.distanceMeters || a.name.localeCompare(b.name))
  return candidates[0] ?? null
}

export async function lookupPlace(
  longitude: number,
  latitude: number,
  radiusMeters: number,
  runQuery: typeof runOverpassQuery = runOverpassQuery,
): Promise<PlaceLookupResult | null> {
  const elements = await runQuery(
    buildPlaceLookupQuery(longitude, latitude, radiusMeters),
    config.placeLookupTimeoutMs,
  )
  return nearestPlace(elements, longitude, latitude)
}

function overpassRegexLiteral(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizedPlaceName(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

export function buildPlaceNameQuery(
  name: string,
  bbox: { west: number; south: number; east: number; north: number },
): string {
  const wanted = overpassRegexLiteral(normalizedPlaceName(name))
  return `[out:json][timeout:${Math.floor(config.placeLookupTimeoutMs / 1000)}];
(
  nwr(${bbox.south},${bbox.west},${bbox.north},${bbox.east})["place"~"^(${PLACE_PATTERN})$"]["name"~"^${wanted}$",i];
);
out tags center;`
}

export async function resolvePlaceName(
  name: string,
  bbox: { west: number; south: number; east: number; north: number },
  runQuery: typeof runOverpassQuery = runOverpassQuery,
): Promise<PlaceLookupResult | null> {
  const elements = await runQuery(buildPlaceNameQuery(name, bbox), config.placeLookupTimeoutMs)
  const centerLongitude = (bbox.west + bbox.east) / 2
  const centerLatitude = (bbox.south + bbox.north) / 2
  const wanted = normalizedPlaceName(name)
  const exact = elements.filter((element) => {
    const point = pointOf(element)
    return normalizedPlaceName(element.tags?.name ?? '').localeCompare(
      wanted, undefined, { sensitivity: 'accent' },
    ) === 0 && point != null &&
      point.longitude >= bbox.west && point.longitude <= bbox.east &&
      point.latitude >= bbox.south && point.latitude <= bbox.north
  })
  return nearestPlace(exact, centerLongitude, centerLatitude)
}
