import { useEffect, useRef } from 'react'
import * as Cesium from 'cesium'
import { syncEntities } from '../lib/entitySync'
import { unitSymbol } from '../lib/milsymbols'
import type { PlacedUnit } from '../types/entities'

interface Args {
  viewer: Cesium.Viewer | undefined
  units: PlacedUnit[]
}

export function useUnitEntities({ viewer, units }: Args) {
  const entityMapRef = useRef(new Map<string, Cesium.Entity>())

  useEffect(() => {
    if (!viewer) return
    syncEntities(viewer, units, entityMapRef, (unit) => {
      const symbol = unitSymbol(unit.side)
      return {
      position: Cesium.Cartesian3.fromDegrees(unit.position.longitude, unit.position.latitude),
      billboard: {
        image: symbol.url,
        width: symbol.width,
        height: symbol.height,
        heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label:
        unit.side === 'blue'
          ? {
              text: `${unit.name}\n${unit.typeLabel}`,
              showBackground: true,
              backgroundColor: Cesium.Color.fromCssColorString('#10151c').withAlpha(0.85),
              pixelOffset: new Cesium.Cartesian2(symbol.width / 2 + 6, 0),
              horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
              font: '12px sans-serif',
            }
          : undefined,
      properties: { placementKind: 'unit', side: unit.side },
      }
    })
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
