import { describe, expect, test } from 'bun:test'
import { densifyRoute, median } from '../src/lib/photoHeights'
import type { LonLat } from '../src/types/entities'

describe('densifyRoute', () => {
  test('passes short inputs through', () => {
    const single: LonLat[] = [{ longitude: 103.7, latitude: 1.3 }]
    expect(densifyRoute(single)).toEqual(single)
  })

  test('splits a long segment so no hop exceeds the spacing', () => {
    // ~1113 m of longitude at the equator
    const points: LonLat[] = [
      { longitude: 103.7, latitude: 0 },
      { longitude: 103.71, latitude: 0 },
    ]
    const dense = densifyRoute(points, 100)
    expect(dense.length).toBeGreaterThanOrEqual(12)
    expect(dense[0]).toEqual(points[0])
    expect(dense[dense.length - 1]).toEqual(points[1])
    for (let i = 1; i < dense.length; i++) {
      const dxM = (dense[i].longitude - dense[i - 1].longitude) * 111_320
      expect(Math.abs(dxM)).toBeLessThanOrEqual(101)
    }
  })

  test('keeps already-dense points unchanged in count', () => {
    const points: LonLat[] = [
      { longitude: 103.7, latitude: 1.3 },
      { longitude: 103.70001, latitude: 1.3 },
      { longitude: 103.70002, latitude: 1.3 },
    ]
    expect(densifyRoute(points, 10)).toHaveLength(3)
  })
})

describe('median', () => {
  test('empty input has no median', () => {
    expect(median([])).toBeNull()
  })

  test('odd and even counts', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
  })

  test('does not mutate its input', () => {
    const values = [3, 1, 2]
    median(values)
    expect(values).toEqual([3, 1, 2])
  })
})
