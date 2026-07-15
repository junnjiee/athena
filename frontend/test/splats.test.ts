import { describe, expect, test } from 'bun:test'
import * as Cesium from 'cesium'
import { georeferenceMatrix, type SplatPlacement } from '../src/lib/splats'

const PLACEMENT: SplatPlacement = { lon: 103.7185, lat: 1.3092, heightM: 25 }

describe('georeferenceMatrix', () => {
  test('maps the tileset center onto the placement point', () => {
    const center = Cesium.Cartesian3.fromDegrees(103.9, 1.5, 100)
    const matrix = georeferenceMatrix(center, PLACEMENT)
    const moved = Cesium.Matrix4.multiplyByPoint(matrix, center, new Cesium.Cartesian3())
    const target = Cesium.Cartesian3.fromDegrees(PLACEMENT.lon, PLACEMENT.lat, PLACEMENT.heightM)
    expect(Cesium.Cartesian3.distance(moved, target)).toBeLessThan(1e-6)
  })

  test('heading rotates content around the placement point without moving it', () => {
    const center = Cesium.Cartesian3.fromDegrees(103.9, 1.5, 100)
    const target = Cesium.Cartesian3.fromDegrees(PLACEMENT.lon, PLACEMENT.lat, PLACEMENT.heightM)
    const offsetPoint = Cesium.Cartesian3.add(center, new Cesium.Cartesian3(10, 0, 0), new Cesium.Cartesian3())

    const m0 = georeferenceMatrix(center, PLACEMENT)
    const m180 = georeferenceMatrix(center, { ...PLACEMENT, headingDeg: 180 })

    // the center itself is pinned to the target regardless of heading
    const movedCenter = Cesium.Matrix4.multiplyByPoint(m180, center, new Cesium.Cartesian3())
    expect(Cesium.Cartesian3.distance(movedCenter, target)).toBeLessThan(1e-6)

    // an off-center point keeps its distance to the target but lands on the
    // opposite side under a 180-degree heading
    const p0 = Cesium.Matrix4.multiplyByPoint(m0, offsetPoint, new Cesium.Cartesian3())
    const p180 = Cesium.Matrix4.multiplyByPoint(m180, offsetPoint, new Cesium.Cartesian3())
    expect(Cesium.Cartesian3.distance(p0, target)).toBeCloseTo(10, 5)
    expect(Cesium.Cartesian3.distance(p180, target)).toBeCloseTo(10, 5)
    const v0 = Cesium.Cartesian3.subtract(p0, target, new Cesium.Cartesian3())
    const v180 = Cesium.Cartesian3.subtract(p180, target, new Cesium.Cartesian3())
    // heading=180 flips the horizontal components: v180 ≈ reflection of v0
    // through the up axis, so their sum is (twice) the up-projection of v0
    const sum = Cesium.Cartesian3.add(v0, v180, new Cesium.Cartesian3())
    const up = Cesium.Cartesian3.normalize(target, new Cesium.Cartesian3())
    const horizontal = Cesium.Cartesian3.subtract(
      sum,
      Cesium.Cartesian3.multiplyByScalar(up, Cesium.Cartesian3.dot(sum, up), new Cesium.Cartesian3()),
      new Cesium.Cartesian3(),
    )
    expect(Cesium.Cartesian3.magnitude(horizontal)).toBeLessThan(1e-6)
  })

  test('uniform scale expands distances from the placement point', () => {
    const center = Cesium.Cartesian3.fromDegrees(103.9, 1.5, 100)
    const nearCenter = Cesium.Cartesian3.add(center, new Cesium.Cartesian3(10, 0, 0), new Cesium.Cartesian3())
    const m1 = georeferenceMatrix(center, PLACEMENT)
    const m2 = georeferenceMatrix(center, { ...PLACEMENT, scale: 2 })
    const target = Cesium.Cartesian3.fromDegrees(PLACEMENT.lon, PLACEMENT.lat, PLACEMENT.heightM)
    const d1 = Cesium.Cartesian3.distance(Cesium.Matrix4.multiplyByPoint(m1, nearCenter, new Cesium.Cartesian3()), target)
    const d2 = Cesium.Cartesian3.distance(Cesium.Matrix4.multiplyByPoint(m2, nearCenter, new Cesium.Cartesian3()), target)
    expect(d1).toBeCloseTo(10, 5)
    expect(d2).toBeCloseTo(20, 5)
  })
})
