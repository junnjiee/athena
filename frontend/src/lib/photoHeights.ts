import * as Cesium from 'cesium'
import type { LonLat } from '../types/entities'

/** Insert intermediate points so no segment exceeds maxSpacingM. Flat-earth
 *  interpolation -- fine at AO scale. Fallback path for Photo mode: if ground
 *  classification misbehaves on the photoreal mesh, routes re-render as plain
 *  polylines through these densified points at sampled mesh heights. */
export function densifyRoute(points: readonly LonLat[], maxSpacingM = 10): LonLat[] {
  if (points.length < 2) return [...points]
  const out: LonLat[] = [points[0]]
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const meanLatRad = ((a.latitude + b.latitude) / 2) * (Math.PI / 180)
    const dxM = (b.longitude - a.longitude) * 111_320 * Math.cos(meanLatRad)
    const dyM = (b.latitude - a.latitude) * 111_320
    const lengthM = Math.hypot(dxM, dyM)
    const segments = Math.max(1, Math.ceil(lengthM / maxSpacingM))
    for (let s = 1; s <= segments; s++) {
      const t = s / segments
      out.push({
        longitude: a.longitude + (b.longitude - a.longitude) * t,
        latitude: a.latitude + (b.latitude - a.latitude) * t,
      })
    }
  }
  return out
}

/** Exported for tests. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export interface MeshProbe {
  point: LonLat
  /** height of the same point in our DEM grid */
  demHeightM: number
}

/** Median vertical disagreement (mesh - DEM) across probe points. Diagnostics
 *  for the latency/accuracy HUD: sim math stays on the DEM grid, visuals clamp
 *  to the rendered mesh, and this number is the honest gap between the two. */
export async function measureMeshOffset(scene: Cesium.Scene, probes: readonly MeshProbe[]): Promise<number | null> {
  if (probes.length === 0 || !scene.sampleHeightSupported) return null
  const cartographics = probes.map((p) => Cesium.Cartographic.fromDegrees(p.point.longitude, p.point.latitude))
  const sampled = await scene.sampleHeightMostDetailed(cartographics)
  const diffs: number[] = []
  sampled.forEach((carto, i) => {
    if (carto) diffs.push(carto.height - probes[i].demHeightM)
  })
  return median(diffs)
}
