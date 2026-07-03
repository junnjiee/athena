import * as Cesium from 'cesium'
import type { LonLat } from '../types/entities'

/** Compass bearing from `from` to `to`, in radians, 0 = north, clockwise-positive. */
export function bearingRadians(from: LonLat, to: LonLat): number {
  const lat1 = Cesium.Math.toRadians(from.latitude)
  const lat2 = Cesium.Math.toRadians(to.latitude)
  const dLon = Cesium.Math.toRadians(to.longitude - from.longitude)
  const y = Math.sin(dLon) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)
  return Math.atan2(y, x)
}
