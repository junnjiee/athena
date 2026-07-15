import * as Cesium from 'cesium'

/** Where a non-georeferenced splat capture should sit in the world. */
export interface SplatPlacement {
  lon: number
  lat: number
  heightM: number
  headingDeg?: number
  scale?: number
}

/** One hero asset from the server's splat index (server/assets/splats/index.json).
 *  Either an ion asset id (ion tiles PLY captures into SPZ 3D Tiles with LOD) or
 *  a self-hosted tileset path under /api/splats/files/. */
export interface SplatConfig {
  name: string
  ionAssetId?: number
  path?: string
  placement?: SplatPlacement
}

export async function fetchSplatIndex(): Promise<SplatConfig[]> {
  try {
    const res = await fetch('/api/splats/index')
    if (!res.ok) return []
    const parsed: unknown = await res.json()
    return Array.isArray(parsed) ? (parsed as SplatConfig[]) : []
  } catch {
    // no server / no splats -- Photo mode degrades cleanly to Google tiles only
    return []
  }
}

/** Matrix that moves a tileset whose content is centered at `center` (world
 *  coords) onto the placement point, with heading rotation and uniform scale
 *  applied in the local east-north-up frame: M = ENU(target, heading) * S * T(-center).
 *  By construction M * center = target. Exported for tests. */
export function georeferenceMatrix(center: Cesium.Cartesian3, placement: SplatPlacement): Cesium.Matrix4 {
  const target = Cesium.Cartesian3.fromDegrees(placement.lon, placement.lat, placement.heightM)
  const hpr = new Cesium.HeadingPitchRoll(Cesium.Math.toRadians(placement.headingDeg ?? 0), 0, 0)
  const targetFrame = Cesium.Transforms.headingPitchRollToFixedFrame(target, hpr)
  const scaled = Cesium.Matrix4.multiplyByUniformScale(targetFrame, placement.scale ?? 1, new Cesium.Matrix4())
  const toLocal = Cesium.Matrix4.fromTranslation(
    Cesium.Cartesian3.negate(center, new Cesium.Cartesian3()),
  )
  return Cesium.Matrix4.multiply(scaled, toLocal, new Cesium.Matrix4())
}

/** Load one hero splat tileset, hidden + preloading (warmed alongside the
 *  Google tileset). These are OUR assets: the browser may cache them hard
 *  (server sends immutable cache headers), unlike Google tiles. */
export async function loadSplatTileset(config: SplatConfig): Promise<Cesium.Cesium3DTileset | null> {
  const options: Cesium.Cesium3DTileset.ConstructorOptions = {
    show: false,
    preloadWhenHidden: true,
    maximumScreenSpaceError: 16,
  }
  let tileset: Cesium.Cesium3DTileset
  if (config.ionAssetId) {
    tileset = await Cesium.Cesium3DTileset.fromIonAssetId(config.ionAssetId, options)
  } else if (config.path) {
    tileset = await Cesium.Cesium3DTileset.fromUrl(`/api/splats/files/${config.path}`, options)
  } else {
    return null
  }
  if (Cesium.GaussianSplat3DTileContent.tilesetRequiresGaussianSplattingExt(tileset)) {
    // informational -- cesium 1.143 renders these natively; older runtimes would not
    console.warn(`[Athena] splat "${config.name}" uses the gaussian-splatting 3D Tiles extension`)
  }
  if (config.placement) {
    tileset.modelMatrix = georeferenceMatrix(tileset.boundingSphere.center, config.placement)
  }
  return tileset
}
