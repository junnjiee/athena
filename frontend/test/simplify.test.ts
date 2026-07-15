import { describe, expect, test } from 'bun:test'
import { polylineLength, simplifyPolyline, type XY } from '../src/lib/simplify'

describe('simplifyPolyline', () => {
  test('returns short polylines unchanged', () => {
    const points: XY[] = [
      [0, 0],
      [10, 10],
    ]
    expect(simplifyPolyline(points, 2)).toEqual(points)
  })

  test('collapses collinear points onto the endpoints', () => {
    const points: XY[] = [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
      [10, 0],
    ]
    expect(simplifyPolyline(points, 1)).toEqual([
      [0, 0],
      [10, 0],
    ])
  })

  test('keeps a deviation larger than the tolerance', () => {
    const points: XY[] = [
      [0, 0],
      [5, 6],
      [10, 0],
    ]
    expect(simplifyPolyline(points, 2)).toEqual(points)
  })

  test('drops a deviation smaller than the tolerance', () => {
    const points: XY[] = [
      [0, 0],
      [5, 1],
      [10, 0],
    ]
    expect(simplifyPolyline(points, 2)).toEqual([
      [0, 0],
      [10, 0],
    ])
  })

  test('always preserves first and last points exactly', () => {
    const noisy: XY[] = Array.from({ length: 200 }, (_, i) => [i, Math.sin(i * 0.5) * 0.4])
    const simplified = simplifyPolyline(noisy, 1)
    expect(simplified[0]).toEqual(noisy[0])
    expect(simplified[simplified.length - 1]).toEqual(noisy[noisy.length - 1])
    expect(simplified.length).toBeLessThan(noisy.length)
  })

  test('preserves the shape of a genuine squiggle', () => {
    // A sine wave with 8px amplitude must keep its crests at 1px tolerance.
    const squiggle: XY[] = Array.from({ length: 100 }, (_, i) => [i * 2, Math.sin(i * 0.3) * 8])
    const simplified = simplifyPolyline(squiggle, 1)
    expect(simplified.length).toBeGreaterThan(10)
    const maxY = Math.max(...simplified.map(([, y]) => y))
    expect(maxY).toBeGreaterThan(7)
  })
})

describe('polylineLength', () => {
  test('is zero for a single point', () => {
    expect(polylineLength([[3, 4]])).toBe(0)
  })

  test('sums segment lengths', () => {
    expect(
      polylineLength([
        [0, 0],
        [3, 4],
        [3, 14],
      ]),
    ).toBe(15)
  })
})
