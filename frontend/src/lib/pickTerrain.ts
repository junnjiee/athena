import * as Cesium from 'cesium'
import { useBattleground } from '../state/battleground'
import { sampleCell } from './grid'
import type { LonLat } from '../types/entities'

/** Terrain-accurate ground pick under a window position.
 *
 *  `camera.pickEllipsoid` ignores terrain entirely — on elevated ground the ray
 *  hits the ellipsoid *behind* the visible hillside, so clicks land visibly
 *  displaced from the cursor. `globe.pick` intersects the actual terrain mesh.
 *  It only works in 3D, so 2D/Columbus falls back to the ellipsoid pick (where
 *  terrain is flattened anyway and the ellipsoid answer is correct). */
export function pickGroundPosition(
  viewer: Cesium.Viewer,
  windowPosition: Cesium.Cartesian2,
): Cesium.Cartesian3 | undefined {
  if (viewer.scene.mode === Cesium.SceneMode.SCENE3D) {
    // Photo mode hides the globe and renders the photoreal mesh instead --
    // depth-buffer picking is the only pick that lands on that surface.
    if (!viewer.scene.globe.show && viewer.scene.pickPositionSupported) {
      const onMesh = viewer.scene.pickPosition(windowPosition)
      if (onMesh) return onMesh
    }
    const ray = viewer.camera.getPickRay(windowPosition)
    const onTerrain = ray ? viewer.scene.globe.pick(ray, viewer.scene) : undefined
    if (onTerrain) return onTerrain
  }
  return viewer.camera.pickEllipsoid(windowPosition, viewer.scene.globe.ellipsoid)
}

/** World position of a placed marker (unit/objective) for screen-space math.
 *
 *  Markers render with CLAMP_TO_GROUND, so on a hill the billboard sits at
 *  terrain height — hit-testing its position at ellipsoid height 0 projects to
 *  the wrong pixel and clicks "miss" the icon. Lift the point to the military
 *  grid's elevation when a battlefield is loaded. */
export function markerWorldPosition(position: LonLat): Cesium.Cartesian3 {
  const grid = useBattleground.getState().grid
  const heightM = grid ? (sampleCell(grid, position.longitude, position.latitude)?.elevation ?? 0) : 0
  return Cesium.Cartesian3.fromDegrees(position.longitude, position.latitude, heightM)
}
