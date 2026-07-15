import * as Cesium from 'cesium'
import type { BBoxDeg } from '../types/terrain'

export type PhotoSource = 'google' | 'ion'

/** Cesium ion's proxy asset for Google Photorealistic 3D Tiles. */
const GOOGLE_P3DT_ION_ASSET = 2275207

/** Enter coarse for a fast first paint, sharpen once the initial view is in. */
export const COARSE_SSE = 32
export const SHARP_SSE = 12
/** Skirt around the AO so the diorama doesn't cut buildings mid-face. */
export const AO_CLIP_MARGIN_M = 300

/** Which photoreal source the env provides: a direct Google Maps key beats the
 *  ion proxy (fewer hops); no key at all disables the Photo toggle. */
export function photoSource(): PhotoSource | null {
  if (import.meta.env.VITE_GOOGLE_MAPS_KEY) return 'google'
  if (import.meta.env.VITE_CESIUM_ION_TOKEN) return 'ion'
  return null
}

/** Streaming profile for the wide-area photoreal tileset. Pure so it's testable:
 *  warm-while-hidden is the core latency trick -- the tileset is created hidden
 *  the moment the battleground is ready and streams AO tiles in the background,
 *  so flipping to Photo mode does no network on the critical path. Session-memory
 *  cache only (Google ToS forbids persistent tile caching). */
export function photoTilesetOptions(): Cesium.Cesium3DTileset.ConstructorOptions {
  return {
    show: false,
    preloadWhenHidden: true,
    maximumScreenSpaceError: COARSE_SSE,
    dynamicScreenSpaceError: true,
    cacheBytes: 1024 * 1024 * 1024,
    maximumCacheOverflowBytes: 512 * 1024 * 1024,
  }
}

/** Grow a lon/lat bbox by a metric margin (flat-earth conversion -- fine at AO
 *  scale). Exported for tests. */
export function expandBBox(bbox: BBoxDeg, marginM: number): BBoxDeg {
  const centerLatRad = ((bbox.south + bbox.north) / 2) * (Math.PI / 180)
  const dLat = marginM / 111_320
  const dLon = marginM / (111_320 * Math.cos(centerLatRad))
  return {
    west: bbox.west - dLon,
    east: bbox.east + dLon,
    south: bbox.south - dLat,
    north: bbox.north + dLat,
  }
}

/** Inverse clipping to the AO (+skirt): tiles outside never refine, which cuts
 *  streamed bytes by an order of magnitude vs a free camera and produces the
 *  "battle diorama" look. Same pattern as lib/clipping.ts uses for the globe. */
export function aoClippingPolygons(bbox: BBoxDeg, marginM: number = AO_CLIP_MARGIN_M): Cesium.ClippingPolygonCollection {
  const b = expandBBox(bbox, marginM)
  const positions = [
    Cesium.Cartesian3.fromDegrees(b.west, b.south),
    Cesium.Cartesian3.fromDegrees(b.east, b.south),
    Cesium.Cartesian3.fromDegrees(b.east, b.north),
    Cesium.Cartesian3.fromDegrees(b.west, b.north),
  ]
  return new Cesium.ClippingPolygonCollection({
    polygons: [new Cesium.ClippingPolygon({ positions })],
    inverse: true,
  })
}

/** Create the wide-area photoreal tileset for an AO, hidden and preloading.
 *  Returns null when no source is configured. Attribution renders through
 *  Cesium's credit container -- required by Google ToS, never hide it. */
export async function createPhotoTileset(bbox: BBoxDeg): Promise<Cesium.Cesium3DTileset | null> {
  const source = photoSource()
  if (!source) return null
  const options = photoTilesetOptions()
  const tileset =
    source === 'google'
      ? await Cesium.createGooglePhotorealistic3DTileset(
          { key: import.meta.env.VITE_GOOGLE_MAPS_KEY as string },
          options,
        )
      : await Cesium.Cesium3DTileset.fromIonAssetId(GOOGLE_P3DT_ION_ASSET, options)
  tileset.clippingPolygons = aoClippingPolygons(bbox)
  // Staged sharpening: coarse paint first, crisp once the initial view settles.
  tileset.initialTilesLoaded.addEventListener(() => {
    tileset.maximumScreenSpaceError = SHARP_SSE
  })
  return tileset
}
