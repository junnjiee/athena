import { useEffect, useRef } from 'react'
import * as Cesium from 'cesium'
import { syncEntities } from '../lib/entitySync'
import type { CorridorLine } from '../lib/routeStudy'

interface StyledCorridorLine extends CorridorLine {
  selected: boolean
}

export function useCorridorEntities({
  viewer,
  lines,
  selectedCorridorId,
}: {
  viewer: Cesium.Viewer | undefined
  lines: CorridorLine[]
  selectedCorridorId: string | null
}) {
  const entityMapRef = useRef(new Map<string, { item: StyledCorridorLine; entity: Cesium.Entity }>())

  useEffect(() => {
    if (!viewer) return
    // Selecting a corridor changes its emphasis without changing the underlying
    // engine result; clone those items so entitySync rebuilds just that overlay.
    const styled = lines.map((line) => ({ ...line, selected: line.corridorId === selectedCorridorId }))
    syncEntities(viewer, styled, entityMapRef, (line) => {
      const color = Cesium.Color.fromCssColorString(line.color)
      const choke = line.kind === 'choke'
      return {
        polyline: {
          positions: line.points.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat)),
          width: choke ? (line.selected ? 11 : 9) : line.selected ? 5 : 3,
          material: choke
            ? new Cesium.PolylineGlowMaterialProperty({
                color,
                glowPower: 0.3,
                taperPower: 0.7,
              })
            : color.withAlpha(line.selected ? 0.95 : 0.72),
          clampToGround: true,
          classificationType: Cesium.ClassificationType.BOTH,
          zIndex: choke ? 20 : line.selected ? 10 : 1,
        },
        properties: { corridorId: line.corridorId, kind: line.kind },
      }
    })
  }, [viewer, lines, selectedCorridorId])

  useEffect(() => {
    const entityMap = entityMapRef.current
    return () => {
      if (!viewer) return
      for (const { entity } of entityMap.values()) viewer.entities.remove(entity)
      entityMap.clear()
    }
  }, [viewer])
}

