import RBush from 'rbush'
import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import { point, polygon } from '@turf/helpers'
import { config } from '../config'
import { metersPerDegree, pointToSegmentDistSqMeters, ringBBox } from '../lib/geo'
import { LANDCOVER_NONE } from './landcover'
import {
  TERRAIN_CLASS,
  type BBox,
  type GridChannels,
  type OsmFeatures,
  type RoadClass,
  type SegmentationResult,
} from '../types'

const C = TERRAIN_CLASS

/** Priority when area polygons overlap (higher wins). */
const AREA_PRIORITY: Record<string, number> = {
  water: 60,
  wetland: 50,
  forest: 40,
  scrub: 30,
  urban: 20,
  barren: 15,
  grass: 10,
}

const AREA_CLASS: Record<string, number> = {
  water: C.WATER,
  wetland: C.WETLAND,
  forest: C.FOREST,
  scrub: C.SCRUB,
  urban: C.URBAN,
  barren: C.BARREN,
  grass: C.GRASS,
}

const ROAD_HALF_WIDTH_M: Record<RoadClass, number> = {
  major: 7,
  minor: 4,
  track: 2.5,
  path: 1.5,
}

/** Base military property table per terrain class:
 *  [cover, concealment, moveCost×20, vehicleMobility] */
const BASE_PROPS: Record<number, [number, number, number, number]> = {
  [C.OPEN]: [10, 10, 22, 75],
  [C.GRASS]: [12, 25, 22, 70],
  [C.SCRUB]: [35, 55, 32, 35],
  [C.FOREST]: [55, 85, 42, 10],
  [C.WETLAND]: [15, 45, 70, 5],
  [C.WATER]: [0, 5, 160, 0],
  [C.URBAN]: [55, 50, 24, 60],
  [C.BUILDING]: [95, 80, 90, 0],
  [C.ROAD]: [5, 5, 15, 95],
  [C.BARREN]: [20, 10, 26, 45],
}

interface IndexedPolygon {
  minX: number
  minY: number
  maxX: number
  maxY: number
  ring: [number, number][]
  priority: number
  cls: number
  isBuilding: boolean
}

interface IndexedSegment {
  minX: number
  minY: number
  maxX: number
  maxY: number
  a: [number, number]
  b: [number, number]
  halfWidthM: number
  isWater: boolean
}

function indexPolygons(features: OsmFeatures): RBush<IndexedPolygon> {
  const tree = new RBush<IndexedPolygon>()
  const items: IndexedPolygon[] = []
  for (const b of features.buildings) {
    const bb = ringBBox(b.footprint)
    items.push({
      minX: bb.west, minY: bb.south, maxX: bb.east, maxY: bb.north,
      ring: b.footprint, priority: 100, cls: C.BUILDING, isBuilding: true,
    })
  }
  for (const a of features.areas) {
    const bb = ringBBox(a.ring)
    items.push({
      minX: bb.west, minY: bb.south, maxX: bb.east, maxY: bb.north,
      ring: a.ring, priority: AREA_PRIORITY[a.kind] ?? 0, cls: AREA_CLASS[a.kind] ?? C.OPEN, isBuilding: false,
    })
  }
  tree.load(items)
  return tree
}

function indexSegments(features: OsmFeatures, padDeg: number): RBush<IndexedSegment> {
  const tree = new RBush<IndexedSegment>()
  const items: IndexedSegment[] = []
  const push = (a: [number, number], b: [number, number], halfWidthM: number, isWater: boolean) => {
    items.push({
      minX: Math.min(a[0], b[0]) - padDeg,
      minY: Math.min(a[1], b[1]) - padDeg,
      maxX: Math.max(a[0], b[0]) + padDeg,
      maxY: Math.max(a[1], b[1]) + padDeg,
      a, b, halfWidthM, isWater,
    })
  }
  for (const r of features.roads) {
    for (let i = 0; i < r.points.length - 1; i++) {
      push(r.points[i], r.points[i + 1], ROAD_HALF_WIDTH_M[r.roadClass], false)
    }
  }
  for (const w of features.waterLines) {
    for (let i = 0; i < w.points.length - 1; i++) {
      push(w.points[i], w.points[i + 1], 4, true)
    }
  }
  tree.load(items)
  return tree
}

function classifyCell(
  lon: number,
  lat: number,
  cellMeters: number,
  polygons: RBush<IndexedPolygon>,
  segments: RBush<IndexedSegment>,
  segFallback: number | null,
  landCoverFallback: number | null,
): number {
  const pt = point([lon, lat])

  const polyHits = polygons
    .search({ minX: lon, minY: lat, maxX: lon, maxY: lat })
    .sort((a, b) => b.priority - a.priority)
  let areaCls: number | null = null
  for (const hit of polyHits) {
    const ring = [...hit.ring, hit.ring[0]]
    if (booleanPointInPolygon(pt, polygon([ring]))) {
      if (hit.isBuilding || hit.cls === C.WATER) return hit.cls
      areaCls ??= hit.cls
    }
  }

  // Roads/streams override vegetation when the cell center is within the way's width.
  const tolerance = cellMeters * 0.45
  for (const seg of segments.search({ minX: lon, minY: lat, maxX: lon, maxY: lat })) {
    const reach = seg.halfWidthM + tolerance
    if (pointToSegmentDistSqMeters([lon, lat], seg.a, seg.b) <= reach * reach) {
      return seg.isWater ? C.WATER : C.ROAD
    }
  }

  // Satellite intelligence only fills in where OSM had no opinion at all -- it never
  // overrides an OSM area polygon, building, road, or water hit above. Live-imagery
  // segmentation (fresher, higher-res) outranks the 2021 WorldCover prior, but only
  // when it cleared the confidence gate applied in buildGridChannels.
  //
  // Exception: 'urban' area hits come from landuse zoning tags (residential/
  // industrial/commercial/...), not direct ground-truth vegetation observations --
  // unlike forest/water/wetland/scrub/grass tags, a zoned "urban" polygon says
  // nothing about whether there's real tree cover inside it (private gardens,
  // street trees, an undeveloped wooded buffer). Let a confident raster read
  // correct it; only fall back to the zoning tag if neither raster source has
  // an opinion either.
  if (areaCls !== null && areaCls !== C.URBAN) return areaCls
  return segFallback ?? landCoverFallback ?? areaCls ?? C.OPEN
}

function computeSlopeDeg(height: Float32Array, w: number, h: number, cellMeters: number): Uint8Array {
  const slope = new Uint8Array(w * h)
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const x0 = height[row * w + Math.max(0, col - 1)]
      const x1 = height[row * w + Math.min(w - 1, col + 1)]
      const y0 = height[Math.max(0, row - 1) * w + col]
      const y1 = height[Math.min(h - 1, row + 1) * w + col]
      const dzdx = (x1 - x0) / (2 * cellMeters)
      const dzdy = (y1 - y0) / (2 * cellMeters)
      const deg = Math.atan(Math.hypot(dzdx, dzdy)) * (180 / Math.PI)
      slope[row * w + col] = Math.min(90, Math.round(deg))
    }
  }
  return slope
}

/** Mean height of the (2r+1)² neighborhood, used for prominence (how much a cell
 *  sticks out above its surroundings → easier to see, better fire position). */
function localMeanHeight(height: Float32Array, w: number, h: number, row: number, col: number, r: number): number {
  let sum = 0
  let n = 0
  for (let dr = -r; dr <= r; dr++) {
    const rr = row + dr
    if (rr < 0 || rr >= h) continue
    for (let dc = -r; dc <= r; dc++) {
      const cc = col + dc
      if (cc < 0 || cc >= w) continue
      sum += height[rr * w + cc]
      n++
    }
  }
  return sum / n
}

function isOpenClass(cls: number): boolean {
  return cls === C.OPEN || cls === C.GRASS || cls === C.ROAD || cls === C.BARREN
}

/** Second pass: ambush potential = concealed cells adjacent to open/road movement lanes. */
function computeAmbush(cls: Uint8Array, concealment: Uint8Array, w: number, h: number): Uint8Array {
  const ambush = new Uint8Array(w * h)
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const i = row * w + col
      if (concealment[i] < 45) continue
      let edge = false
      for (let dr = -2; dr <= 2 && !edge; dr++) {
        for (let dc = -2; dc <= 2 && !edge; dc++) {
          const rr = row + dr
          const cc = col + dc
          if (rr < 0 || rr >= h || cc < 0 || cc >= w) continue
          if (isOpenClass(cls[rr * w + cc])) edge = true
        }
      }
      ambush[i] = edge ? Math.min(100, Math.round(concealment[i] * 0.6 + 35)) : Math.round(concealment[i] * 0.3)
    }
  }
  return ambush
}

/** Build all per-cell military property channels from elevation + OSM features. */
export function buildGridChannels(
  bbox: BBox,
  width: number,
  height: number,
  cellMeters: number,
  heights: Float32Array,
  features: OsmFeatures,
  landCover: Uint8Array | null = null,
  seg: SegmentationResult | null = null,
): GridChannels {
  const n = width * height
  const cls = new Uint8Array(n)
  const cover = new Uint8Array(n)
  const concealment = new Uint8Array(n)
  const moveCost = new Uint8Array(n)
  const visibility = new Uint8Array(n)
  const vehicleMobility = new Uint8Array(n)

  const midLat = (bbox.south + bbox.north) / 2
  const padDeg = (Math.max(...Object.values(ROAD_HALF_WIDTH_M)) + cellMeters) / metersPerDegree(midLat).lon
  const polygons = indexPolygons(features)
  const segments = indexSegments(features, padDeg)

  const slope = computeSlopeDeg(heights, width, height, cellMeters)
  const dLon = (bbox.east - bbox.west) / width
  const dLat = (bbox.north - bbox.south) / height

  for (let row = 0; row < height; row++) {
    const lat = bbox.north - (row + 0.5) * dLat
    for (let col = 0; col < width; col++) {
      const i = row * width + col
      const lon = bbox.west + (col + 0.5) * dLon
      const lc = landCover ? landCover[i] : LANDCOVER_NONE
      // Confidence gate: a weak segmentation call must never displace WorldCover.
      const sc =
        seg && seg.cls[i] !== LANDCOVER_NONE && seg.confidence[i] >= config.segConfidenceMin
          ? seg.cls[i]
          : null
      const c = classifyCell(lon, lat, cellMeters, polygons, segments, sc, lc === LANDCOVER_NONE ? null : lc)
      cls[i] = c

      const [baseCover, baseConceal, baseMove, baseVehicle] = BASE_PROPS[c] ?? BASE_PROPS[C.OPEN]
      const s = slope[i]

      // Slope shapes everything: steeper = slower, impassable for vehicles, but
      // grants defilade (cover) and, with prominence, better observation.
      const slopeMoveFactor = 1 + (s / 30) ** 2
      moveCost[i] = Math.min(250, Math.round(baseMove * slopeMoveFactor))
      vehicleMobility[i] = s > 25 ? 0 : Math.round(baseVehicle * (1 - s / 30))
      cover[i] = Math.min(100, Math.round(baseCover + Math.min(15, s * 0.5)))
      concealment[i] = baseConceal

      const prominence = heights[i] - localMeanHeight(heights, width, height, row, col, 2)
      const exposure = 100 - baseConceal + Math.max(0, Math.min(20, prominence * 2))
      visibility[i] = Math.max(0, Math.min(100, Math.round(exposure)))
    }
  }

  const ambush = computeAmbush(cls, concealment, width, height)
  return { height: heights, cls, slope, cover, concealment, moveCost, visibility, vehicleMobility, ambush }
}
