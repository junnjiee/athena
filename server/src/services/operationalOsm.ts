import { config } from '../config'
import { bboxExtentMeters } from '../lib/geo'
import { runOverpassQuery } from './osm'
import type { BBox, OverpassWay } from '../types'

/**
 * The operational road fetch: the wide, roads-only Overpass query that feeds
 * reinforcement routing.
 *
 * Separate from `osm.ts`'s tactical query for two reasons. It asks for node
 * refs, without which junctions can only be inferred by matching floating-point
 * coordinates. And it covers ground measured in tens of kilometres rather than
 * hundreds of metres, which is only affordable because routing is mounted-only
 * and can ignore every way a vehicle cannot drive.
 */

/** Drivable OSM highway values. Link roads are matched too, since a slip road
 *  carries the same traffic as its parent. */
const MOUNTED_HIGHWAY_VALUES = [
  'motorway',
  'trunk',
  'primary',
  'secondary',
  'tertiary',
  'residential',
  'unclassified',
  'service',
  'living_street',
  'track',
]

export function buildMountedRoadQuery(bbox: BBox): string {
  const box = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`
  const classes = MOUNTED_HIGHWAY_VALUES.join('|')
  const timeout = Math.floor(config.overpassOperationalTimeoutMs / 1000)
  // `out body geom` returns node refs *and* coordinates. `out geom` alone omits
  // the ids, which is what the tactical query uses and why it cannot be reused.
  return `[out:json][timeout:${timeout}];
way["highway"~"^(${classes})(_link)?$"](${box});
out body geom;`
}

/** Narrows raw Overpass elements to ways that can carry topology.
 *
 *  A way is dropped when it is missing node refs, when its geometry does not
 *  align one-to-one with them, or when it is too short to form an edge. The
 *  alignment check matters because the two arrays are the only link between a
 *  node id and a position; if they disagree, neither can be trusted. */
export function parseOverpassWays(elements: unknown[]): OverpassWay[] {
  const ways: OverpassWay[] = []

  for (const element of elements) {
    const el = element as {
      type?: string
      id?: number
      nodes?: number[]
      geometry?: { lat: number; lon: number }[]
      tags?: Record<string, string>
    }
    if (el.type !== 'way' || typeof el.id !== 'number') continue
    if (!Array.isArray(el.nodes) || !Array.isArray(el.geometry)) continue
    if (el.nodes.length < 2) continue
    if (el.nodes.length !== el.geometry.length) continue

    ways.push({
      id: el.id,
      nodes: el.nodes,
      geometry: el.geometry.map((p) => ({ lon: p.lon, lat: p.lat })),
      tags: el.tags,
    })
  }

  return ways
}

/** Fetches the drivable road network over an operational area.
 *
 *  Unlike `fetchOsmFeatures`, a failure here is fatal rather than degrading. A
 *  missing building is cosmetic; a missing road is a corridor absent from the
 *  analysis but present on the ground, inside a product whose claim is that it
 *  enumerated the approaches. Callers must not catch this into a partial graph. */
export async function fetchOperationalRoads(bbox: BBox): Promise<OverpassWay[]> {
  const { widthM, heightM } = bboxExtentMeters(bbox)
  const longestSide = Math.max(widthM, heightM)
  if (longestSide > config.operationalMaxExtentMeters) {
    throw new Error(
      `operational area is too large: ${Math.round(longestSide)} m a side, ` +
        `limit ${config.operationalMaxExtentMeters} m`,
    )
  }

  const elements = await runOverpassQuery(
    buildMountedRoadQuery(bbox),
    config.overpassOperationalTimeoutMs,
  )
  return parseOverpassWays(elements)
}
