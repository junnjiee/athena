import { config } from '../config'
import type { AreaKind, BBox, OsmArea, OsmBuilding, OsmFeatures, OsmRoad, RoadClass } from '../types'

interface OverpassGeomPoint {
  lat: number
  lon: number
}

export interface OverpassElement {
  type: 'way' | 'relation' | 'node'
  id: number
  tags?: Record<string, string>
  lat?: number
  lon?: number
  center?: OverpassGeomPoint
  geometry?: OverpassGeomPoint[]
  members?: { type: string; role: string; geometry?: OverpassGeomPoint[] }[]
}

function buildQuery(bbox: BBox): string {
  const b = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`
  return `[out:json][timeout:${Math.floor(config.overpassTimeoutMs / 1000)}];
(
  way["highway"](${b});
  way["building"](${b});
  way["landuse"](${b});
  way["natural"](${b});
  way["waterway"](${b});
  way["leisure"~"^(park|pitch|golf_course|garden)$"](${b});
  relation["natural"="water"](${b});
  relation["landuse"](${b});
  relation["building"](${b});
);
out tags geom;`
}

/** Public Overpass mirrors are rate-limited and occasionally reject/timeout
 *  under ordinary load -- a single pass through the mirror list treats a
 *  transient hiccup the same as a sustained outage, silently degrading
 *  classification (see pipeline.ts's catch) far more often than necessary. */
const OVERPASS_PASSES = 2
const OVERPASS_RETRY_DELAY_MS = 1500

/** Runs a query against the mirror list, throwing only once every mirror has
 *  failed twice. Callers decide what a failure means: the terrain pipeline
 *  degrades to "limited data", the operational road fetch refuses to continue. */
export async function runOverpassQuery(
  query: string,
  timeoutMs: number = config.overpassTimeoutMs,
): Promise<OverpassElement[]> {
  let lastError: unknown = null
  for (let pass = 0; pass < OVERPASS_PASSES; pass++) {
    if (pass > 0) await new Promise((resolve) => setTimeout(resolve, OVERPASS_RETRY_DELAY_MS))
    for (const endpoint of config.overpassEndpoints) {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': config.userAgent,
          },
          body: `data=${encodeURIComponent(query)}`,
          signal: AbortSignal.timeout(timeoutMs),
        })
        if (!res.ok) throw new Error(`Overpass HTTP ${res.status} at ${endpoint}`)
        const body = (await res.json()) as { elements?: OverpassElement[] }
        return body.elements ?? []
      } catch (error: unknown) {
        lastError = error
        console.warn(`[osm] endpoint failed (pass ${pass + 1}/${OVERPASS_PASSES}):`, endpoint)
      }
    }
  }
  throw new Error(
    `All Overpass endpoints failed after ${OVERPASS_PASSES} passes: ${lastError instanceof Error ? lastError.message : lastError}`,
  )
}

async function fetchOverpass(bbox: BBox): Promise<OverpassElement[]> {
  return runOverpassQuery(buildQuery(bbox))
}

function toRing(geometry: OverpassGeomPoint[]): [number, number][] {
  const ring = geometry.map((p): [number, number] => [p.lon, p.lat])
  // Overpass repeats the first point on closed ways; our contract stores it once.
  const first = ring[0]
  const last = ring[ring.length - 1]
  if (ring.length > 1 && first[0] === last[0] && first[1] === last[1]) ring.pop()
  return ring
}

function roadClassOf(highway: string): RoadClass | null {
  if (/^(motorway|trunk|primary|secondary)(_link)?$/.test(highway)) return 'major'
  if (/^(tertiary|residential|unclassified|service|living_street)(_link)?$/.test(highway))
    return 'minor'
  if (highway === 'track') return 'track'
  if (/^(path|footway|cycleway|bridleway|steps|pedestrian)$/.test(highway)) return 'path'
  return null
}

function areaKindOf(tags: Record<string, string>): AreaKind | null {
  const natural = tags.natural
  if (natural === 'wood') return 'forest'
  if (natural === 'scrub' || natural === 'heath') return 'scrub'
  if (natural === 'water' || natural === 'bay') return 'water'
  if (natural === 'wetland' || natural === 'mud') return 'wetland'
  if (natural === 'grassland') return 'grass'
  if (/^(sand|beach|bare_rock|scree|shingle)$/.test(natural ?? '')) return 'barren'

  const landuse = tags.landuse
  if (landuse === 'forest') return 'forest'
  if (/^(meadow|grass|village_green|recreation_ground|cemetery|farmland|orchard|vineyard)$/.test(landuse ?? ''))
    return 'grass'
  if (/^(residential|industrial|commercial|retail|construction|garages|education|institutional)$/.test(landuse ?? ''))
    return 'urban'
  if (/^(reservoir|basin|salt_pond)$/.test(landuse ?? '')) return 'water'
  if (landuse === 'quarry' || landuse === 'landfill') return 'barren'

  if (/^(park|pitch|golf_course|garden)$/.test(tags.leisure ?? '')) return 'grass'
  if (tags.waterway === 'riverbank') return 'water'
  return null
}

function buildingHeightMeters(tags: Record<string, string>): number {
  const explicit = Number.parseFloat(tags.height ?? tags['building:height'] ?? '')
  if (Number.isFinite(explicit) && explicit > 0) return Math.min(explicit, 300)
  const levels = Number.parseFloat(tags['building:levels'] ?? '')
  if (Number.isFinite(levels) && levels > 0) return Math.min(levels * 3.2 + 1.5, 300)
  return 8
}

function collectPolygonalRings(el: OverpassElement): [number, number][][] {
  if (el.type === 'way' && el.geometry && el.geometry.length >= 4) {
    return [toRing(el.geometry)]
  }
  if (el.type === 'relation' && el.members) {
    // Approximation: each outer member ring becomes its own polygon (holes ignored).
    return el.members
      .filter((m) => m.type === 'way' && m.role !== 'inner' && (m.geometry?.length ?? 0) >= 4)
      .map((m) => toRing(m.geometry as OverpassGeomPoint[]))
  }
  return []
}

/** Fetch and normalize OSM features for a bbox into the shapes the classifier consumes. */
export async function fetchOsmFeatures(bbox: BBox): Promise<OsmFeatures> {
  const elements = await fetchOverpass(bbox)

  const roads: OsmRoad[] = []
  const buildings: OsmBuilding[] = []
  const areas: OsmArea[] = []
  const waterLines: OsmFeatures['waterLines'] = []

  for (const el of elements) {
    const tags = el.tags ?? {}

    if (tags.highway && el.type === 'way' && el.geometry && el.geometry.length >= 2) {
      const roadClass = roadClassOf(tags.highway)
      if (roadClass) {
        roads.push({
          roadClass,
          name: tags.name,
          points: el.geometry.map((p): [number, number] => [p.lon, p.lat]),
        })
      }
      continue
    }

    if (tags.building) {
      for (const ring of collectPolygonalRings(el)) {
        if (ring.length >= 3) buildings.push({ footprint: ring, heightMeters: buildingHeightMeters(tags) })
      }
      continue
    }

    if (
      tags.waterway &&
      tags.waterway !== 'riverbank' &&
      el.type === 'way' &&
      el.geometry &&
      el.geometry.length >= 2
    ) {
      if (/^(river|stream|canal|drain|ditch)$/.test(tags.waterway)) {
        waterLines.push({ points: el.geometry.map((p): [number, number] => [p.lon, p.lat]) })
      }
      continue
    }

    const kind = areaKindOf(tags)
    if (kind) {
      for (const ring of collectPolygonalRings(el)) {
        if (ring.length >= 3) areas.push({ kind, ring })
      }
    }
  }

  return { roads, buildings, areas, waterLines }
}
