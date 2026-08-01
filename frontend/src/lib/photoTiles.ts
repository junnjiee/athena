import * as Cesium from 'cesium'
import { ENTRY_TIER, QUALITY_TIERS } from './frameGovernor'
import type { BBoxDeg } from '../types/terrain'

export type PhotoSource = 'google' | 'ion'

/** Cesium ion's proxy asset for Google Photorealistic 3D Tiles. */
const GOOGLE_P3DT_ION_ASSET = 2275207

/** Skirt around the AO so the diorama doesn't cut buildings mid-face. */
export const AO_CLIP_MARGIN_M = 300

/** Which photoreal source the env provides: a direct Google Maps key beats the
 *  ion proxy (fewer hops); no key at all disables the Photo toggle. */
export function photoSource(): PhotoSource | null {
  if (import.meta.env.VITE_GOOGLE_MAPS_KEY) return 'google'
  if (import.meta.env.VITE_CESIUM_ION_TOKEN) return 'ion'
  return null
}

/** Streaming profile for the wide-area photoreal tileset, tuned for laptop
 *  GPUs. Pure so it's testable.
 *
 *  - created hidden with NO preload: background warming is a short, explicit
 *    window managed by PhotoModeController, never a standing cost
 *  - entry SSE comes from the governor's entry tier (coarse-first paint); the
 *    frame governor owns maximumScreenSpaceError from then on
 *  - modest cache: big caches caused memory pressure on integrated GPUs, and
 *    the AO working set is small anyway. Session-memory only (Google ToS
 *    forbids persistent tile caching). */
export function photoTilesetOptions(): Cesium.Cesium3DTileset.ConstructorOptions {
  return {
    show: false,
    preloadWhenHidden: false,
    maximumScreenSpaceError: QUALITY_TIERS[ENTRY_TIER].sse,
    dynamicScreenSpaceError: true,
    cacheBytes: 256 * 1024 * 1024,
    maximumCacheOverflowBytes: 128 * 1024 * 1024,
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

/** Half-extents of a bbox in meters (east-west, north-south), plus margin.
 *  Exported for tests. */
export function bboxHalfExtentsM(bbox: BBoxDeg, marginM: number): { halfWidthM: number; halfDepthM: number } {
  const centerLatRad = ((bbox.south + bbox.north) / 2) * (Math.PI / 180)
  const widthM = (bbox.east - bbox.west) * 111_320 * Math.cos(centerLatRad)
  const depthM = (bbox.north - bbox.south) * 111_320
  return { halfWidthM: widthM / 2 + marginM, halfDepthM: depthM / 2 + marginM }
}

/** Clip the tileset to the AO (+skirt) with four inward-facing clipping PLANES
 *  (union mode: outside any wall = clipped).
 *
 *  Planes, not ClippingPolygonCollection, deliberately: planes participate in
 *  tile traversal culling -- tiles wholly outside the box are never refined,
 *  which is what actually cuts streaming and per-frame cost -- and their
 *  fragment test is four dot products vs the polygon collection's
 *  signed-distance texture lookup. Plane space is relative to the tileset's
 *  clippingPlanesOriginMatrix, so the AO's ENU frame is re-expressed there. */
export function applyAoClippingPlanes(
  tileset: Cesium.Cesium3DTileset,
  bbox: BBoxDeg,
  marginM: number = AO_CLIP_MARGIN_M,
): void {
  const { halfWidthM, halfDepthM } = bboxHalfExtentsM(bbox, marginM)
  const center = Cesium.Cartesian3.fromDegrees((bbox.west + bbox.east) / 2, (bbox.south + bbox.north) / 2)
  const enu = Cesium.Transforms.eastNorthUpToFixedFrame(center)
  // clippingPlanesOriginMatrix is a real runtime property (the frame Cesium
  // evaluates tileset clipping planes in) that 1.143's public typings omit --
  // read it through a narrow cast, falling back to identity (world frame).
  const origin =
    (tileset as unknown as { clippingPlanesOriginMatrix?: Cesium.Matrix4 }).clippingPlanesOriginMatrix ??
    Cesium.Matrix4.IDENTITY
  const originInverse = Cesium.Matrix4.inverse(origin, new Cesium.Matrix4())
  const modelMatrix = Cesium.Matrix4.multiply(originInverse, enu, new Cesium.Matrix4())

  tileset.clippingPlanes = new Cesium.ClippingPlaneCollection({
    modelMatrix,
    // clip when outside ANY wall -- keeps the interior of the box
    unionClippingRegions: true,
    planes: [
      new Cesium.ClippingPlane(new Cesium.Cartesian3(-1, 0, 0), halfWidthM),
      new Cesium.ClippingPlane(new Cesium.Cartesian3(1, 0, 0), halfWidthM),
      new Cesium.ClippingPlane(new Cesium.Cartesian3(0, -1, 0), halfDepthM),
      new Cesium.ClippingPlane(new Cesium.Cartesian3(0, 1, 0), halfDepthM),
    ],
  })
}

/** Create the wide-area photoreal tileset for an AO, hidden and idle (no
 *  background cost until the controller opens its warm window or the mode
 *  activates). Returns null when no source is configured. Attribution renders
 *  through Cesium's credit container -- required by Google ToS. */
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
  applyAoClippingPlanes(tileset, bbox)
  return tileset
}
