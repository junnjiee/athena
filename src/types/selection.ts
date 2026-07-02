import type { Rectangle } from 'cesium'

export interface SelectionStats {
  centerLongitude: number
  centerLatitude: number
  widthMeters: number
  heightMeters: number
  areaKm2: number
}

export interface SelectionResult {
  rectangle: Rectangle
  stats: SelectionStats
}
