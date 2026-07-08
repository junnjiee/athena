import * as Cesium from 'cesium'
import type { MovementType } from '../types/movement'

/** Per-gait polyline styling. All styles clamp to ground, so they render
 *  identically in 2D and 3D. Shared by the live draw preview and the committed
 *  route entities so what you draw is what you get.
 *
 *  Visual language (slow/stealthy → fast/loud):
 *    crawl  · fine dotted, thin   — barely-there track
 *    prowl  ‑ ‑ short dashes      — deliberate stalk
 *    patrol – – long dashes       — cautious pace
 *    march  ──── solid            — standard travel
 *    rush   ━━━━ bold glow        — hard, committed dash
 */

// 16-bit stipple patterns for PolylineDashMaterialProperty.
const DOT = 0xaaaa
const SHORT_DASH = 0xf0f0
const LONG_DASH = 0xff00

export interface MovementLineStyle {
  material: Cesium.MaterialProperty
  width: number
}

export function movementLineStyle(movementType: MovementType, colorHex: string): MovementLineStyle {
  const color = Cesium.Color.fromCssColorString(colorHex)
  switch (movementType) {
    case 'crawl':
      return {
        width: 2.5,
        material: new Cesium.PolylineDashMaterialProperty({ color, dashLength: 6, dashPattern: DOT }),
      }
    case 'prowl':
      return {
        width: 3,
        material: new Cesium.PolylineDashMaterialProperty({ color, dashLength: 10, dashPattern: SHORT_DASH }),
      }
    case 'patrol':
      return {
        width: 3.5,
        material: new Cesium.PolylineDashMaterialProperty({ color, dashLength: 18, dashPattern: LONG_DASH }),
      }
    case 'march':
      return { width: 4, material: new Cesium.ColorMaterialProperty(color) }
    case 'rush':
      return {
        width: 6,
        material: new Cesium.PolylineGlowMaterialProperty({ color, glowPower: 0.25, taperPower: 1 }),
      }
  }
}
