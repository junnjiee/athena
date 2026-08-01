import { describe, expect, test } from 'bun:test'
import { enuToEcefMatrix, geodeticToEcef } from '../src/lib/enu'

describe('geodeticToEcef', () => {
  test('equator/prime meridian sits on the +X semi-major axis', () => {
    const [x, y, z] = geodeticToEcef(0, 0, 0)
    expect(x).toBeCloseTo(6378137, 3)
    expect(y).toBeCloseTo(0, 6)
    expect(z).toBeCloseTo(0, 6)
  })

  test('north pole sits on +Z at the semi-minor axis', () => {
    const [x, y, z] = geodeticToEcef(0, 90, 0)
    expect(x).toBeCloseTo(0, 3)
    expect(y).toBeCloseTo(0, 6)
    expect(z).toBeCloseTo(6356752.314, 2)
  })

  test('height adds along the surface normal', () => {
    const [x0] = geodeticToEcef(0, 0, 0)
    const [x100] = geodeticToEcef(0, 0, 100)
    expect(x100 - x0).toBeCloseTo(100, 6)
  })
})

describe('enuToEcefMatrix', () => {
  test('at (0,0): east=+Y, north=+Z, up=+X, column-major', () => {
    const m = enuToEcefMatrix(0, 0, 0)
    expect(m.slice(0, 4)).toEqual([-0, 1, 0, 0]) // east column
    expect(m.slice(4, 8)).toEqual([-0, -0, 1, 0]) // north column
    expect(m.slice(8, 12)).toEqual([1, 0, 0, 0]) // up column
    expect(m[12]).toBeCloseTo(6378137, 3) // origin
    expect(m[15]).toBe(1)
  })

  test('basis vectors are orthonormal at an arbitrary point', () => {
    const m = enuToEcefMatrix(103.7185, 1.3092, 25)
    const east = [m[0], m[1], m[2]]
    const north = [m[4], m[5], m[6]]
    const up = [m[8], m[9], m[10]]
    const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
    expect(dot(east, east)).toBeCloseTo(1, 10)
    expect(dot(north, north)).toBeCloseTo(1, 10)
    expect(dot(up, up)).toBeCloseTo(1, 10)
    expect(dot(east, north)).toBeCloseTo(0, 10)
    expect(dot(east, up)).toBeCloseTo(0, 10)
    expect(dot(north, up)).toBeCloseTo(0, 10)
  })
})
