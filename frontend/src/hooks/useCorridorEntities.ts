import { useEffect, useRef } from 'react'
import * as Cesium from 'cesium'
import { syncEntities } from '../lib/entitySync'
import type { CorridorLine } from '../lib/routeStudy'

interface StyledCorridorLine extends CorridorLine {
  selected: boolean
  /** The effort a selected course of action runs down this corridor, if any. */
  effort: 'main' | 'supporting' | null
}
export function useCorridorEntities({
  viewer,
  lines,
  selectedCorridorId,
  courseEmphasis,
}: {
  viewer: Cesium.Viewer | undefined
  lines: CorridorLine[]
  selectedCorridorId: string | null
  /** Corridors the course on screen rides on. Emphasis is display over the
   *  engine result: the corridors themselves are unchanged. */
  courseEmphasis?: Map<string, 'main' | 'supporting'>
}) {
  const entityMapRef = useRef(new Map<string, { item: StyledCorridorLine; entity: Cesium.Entity }>())

  useEffect(() => {
    if (!viewer) return
    // Selecting a corridor changes its emphasis without changing the underlying
    // engine result; clone those items so entitySync rebuilds just that overlay.
    const styled = lines.map((line) => ({
      ...line,
      selected: line.corridorId === selectedCorridorId,
      effort: courseEmphasis?.get(line.corridorId) ?? null,
    }))
    syncEntities(viewer, styled, entityMapRef, (line) => {
      const color = Cesium.Color.fromCssColorString(line.color)
      const choke = line.kind === 'choke'
      const main = line.effort === 'main'
      // A course on screen puts everything it does not use into the background,
      // so the assessment reads at a glance without hiding the ground.
      const faded = line.effort === null && (courseEmphasis?.size ?? 0) > 0
      const alpha = faded ? 0.22 : line.selected || main ? 0.95 : 0.72
      return {
        polyline: {
          positions: line.points.map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat)),
          width: choke
            ? line.selected || main
              ? 11
              : 9
            : main
              ? 7
              : line.effort === 'supporting' || line.selected
                ? 5
                : 3,
          material: choke
            ? new Cesium.PolylineGlowMaterialProperty({
                color: color.withAlpha(faded ? 0.3 : 1),
                glowPower: 0.3,
                taperPower: 0.7,
              })
            : line.effort === 'supporting'
              ? new Cesium.PolylineDashMaterialProperty({ color: color.withAlpha(alpha), dashLength: 20 })
              : color.withAlpha(alpha),
          clampToGround: true,
          classificationType: Cesium.ClassificationType.BOTH,
          zIndex: choke ? 20 : line.selected ? 10 : 1,
        },
        properties: { corridorId: line.corridorId, kind: line.kind },
      }
    })
  }, [viewer, lines, selectedCorridorId, courseEmphasis])

  useEffect(() => {
    const entityMap = entityMapRef.current
    return () => {
      if (!viewer) return
      for (const { entity } of entityMap.values()) viewer.entities.remove(entity)
      entityMap.clear()
    }
  }, [viewer])
}
