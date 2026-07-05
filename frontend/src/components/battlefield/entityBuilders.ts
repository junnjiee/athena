import * as Cesium from 'cesium'
import type { OsmFeatures, RoadClass } from '../../types/terrain'
import type { PlanWarning } from '../../lib/validate'

const MAX_BUILDINGS = 1500
const MAX_ROADS = 1200

const BUILDING_COLOR = Cesium.Color.fromCssColorString('#556173').withAlpha(0.94)
const WATER_COLOR = Cesium.Color.fromCssColorString('#2f6db8').withAlpha(0.5)

const ROAD_STYLE: Record<RoadClass, { width: number; color: Cesium.Color; dashed: boolean }> = {
  major: { width: 4.5, color: Cesium.Color.fromCssColorString('#e8e0c8').withAlpha(0.85), dashed: false },
  minor: { width: 2.75, color: Cesium.Color.fromCssColorString('#cfc9b4').withAlpha(0.7), dashed: false },
  track: { width: 2, color: Cesium.Color.fromCssColorString('#bdb08e').withAlpha(0.6), dashed: true },
  path: { width: 1.5, color: Cesium.Color.fromCssColorString('#a8a68f').withAlpha(0.55), dashed: true },
}

// Monochrome/military-map palette -- widths and dash patterns are reused unchanged
// from ROAD_STYLE above, since hue can't carry the road-class distinction in
// grayscale; only color differs.
const MONO_BUILDING_COLOR = Cesium.Color.fromCssColorString('#2b2f36').withAlpha(0.94)
const MONO_WATER_COLOR = Cesium.Color.fromCssColorString('#828a94').withAlpha(0.5)

const MONO_ROAD_STYLE: Record<RoadClass, { width: number; color: Cesium.Color; dashed: boolean }> = {
  major: { width: 4.5, color: Cesium.Color.fromCssColorString('#f2f2f2').withAlpha(0.9), dashed: false },
  minor: { width: 2.75, color: Cesium.Color.fromCssColorString('#c9c9c9').withAlpha(0.75), dashed: false },
  track: { width: 2, color: Cesium.Color.fromCssColorString('#9a9a9a').withAlpha(0.65), dashed: true },
  path: { width: 1.5, color: Cesium.Color.fromCssColorString('#7f7f7f').withAlpha(0.6), dashed: true },
}

function ringToPositions(ring: [number, number][]): Cesium.Cartesian3[] {
  return Cesium.Cartesian3.fromDegreesArray(ring.flat())
}

/** Extruded OSM buildings whose height follows `extrusionFactor()` (0→1) so the
 *  reveal can grow them out of the ground. Call freezeBuildings() when done. */
export function buildBuildings(
  ds: Cesium.CustomDataSource,
  features: OsmFeatures,
  extrusionFactor: () => number,
  monochrome: boolean,
): void {
  const color = monochrome ? MONO_BUILDING_COLOR : BUILDING_COLOR
  for (const b of features.buildings.slice(0, MAX_BUILDINGS)) {
    ds.entities.add({
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(ringToPositions(b.footprint)),
        material: color,
        height: 0,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        extrudedHeight: new Cesium.CallbackProperty(
          () => Math.max(0.05, b.heightMeters * extrusionFactor()),
          false,
        ),
        extrudedHeightReference: Cesium.HeightReference.RELATIVE_TO_GROUND,
        outline: false,
      },
      properties: { finalHeight: b.heightMeters },
    })
  }
}

/** Swap animated extrusions for constants so nothing re-evaluates per frame. */
export function freezeBuildings(ds: Cesium.CustomDataSource): void {
  for (const entity of ds.entities.values) {
    const finalHeight = entity.properties?.finalHeight?.getValue() as number | undefined
    if (entity.polygon && typeof finalHeight === 'number') {
      entity.polygon.extrudedHeight = new Cesium.ConstantProperty(finalHeight)
    }
  }
}

/** Restyle already-built building entities in place (no rebuild/reveal replay). */
export function restyleBuildings(ds: Cesium.CustomDataSource, monochrome: boolean): void {
  const color = monochrome ? MONO_BUILDING_COLOR : BUILDING_COLOR
  for (const entity of ds.entities.values) {
    if (entity.polygon) entity.polygon.material = new Cesium.ColorMaterialProperty(color)
  }
}

export function buildRoads(ds: Cesium.CustomDataSource, features: OsmFeatures, monochrome: boolean): void {
  const table = monochrome ? MONO_ROAD_STYLE : ROAD_STYLE
  for (const road of features.roads.slice(0, MAX_ROADS)) {
    const style = table[road.roadClass]
    ds.entities.add({
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray(road.points.flat()),
        clampToGround: true,
        width: style.width,
        material: style.dashed
          ? new Cesium.PolylineDashMaterialProperty({ color: style.color, dashLength: 12 })
          : new Cesium.ColorMaterialProperty(style.color),
      },
      properties: { roadClass: road.roadClass },
    })
  }
}

/** Restyle already-built road entities in place (no rebuild/reveal replay). */
export function restyleRoads(ds: Cesium.CustomDataSource, monochrome: boolean): void {
  const table = monochrome ? MONO_ROAD_STYLE : ROAD_STYLE
  for (const entity of ds.entities.values) {
    const roadClass = entity.properties?.roadClass?.getValue() as RoadClass | undefined
    if (!entity.polyline || !roadClass) continue
    const style = table[roadClass]
    entity.polyline.material = style.dashed
      ? new Cesium.PolylineDashMaterialProperty({ color: style.color, dashLength: 12 })
      : new Cesium.ColorMaterialProperty(style.color)
  }
}

export function buildWater(ds: Cesium.CustomDataSource, features: OsmFeatures, monochrome: boolean): void {
  const waterColor = monochrome ? MONO_WATER_COLOR : WATER_COLOR
  for (const area of features.areas) {
    if (area.kind !== 'water' && area.kind !== 'wetland') continue
    ds.entities.add({
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(ringToPositions(area.ring)),
        material: area.kind === 'water' ? waterColor : waterColor.withAlpha(0.28),
        classificationType: Cesium.ClassificationType.TERRAIN,
      },
      properties: { areaKind: area.kind },
    })
  }
  for (const line of features.waterLines) {
    ds.entities.add({
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray(line.points.flat()),
        clampToGround: true,
        width: 5,
        material: new Cesium.ColorMaterialProperty(waterColor.withAlpha(0.65)),
      },
      properties: { areaKind: 'waterline' },
    })
  }
}

/** Restyle already-built water entities in place (no rebuild/reveal replay). */
export function restyleWater(ds: Cesium.CustomDataSource, monochrome: boolean): void {
  const waterColor = monochrome ? MONO_WATER_COLOR : WATER_COLOR
  for (const entity of ds.entities.values) {
    const areaKind = entity.properties?.areaKind?.getValue() as string | undefined
    if (entity.polygon) {
      entity.polygon.material = new Cesium.ColorMaterialProperty(
        areaKind === 'water' ? waterColor : waterColor.withAlpha(0.28),
      )
    } else if (entity.polyline) {
      entity.polyline.material = new Cesium.ColorMaterialProperty(waterColor.withAlpha(0.65))
    }
  }
}

function warningIconDataUrl(severity: PlanWarning['severity']): string {
  const color = severity === 'critical' ? '#e8564f' : '#eab308'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="24" viewBox="0 0 26 24">
    <path d="M13 2 L24.5 22 L1.5 22 Z" fill="${color}" stroke="rgba(10,13,18,0.9)" stroke-width="1.5" stroke-linejoin="round"/>
    <rect x="12" y="9" width="2" height="7" rx="1" fill="#0a0d12"/>
    <circle cx="13" cy="19" r="1.2" fill="#0a0d12"/>
  </svg>`
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

/** Amber/red hazard markers where the plan validator flagged trouble. */
export function buildWarningMarkers(ds: Cesium.CustomDataSource, warnings: PlanWarning[]): void {
  for (const warning of warnings) {
    ds.entities.add({
      position: Cesium.Cartesian3.fromDegrees(warning.position.longitude, warning.position.latitude),
      billboard: {
        image: warningIconDataUrl(warning.severity),
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scale: 0.9,
      },
    })
  }
}
