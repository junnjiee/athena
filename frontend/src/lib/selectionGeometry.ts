import * as Cesium from 'cesium'

/** Maximum side length of the tactical battleground selector. */
export const MAX_SELECTION_EXTENT_METERS = 800

/** Maximum side length of an operational road-graph ingest. */
export const OPERATIONAL_MAX_SELECTION_EXTENT_METERS = 50_000

function metersPerDegree(latitudeRadians: number) {
  return {
    metersPerDegreeLat: 111_320,
    metersPerDegreeLon: 111_320 * Math.cos(latitudeRadians),
  }
}

/** Clamp `current` so its distance from the fixed `start` corner never exceeds
 *  `maxExtentMeters` along either axis, independent of drag direction. The local
 *  tangent approximation remains comfortably accurate for the largest supported
 *  operational selection (50 km) and is cheap enough to run on every mousemove. */
export function clampCorner(
  start: Cesium.Cartographic,
  current: Cesium.Cartographic,
  maxExtentMeters = MAX_SELECTION_EXTENT_METERS,
): Cesium.Cartographic {
  const { metersPerDegreeLat, metersPerDegreeLon } = metersPerDegree(start.latitude)
  const dNorthMeters = Cesium.Math.toDegrees(current.latitude - start.latitude) * metersPerDegreeLat
  const dEastMeters = Cesium.Math.toDegrees(current.longitude - start.longitude) * metersPerDegreeLon

  const clampedNorth = Cesium.Math.clamp(dNorthMeters, -maxExtentMeters, maxExtentMeters)
  const clampedEast = Cesium.Math.clamp(dEastMeters, -maxExtentMeters, maxExtentMeters)

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

function cornerDiagonalMeters(rectangle: Cesium.Rectangle): number {
  const corner1 = Cesium.Cartesian3.fromRadians(rectangle.west, rectangle.south, 0)
  const corner2 = Cesium.Cartesian3.fromRadians(rectangle.east, rectangle.north, 0)
  return Cesium.Cartesian3.distance(corner1, corner2)
}

/** Snap the camera into an oblique preview looking down at the selection.
 *
 *  Uses `camera.setView` (instant, no animation) rather than `camera.flyTo` --
 *  empirically, a `flyTo` covering a very large range (whole-Earth default view
 *  down to a target tens/hundreds of metres up) does not reliably land at the
 *  requested `destination`; `setView` with the identical destination/orientation
 *  lands exactly where asked, every time. Losing the animated swoop-in is a
 *  worthwhile trade for the camera actually arriving where the ground is,
 *  rather than settling somewhere that renders as a blank globe.
 *
 *  `baseHeightMeters` (ellipsoid-relative) anchors the destination -- default 0
 *  (not sampled terrain elevation) is fine right after a fresh drag-select, where
 *  no elevation data exists yet and adding an async terrain-sample step between
 *  mouse-up and the camera move starting isn't worth it. But for ground whose
 *  elevation IS already known (a just-loaded plan/replay), 0 is actively wrong:
 *  on ground sitting well above the ellipsoid (Berlin's ~40-90m of geoid
 *  separation plus terrain, say) it's the difference between the camera ending
 *  up comfortably above the surface or embedded in it. Pass the real mean
 *  elevation whenever it's on hand. */
export function flyToSelectionPreview(viewer: Cesium.Viewer, rectangle: Cesium.Rectangle, baseHeightMeters = 0) {
  const center = Cesium.Rectangle.center(rectangle)
  const diagonalMeters = cornerDiagonalMeters(rectangle)
  // Comfortable altitude above the target, floored so a tiny selection still
  // gets an unambiguously-clear-of-the-ground vantage.
  const altitudeMeters = Math.max(diagonalMeters * 1.5, 200)
  const destination = Cesium.Cartesian3.fromRadians(
    center.longitude,
    center.latitude,
    baseHeightMeters + altitudeMeters,
  )

  viewer.camera.setView({
    destination,
    orientation: { heading: viewer.camera.heading, pitch: Cesium.Math.toRadians(-60), roll: 0 },
  })
}

const ZOOM_CAP_DIAGONAL_MULTIPLIER = 3
const ZOOM_CAP_MINIMUM_METERS = 500

/** Maximum camera height allowed once a ground selection is locked in. 3x the
 *  selection's diagonal leaves headroom for an establishing oblique view of the whole
 *  footprint plus margin, without letting the user zoom out far enough to see
 *  real terrain/imagery outside the generated bbox and lose the "this is the
 *  battlefield" framing. The floor keeps small selections from producing a cap so
 *  tight it feels broken on approach. */
export function computeMaximumZoomDistance(rectangle: Cesium.Rectangle): number {
  return Math.max(cornerDiagonalMeters(rectangle) * ZOOM_CAP_DIAGONAL_MULTIPLIER, ZOOM_CAP_MINIMUM_METERS)
}
