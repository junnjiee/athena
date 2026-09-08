import { describe, expect, test } from 'bun:test'
import * as Cesium from 'cesium'
import {
  clampCorner,
  computeRectangleStats,
  MAX_SELECTION_EXTENT_METERS,
  OPERATIONAL_MAX_SELECTION_EXTENT_METERS,
} from '../src/lib/selectionGeometry'

function clampedStats(maxExtentMeters?: number) {
  const start = Cesium.Cartographic.fromDegrees(103.7, 1.3)
  const distant = Cesium.Cartographic.fromDegrees(105, 3)
  const corner = clampCorner(start, distant, maxExtentMeters)
  return computeRectangleStats(Cesium.Rectangle.fromCartographicArray([start, corner]))
}

describe('rectangle selection scales', () => {
  test('the tactical selector caps each side at 800 metres', () => {
    const stats = clampedStats()
    expect(MAX_SELECTION_EXTENT_METERS).toBe(800)
    expect(stats.widthMeters).toBeGreaterThan(790)
    expect(stats.widthMeters).toBeLessThan(810)
    expect(stats.heightMeters).toBeGreaterThan(790)
    expect(stats.heightMeters).toBeLessThan(810)
  })

  test('the operational selector can span 50 kilometres', () => {
    const stats = clampedStats(OPERATIONAL_MAX_SELECTION_EXTENT_METERS)
    expect(stats.widthMeters).toBeGreaterThan(49_500)
    expect(stats.widthMeters).toBeLessThan(50_500)
    expect(stats.heightMeters).toBeGreaterThan(49_500)
    expect(stats.heightMeters).toBeLessThan(50_500)
  })
})
