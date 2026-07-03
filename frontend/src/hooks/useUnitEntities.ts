import { useEffect, useRef } from 'react'
import * as Cesium from 'cesium'
import { syncEntities } from '../lib/entitySync'
import { unitDiamondIcon, threatDiamondIcon } from '../lib/markerIcons'
import { FRIENDLY_HEX, HOSTILE_HEX } from '../lib/colors'
import type { PlacedUnit } from '../types/entities'

interface Args {
  viewer: Cesium.Viewer | undefined
  units: PlacedUnit[]
}

export function useUnitEntities({ viewer, units }: Args) {
  const entityMapRef = useRef(new Map<string, Cesium.Entity>())

  useEffect(() => {
    if (!viewer) return
    syncEntities(viewer, units, entityMapRef, (unit) => ({
      position: Cesium.Cartesian3.fromDegrees(unit.position.longitude, unit.position.latitude),
      billboard: {
        image: unit.side === 'blue' ? unitDiamondIcon(FRIENDLY_HEX) : threatDiamondIcon(HOSTILE_HEX),
        width: 28,
        height: 28,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label:
        unit.side === 'blue'
          ? {
              text: `${unit.name}\n${unit.typeLabel}`,
              showBackground: true,
              backgroundColor: Cesium.Color.fromCssColorString('#10151c').withAlpha(0.85),
              pixelOffset: new Cesium.Cartesian2(22, 0),
              horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
              font: '12px sans-serif',
            }
          : undefined,
      properties: { placementKind: 'unit', side: unit.side },
    }))
  }, [viewer, units])

  useEffect(() => {
    const entityMap = entityMapRef.current
    return () => {
      if (!viewer) return
      for (const entity of entityMap.values()) viewer.entities.remove(entity)
      entityMap.clear()
    }
  }, [viewer])
}
