import type { SymbolKind } from '../types/entities'

/** Real-world (meters) footprints for the tactical position graphics -- shared
 *  by both the 3D Cesium ground-vector rendering and the 2D topo view's canvas
 *  vector drawing, so a platoon/section/trench looks the same relative size
 *  and fits together the same way in both views. Platoon = ~3x section area
 *  per the requested organizational ratio (a platoon is ~3 sections), so
 *  linear dimensions scale by sqrt(3) for the same aspect ratio. */
export const AREA_SIZE_METERS: Record<2 | 3, { width: number; depth: number }> = {
  2: { width: 60, depth: 40 },
  3: { width: 60 * Math.sqrt(3), depth: 40 * Math.sqrt(3) },
}

/** Half of a unit's north-south footprint, in meters -- how far its rotate
 *  handle sits from center (see HANDLE_GAP_METERS), shared by the interaction
 *  hit-testing and the handle-rendering code on both views. */
export function halfDepthMeters(symbolKind: SymbolKind): number {
  switch (symbolKind) {
    case 'blueSection':
    case 'redSection':
      return AREA_SIZE_METERS[2].depth / 2
    case 'bluePlatoon':
    case 'redPlatoon':
      return AREA_SIZE_METERS[3].depth / 2
    case 'trench':
    case 'preparedTrench':
      return 4
  }
}

/** Trench bracket shape in local (east, north) meter offsets from center,
 *  flat top with legs flaring out toward the bottom -- same proportions as
 *  the toolbar thumbnail's pixel shape, just in real ground units. */
export const TRENCH_POINTS_METERS: [number, number][] = [
  [-10, -4],
  [-5, 4],
  [5, 4],
  [10, -4],
]

/** Spacing between echelon-amplifier dots, north of the shape's top edge. */
export const DOT_SPACING_METERS = 8
export const DOT_OFFSET_METERS = 3

/** Gap between a shape's edge and its rotate handle, when selected. */
export const HANDLE_GAP_METERS = 6

/** Rotate a local (east, north) meter offset clockwise-from-north by theta --
 *  the same convention as lib/bearing.ts's bearingRadians. Shared by the 3D
 *  ENU-offset math (useUnitEntities.ts) and the 2D canvas math
 *  (TopoMapView.tsx) so a unit's rotation renders identically in both views. */
export function rotateOffset(east: number, north: number, theta: number): [number, number] {
  return [east * Math.cos(theta) + north * Math.sin(theta), -east * Math.sin(theta) + north * Math.cos(theta)]
}
