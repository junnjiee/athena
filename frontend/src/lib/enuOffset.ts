import * as Cesium from 'cesium'

/** Offset a geographic point by (east, north) meters using a local East-North-Up
 *  frame -- the latitude-correct way to place a point at a precise ground
 *  distance from a center, unlike a naive degrees-per-meter approximation
 *  (longitude's meters-per-degree shrinks with cos(latitude), ENU handles this
 *  for free since it's a real 3D frame anchored at the center point). */
export function offsetEastNorth(center: Cesium.Cartesian3, eastMeters: number, northMeters: number): Cesium.Cartesian3 {
  const enu = Cesium.Transforms.eastNorthUpToFixedFrame(center)
  const local = new Cesium.Cartesian3(eastMeters, northMeters, 0)
  return Cesium.Matrix4.multiplyByPoint(enu, local, new Cesium.Cartesian3())
}
