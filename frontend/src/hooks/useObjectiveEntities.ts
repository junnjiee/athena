import { useEffect, useRef } from 'react'
import * as Cesium from 'cesium'
import { syncEntities } from '../lib/entitySync'
import { objectiveStarIcon } from '../lib/markerIcons'
import { ACCENT_HEX } from '../lib/colors'
import type { PlacedObjective } from '../types/entities'

interface Args {
  viewer: Cesium.Viewer | undefined
  objectives: PlacedObjective[]
}

export function useObjectiveEntities({ viewer, objectives }: Args) {
  const entityMapRef = useRef(new Map<string, Cesium.Entity>())

  useEffect(() => {
    if (!viewer) return
    syncEntities(viewer, objectives, entityMapRef, (objective) => ({
      position: Cesium.Cartesian3.fromDegrees(objective.position.longitude, objective.position.latitude),
      billboard: {
        image: objectiveStarIcon(ACCENT_HEX),
        width: 28,
        height: 28,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: `${objective.name}\n${objective.description}`,
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString('#10151c').withAlpha(0.85),
        pixelOffset: new Cesium.Cartesian2(22, 0),
        horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        font: '12px sans-serif',
      },
      ellipse: {
        semiMajorAxis: objective.radiusMeters,
        semiMinorAxis: objective.radiusMeters,
        material: Cesium.Color.fromCssColorString(ACCENT_HEX).withAlpha(0.15),
        classificationType: Cesium.ClassificationType.TERRAIN,
      },
      properties: { placementKind: 'objective' },
    }))
  }, [viewer, objectives])

  useEffect(() => {
    const entityMap = entityMapRef.current
    return () => {
      if (!viewer) return
      for (const entity of entityMap.values()) viewer.entities.remove(entity)
      entityMap.clear()
    }
  }, [viewer])
}
