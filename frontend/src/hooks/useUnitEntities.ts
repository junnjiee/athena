import { useEffect, useRef } from 'react'
import * as Cesium from 'cesium'
import { syncEntityGroups } from '../lib/entitySync'
import { offsetEastNorth } from '../lib/enuOffset'
import {
  AREA_SIZE_METERS,
  TRENCH_POINTS_METERS,
  DOT_SPACING_METERS,
  DOT_OFFSET_METERS,
  rotateOffset,
} from '../lib/tacticalGeometry'
import { FRIENDLY_HEX, HOSTILE_HEX } from '../lib/colors'
import type { PlacedUnit } from '../types/entities'

interface Args {
  viewer: Cesium.Viewer | undefined
  units: PlacedUnit[]
}

/** All tactical position graphics are ground-clamped polylines (never
 *  ellipse/polygon fill+outline) -- polylines' clampToGround is a
 *  long-established, reliable Cesium feature (already used for roads/water in
 *  entityBuilders.ts), sidestepping known gaps in ground-primitive outline
 *  rendering for filled shapes we don't want filled anyway. Real-meter
 *  dimensions (not fixed pixels) are what makes these correctly shrink/grow
 *  with camera zoom, mirroring useObjectiveEntities.ts's ellipse radius. Every
 *  local offset is run through rotateOffset first so a unit's rotationRadians
 *  reorients its whole shape (and dots) around its own center. */

function rotatedOffsetPosition(
  center: Cesium.Cartesian3,
  rotationRadians: number,
  east: number,
  north: number,
): Cesium.Cartesian3 {
  const [re, rn] = rotateOffset(east, north, rotationRadians)
  return offsetEastNorth(center, re, rn)
}

function ellipsePerimeter(
  center: Cesium.Cartesian3,
  rotationRadians: number,
  rx: number,
  ry: number,
  segments = 32,
): Cesium.Cartesian3[] {
  const points: Cesium.Cartesian3[] = []
  for (let i = 0; i <= segments; i++) {
    const theta = (i / segments) * Math.PI * 2
    points.push(rotatedOffsetPosition(center, rotationRadians, rx * Math.cos(theta), ry * Math.sin(theta)))
  }
  return points
}

function dotEntities(
  center: Cesium.Cartesian3,
  rotationRadians: number,
  count: 2 | 3,
  northOffset: number,
  color: string,
): Cesium.Entity.ConstructorOptions[] {
  const startEast = -((count - 1) * DOT_SPACING_METERS) / 2
  const entities: Cesium.Entity.ConstructorOptions[] = []
  for (let i = 0; i < count; i++) {
    entities.push({
      position: rotatedOffsetPosition(center, rotationRadians, startEast + i * DOT_SPACING_METERS, northOffset),
      point: {
        pixelSize: 5,
        color: Cesium.Color.fromCssColorString(color),
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    })
  }
  return entities
}

function labelFor(unit: PlacedUnit): Cesium.Entity.ConstructorOptions['label'] {
  return {
    text: `${unit.name}\n${unit.typeLabel}`,
    showBackground: true,
    backgroundColor: Cesium.Color.fromCssColorString('#10151c').withAlpha(0.85),
    pixelOffset: new Cesium.Cartesian2(30, 0),
    horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
    heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
    disableDepthTestDistance: Number.POSITIVE_INFINITY,
    font: '12px sans-serif',
  }
}

function areaEntities(unit: PlacedUnit, dots: 2 | 3, shape: 'oval' | 'rect', color: string): Cesium.Entity.ConstructorOptions[] {
  const center = Cesium.Cartesian3.fromDegrees(unit.position.longitude, unit.position.latitude)
  const { width, depth } = AREA_SIZE_METERS[dots]
  const rx = width / 2
  const ry = depth / 2
  const material = Cesium.Color.fromCssColorString(color)

  const entities: Cesium.Entity.ConstructorOptions[] = []

  if (shape === 'oval') {
    entities.push({
      position: center,
      polyline: {
        positions: ellipsePerimeter(center, unit.rotationRadians, rx, ry),
        clampToGround: true,
        width: 2.5,
        material,
      },
      label: labelFor(unit),
      properties: { placementKind: 'unit', side: unit.side },
    })
  } else {
    const tl = rotatedOffsetPosition(center, unit.rotationRadians, -rx, ry)
    const tr = rotatedOffsetPosition(center, unit.rotationRadians, rx, ry)
    const br = rotatedOffsetPosition(center, unit.rotationRadians, rx, -ry)
    const bl = rotatedOffsetPosition(center, unit.rotationRadians, -rx, -ry)

    entities.push({
      position: center,
      polyline: {
        positions: [tl, tr, br, bl, tl],
        clampToGround: true,
        width: 2.5,
        material,
      },
      label: labelFor(unit),
      properties: { placementKind: 'unit', side: unit.side },
    })
    entities.push({ polyline: { positions: [tl, br], clampToGround: true, width: 2, material } })
    entities.push({ polyline: { positions: [tr, bl], clampToGround: true, width: 2, material } })
  }

  entities.push(...dotEntities(center, unit.rotationRadians, dots, ry + DOT_OFFSET_METERS, color))
  return entities
}

function trenchEntities(unit: PlacedUnit, prepared: boolean): Cesium.Entity.ConstructorOptions[] {
  const center = Cesium.Cartesian3.fromDegrees(unit.position.longitude, unit.position.latitude)
  const positions = TRENCH_POINTS_METERS.map(([east, north]) =>
    rotatedOffsetPosition(center, unit.rotationRadians, east, north),
  )
  const color = Cesium.Color.fromCssColorString(HOSTILE_HEX)
  return [
    {
      position: center,
      polyline: {
        positions,
        clampToGround: true,
        width: 2.5,
        material: prepared
          ? new Cesium.PolylineDashMaterialProperty({ color, dashLength: 8 })
          : new Cesium.ColorMaterialProperty(color),
      },
      label: labelFor(unit),
      properties: { placementKind: 'unit', side: unit.side },
    },
  ]
}

function entitiesForUnit(unit: PlacedUnit): Cesium.Entity.ConstructorOptions[] {
  switch (unit.symbolKind) {
    case 'blueSection':
      return areaEntities(unit, 2, 'rect', FRIENDLY_HEX)
    case 'bluePlatoon':
      return areaEntities(unit, 3, 'rect', FRIENDLY_HEX)
    case 'redSection':
      return areaEntities(unit, 2, 'oval', HOSTILE_HEX)
    case 'redPlatoon':
      return areaEntities(unit, 3, 'oval', HOSTILE_HEX)
    case 'trench':
      return trenchEntities(unit, false)
    case 'preparedTrench':
      return trenchEntities(unit, true)
  }
}

export function useUnitEntities({ viewer, units }: Args) {
  const entityMapRef = useRef(new Map<string, { item: PlacedUnit; entities: Cesium.Entity[] }>())

  useEffect(() => {
    if (!viewer) return
    syncEntityGroups(viewer, units, entityMapRef, entitiesForUnit)
  }, [viewer, units])

  useEffect(() => {
    const entityMap = entityMapRef.current
    return () => {
      if (!viewer) return
      for (const { entities } of entityMap.values()) {
        for (const entity of entities) viewer.entities.remove(entity)
      }
      entityMap.clear()
    }
  }, [viewer])
}
