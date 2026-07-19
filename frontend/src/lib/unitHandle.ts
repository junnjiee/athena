import * as Cesium from 'cesium'
import { markerWorldPosition } from './pickTerrain'
import { halfDepthMeters, HANDLE_GAP_METERS, rotateOffset } from './tacticalGeometry'
import { offsetEastNorth } from './enuOffset'
import type { PlacedUnit } from '../types/entities'

/** World position of a unit's rotate handle -- offset from its center in the
 *  direction it currently faces, just beyond its own footprint. Shared by the
 *  interaction hit-test (useUnitEditing.ts) and the handle-rendering
 *  (useSelectionHandle.ts) so they never disagree. */
export function handleWorldPosition(unit: PlacedUnit): Cesium.Cartesian3 {
  const center = markerWorldPosition(unit.position)
  const halfDepth = halfDepthMeters(unit.symbolKind)
  const [east, north] = rotateOffset(0, halfDepth + HANDLE_GAP_METERS, unit.rotationRadians)
  return offsetEastNorth(center, east, north)
}
