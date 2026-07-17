import * as Cesium from 'cesium'
import { markerWorldPosition } from './pickTerrain'
import type { PlacedObjective, PlacedUnit } from '../types/entities'

/** Screen-space hit-test tolerance shared by every 3D interaction that needs
 *  to find "the marker under this click" -- selection/drag (useUnitEditing.ts)
 *  and placement-priority (usePlacementTool.ts) both need the identical
 *  radius so a click that would select an element behaves consistently
 *  regardless of which tool happened to be armed when it landed. */
export const HIT_RADIUS_PX = 26

/** Trenches are a ~20m bracket, much smaller than a 60-100m section/platoon --
 *  at the same fixed hit radius they're an easy miss-click, which stamps an
 *  accidental duplicate right next to one instead of reselecting it. Give the
 *  smallest placeable shapes a bit more tolerance. */
const TRENCH_HIT_RADIUS_PX = 36

function hitRadiusFor(unit: PlacedUnit): number {
  return unit.symbolKind === 'trench' || unit.symbolKind === 'preparedTrench' ? TRENCH_HIT_RADIUS_PX : HIT_RADIUS_PX
}

export function findNearestUnit(viewer: Cesium.Viewer, point: Cesium.Cartesian2, units: PlacedUnit[]): PlacedUnit | null {
  let best: PlacedUnit | null = null
  let bestDistance = Infinity
  for (const unit of units) {
    const screen = viewer.scene.cartesianToCanvasCoordinates(markerWorldPosition(unit.position))
    if (!screen) continue
    const distance = Cesium.Cartesian2.distance(screen, point)
    if (distance <= hitRadiusFor(unit) && distance <= bestDistance) {
      best = unit
      bestDistance = distance
    }
  }
  return best
}

export function findNearestObjective(
  viewer: Cesium.Viewer,
  point: Cesium.Cartesian2,
  objectives: PlacedObjective[],
): PlacedObjective | null {
  let best: PlacedObjective | null = null
  let bestDistance = HIT_RADIUS_PX
  for (const objective of objectives) {
    const screen = viewer.scene.cartesianToCanvasCoordinates(markerWorldPosition(objective.position))
    if (!screen) continue
    const distance = Cesium.Cartesian2.distance(screen, point)
    if (distance <= bestDistance) {
      best = objective
      bestDistance = distance
    }
  }
  return best
}
