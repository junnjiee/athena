import { PNG } from 'pngjs'
import { config } from '../config'
import { TERRAIN_CLASS, type BBox, type TerrainClassId } from '../types'

const C = TERRAIN_CLASS

/** Sentinel meaning "no confident WorldCover class for this cell" (fetch failed, or
 *  pixel didn't match any legend entry within tolerance). Always outside the real
 *  TerrainClassId range (0-9) so it can never collide with one. */
export const LANDCOVER_NONE = 255

interface LegendEntry {
  rgb: [number, number, number]
  cls: TerrainClassId
}

/** ESA WorldCover v200 map-layer legend (fixed, documented RGB triples), collapsed to
 *  this project's 10 TERRAIN_CLASS values. Deliberately never produces BUILDING or
 *  ROAD -- those stay OSM-only, structurally unreachable from a land-cover raster.
 *  This is a fallback candidate only (see classify.ts): OSM polygons/buildings/roads
 *  always win when present. */
const LEGEND: LegendEntry[] = [
  { rgb: [0, 100, 0], cls: C.FOREST }, // Tree cover
  { rgb: [255, 187, 34], cls: C.SCRUB }, // Shrubland
  { rgb: [255, 255, 76], cls: C.GRASS }, // Grassland
  { rgb: [240, 150, 255], cls: C.GRASS }, // Cropland
  { rgb: [250, 0, 0], cls: C.URBAN }, // Built-up
  { rgb: [180, 180, 180], cls: C.BARREN }, // Bare/sparse vegetation
  { rgb: [240, 240, 240], cls: C.BARREN }, // Snow/ice -- rare edge case, nearest analog
  { rgb: [0, 100, 200], cls: C.WATER }, // Permanent water bodies
  { rgb: [0, 150, 160], cls: C.WETLAND }, // Herbaceous wetland
  { rgb: [0, 207, 117], cls: C.WETLAND }, // Mangroves -- waterlogged substrate dominates tactically
  { rgb: [250, 230, 160], cls: C.BARREN }, // Moss/lichen -- sparse ground cover
]

const RGB_TOLERANCE = 12

/** Match a decoded pixel to the nearest legend entry within tolerance, or null. */
export function matchLegendColor(r: number, g: number, b: number): TerrainClassId | null {
  let best: { cls: TerrainClassId; distSq: number } | null = null
  for (const entry of LEGEND) {
    const dr = r - entry.rgb[0]
    const dg = g - entry.rgb[1]
    const db = b - entry.rgb[2]
    if (Math.abs(dr) > RGB_TOLERANCE || Math.abs(dg) > RGB_TOLERANCE || Math.abs(db) > RGB_TOLERANCE) continue
    const distSq = dr * dr + dg * dg + db * db
    if (!best || distSq < best.distSq) best = { cls: entry.cls, distSq }
  }
  return best?.cls ?? null
}

/** Pure raster -> grid reduction, unit-testable without network: majority-votes each
 *  supersample x supersample pixel block down to one TERRAIN_CLASS id per cell (or
 *  LANDCOVER_NONE if no pixel in the block matched the legend). Row-major,
 *  north-to-south, matching the convention used by dem.ts/classify.ts. */
export function rasterToLandCoverGrid(
  png: { width: number; height: number; data: Uint8Array | Buffer },
  width: number,
  height: number,
  supersample: number,
): Uint8Array {
  const grid = new Uint8Array(width * height).fill(LANDCOVER_NONE)
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const counts = new Map<TerrainClassId, number>()
      for (let sy = 0; sy < supersample; sy++) {
        for (let sx = 0; sx < supersample; sx++) {
          const px = col * supersample + sx
          const py = row * supersample + sy
          const o = (py * png.width + px) * 4
          const cls = matchLegendColor(png.data[o], png.data[o + 1], png.data[o + 2])
          if (cls !== null) counts.set(cls, (counts.get(cls) ?? 0) + 1)
        }
      }
      let bestCls: TerrainClassId | null = null
      let bestCount = 0
      for (const [cls, count] of counts) {
        if (count > bestCount) {
          bestCount = count
          bestCls = cls
        }
      }
      if (bestCls !== null) grid[row * width + col] = bestCls
    }
  }
  return grid
}

/** Fetch + decode the WorldCover GetMap PNG for this bbox at grid resolution and
 *  reduce it to a per-cell fallback grid. Never throws -- WorldCover is enrichment
 *  only; any failure (network, non-200, decode, size mismatch) degrades to null, and
 *  classify.ts falls back to today's OPEN-default behavior unchanged. */
export async function fetchLandCoverGrid(bbox: BBox, width: number, height: number): Promise<Uint8Array | null> {
  try {
    const s = config.worldCoverSupersample
    const imgWidth = width * s
    const imgHeight = height * s
    const params = new URLSearchParams({
      service: 'WMS',
      version: '1.3.0',
      request: 'GetMap',
      layers: config.worldCoverLayer,
      styles: '',
      format: 'image/png',
      time: '2021-01-01',
      crs: 'EPSG:4326',
      // Confirmed via direct curl testing: WMS 1.3.0 + EPSG:4326 uses lat,lon axis
      // order (south,west,north,east) -- the swapped order produces a broken response.
      bbox: `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`,
      width: String(imgWidth),
      height: String(imgHeight),
    })
    const res = await fetch(`${config.worldCoverWmsUrl}?${params}`, {
      signal: AbortSignal.timeout(config.worldCoverTimeoutMs),
    })
    if (!res.ok) throw new Error(`WorldCover WMS HTTP ${res.status}`)

    const png = PNG.sync.read(Buffer.from(await res.arrayBuffer()))
    if (png.width !== imgWidth || png.height !== imgHeight) {
      throw new Error(`unexpected WorldCover image size ${png.width}x${png.height}`)
    }
    return rasterToLandCoverGrid(png, width, height, s)
  } catch (error: unknown) {
    console.warn(
      '[landcover] WorldCover fetch failed, degrading to OSM-only classification:',
      error instanceof Error ? error.message : error,
    )
    return null
  }
}
