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

function ringToPositions(ring: [number, number][]): Cesium.Cartesian3[] {
  return Cesium.Cartesian3.fromDegreesArray(ring.flat())
}

/** Extruded OSM buildings whose height follows `extrusionFactor()` (0→1) so the
 *  reveal can grow them out of the ground. Call freezeBuildings() when done. */
export function buildBuildings(
  ds: Cesium.CustomDataSource,
  features: OsmFeatures,
  extrusionFactor: () => number,
): void {
  for (const b of features.buildings.slice(0, MAX_BUILDINGS)) {
    ds.entities.add({
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(ringToPositions(b.footprint)),
        material: BUILDING_COLOR,
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

export function buildRoads(ds: Cesium.CustomDataSource, features: OsmFeatures): void {
  for (const road of features.roads.slice(0, MAX_ROADS)) {
    const style = ROAD_STYLE[road.roadClass]
    ds.entities.add({
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray(road.points.flat()),
        clampToGround: true,
        width: style.width,
        material: style.dashed
          ? new Cesium.PolylineDashMaterialProperty({ color: style.color, dashLength: 12 })
          : new Cesium.ColorMaterialProperty(style.color),
      },
    })
  }
}

export function buildWater(ds: Cesium.CustomDataSource, features: OsmFeatures): void {
  for (const area of features.areas) {
    if (area.kind !== 'water' && area.kind !== 'wetland') continue
    ds.entities.add({
      polygon: {
        hierarchy: new Cesium.PolygonHierarchy(ringToPositions(area.ring)),
        material: area.kind === 'water' ? WATER_COLOR : WATER_COLOR.withAlpha(0.28),
        classificationType: Cesium.ClassificationType.TERRAIN,
      },
    })
  }
  for (const line of features.waterLines) {
    ds.entities.add({
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray(line.points.flat()),
        clampToGround: true,
        width: 5,
        material: new Cesium.ColorMaterialProperty(WATER_COLOR.withAlpha(0.65)),
      },
    })
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
