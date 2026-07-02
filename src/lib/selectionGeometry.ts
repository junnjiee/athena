import * as Cesium from 'cesium'

export const MAX_SELECTION_EXTENT_METERS = 3000

function metersPerDegree(latitudeRadians: number) {
  return {
    metersPerDegreeLat: 111_320,
    metersPerDegreeLon: 111_320 * Math.cos(latitudeRadians),
  }
}

/** Clamp `current` so its distance from the fixed `start` corner never exceeds
 *  MAX_SELECTION_EXTENT_METERS along either axis, independent of drag direction.
 *  Flat-earth approximation -- cheap enough to run on every mousemove; accurate to
 *  well under 0.1% at this <=3km scale. */
export function clampCorner(start: Cesium.Cartographic, current: Cesium.Cartographic): Cesium.Cartographic {
  const { metersPerDegreeLat, metersPerDegreeLon } = metersPerDegree(start.latitude)
  const dNorthMeters = Cesium.Math.toDegrees(current.latitude - start.latitude) * metersPerDegreeLat
  const dEastMeters = Cesium.Math.toDegrees(current.longitude - start.longitude) * metersPerDegreeLon

  const clampedNorth = Cesium.Math.clamp(dNorthMeters, -MAX_SELECTION_EXTENT_METERS, MAX_SELECTION_EXTENT_METERS)
  const clampedEast = Cesium.Math.clamp(dEastMeters, -MAX_SELECTION_EXTENT_METERS, MAX_SELECTION_EXTENT_METERS)

  return Cesium.Cartographic.fromDegrees(
    Cesium.Math.toDegrees(start.longitude) + clampedEast / metersPerDegreeLon,
    Cesium.Math.toDegrees(start.latitude) + clampedNorth / metersPerDegreeLat,
  )
}

/** Precise geodesic stats, computed once at finalize (not a hot path). */
export function computeRectangleStats(rectangle: Cesium.Rectangle) {
  const sw = Cesium.Rectangle.southwest(rectangle)
  const se = Cesium.Rectangle.southeast(rectangle)
  const nw = Cesium.Rectangle.northwest(rectangle)
  const center = Cesium.Rectangle.center(rectangle)

  const widthMeters = new Cesium.EllipsoidGeodesic(sw, se).surfaceDistance
  const heightMeters = new Cesium.EllipsoidGeodesic(sw, nw).surfaceDistance

  return {
    centerLongitude: Cesium.Math.toDegrees(center.longitude),
    centerLatitude: Cesium.Math.toDegrees(center.latitude),
    widthMeters,
    heightMeters,
    areaKm2: (widthMeters * heightMeters) / 1_000_000,
  }
}

/** Fly/tilt the camera into an oblique ~45 degree preview fit to the selection. Uses
 *  ellipsoid height 0 for the corners/center (not sampled terrain elevation) -- on
 *  steep terrain the camera could clip into a hillside on fly-in; acceptable
 *  tradeoff for this MVP rather than adding an async terrain-sample step between
 *  mouse-up and the camera move starting. */
export function flyToSelectionPreview(viewer: Cesium.Viewer, rectangle: Cesium.Rectangle) {
  const center = Cesium.Rectangle.center(rectangle)
  const centerCartesian = Cesium.Cartesian3.fromRadians(center.longitude, center.latitude, 0)

  const corner1 = Cesium.Cartesian3.fromRadians(rectangle.west, rectangle.south, 0)
  const corner2 = Cesium.Cartesian3.fromRadians(rectangle.east, rectangle.north, 0)
  const diagonalMeters = Cesium.Cartesian3.distance(corner1, corner2)

  viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(centerCartesian, diagonalMeters / 2), {
    duration: 2.0,
    offset: new Cesium.HeadingPitchRange(
      viewer.camera.heading,
      Cesium.Math.toRadians(-45),
      diagonalMeters * 1.2,
    ),
  })
}
