import * as Cesium from 'cesium'

/** Below this, skip clipping entirely rather than apply it. Confirmed
 *  empirically: on a 51x45m selection, `globe.clippingPolygons` rendered a
 *  fully blank globe (correct camera, correct terrain/imagery already loaded)
 *  -- disabling clipping alone, nothing else changed, fixed it. Absolute ECEF
 *  coordinates run into the millions of metres while a small selection's
 *  polygon is tens of metres across, which is consistent with the clipping
 *  shader's float32 precision breaking down at that ratio. Hiding "the rest
 *  of the world" barely matters anyway once the AO already fills the frame at
 *  any sensible zoom, which a selection this small always will. */
const MIN_CLIPPING_DIAGONAL_METERS = 100

function diagonalMeters(rectangle: Cesium.Rectangle): number {
  const sw = Cesium.Cartesian3.fromRadians(rectangle.west, rectangle.south)
  const ne = Cesium.Cartesian3.fromRadians(rectangle.east, rectangle.north)
  return Cesium.Cartesian3.distance(sw, ne)
}

function buildSelectionClippingPolygons(rectangle: Cesium.Rectangle): Cesium.ClippingPolygonCollection {
  const positions = [
    Cesium.Cartesian3.fromRadians(rectangle.west, rectangle.south),
    Cesium.Cartesian3.fromRadians(rectangle.east, rectangle.south),
    Cesium.Cartesian3.fromRadians(rectangle.east, rectangle.north),
    Cesium.Cartesian3.fromRadians(rectangle.west, rectangle.north),
  ]
  return new Cesium.ClippingPolygonCollection({
    polygons: [new Cesium.ClippingPolygon({ positions })],
    inverse: true, // clip everything OUTSIDE the polygon, not inside
  })
}

/** Globe-only: no tileset counterpart needed in this architecture -- buildings,
 *  roads, water, trees, and the heatmap drape are all built purely from server bbox
 *  data (BattlefieldController.tsx) and already bounded to the selection; the only
 *  unbounded rendered content is the base Viewer's stock imagery layer and
 *  Terrain.fromWorldTerrain(), both of which globe.clippingPolygons covers. */
export function applyGlobeClipping(viewer: Cesium.Viewer, rectangle: Cesium.Rectangle) {
  if (diagonalMeters(rectangle) < MIN_CLIPPING_DIAGONAL_METERS) {
    viewer.scene.globe.clippingPolygons = undefined as unknown as Cesium.ClippingPolygonCollection
    return
  }
  viewer.scene.globe.clippingPolygons = buildSelectionClippingPolygons(rectangle)
}

export function clearGlobeClipping(viewer: Cesium.Viewer) {
  // Globe.clippingPolygons is typed as non-optional (ClippingPolygonCollection, not
  // ClippingPolygonCollection | undefined) even though undefined is the documented/
  // valid runtime value that fully disables clipping -- hence the cast.
  viewer.scene.globe.clippingPolygons = undefined as unknown as Cesium.ClippingPolygonCollection
}
