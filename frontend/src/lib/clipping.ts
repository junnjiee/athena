import * as Cesium from 'cesium'

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
  viewer.scene.globe.clippingPolygons = buildSelectionClippingPolygons(rectangle)
}

export function clearGlobeClipping(viewer: Cesium.Viewer) {
  // Globe.clippingPolygons is typed as non-optional (ClippingPolygonCollection, not
  // ClippingPolygonCollection | undefined) even though undefined is the documented/
  // valid runtime value that fully disables clipping -- hence the cast.
  viewer.scene.globe.clippingPolygons = undefined as unknown as Cesium.ClippingPolygonCollection
}
