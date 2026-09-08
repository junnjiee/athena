import { useEffect, useMemo, useRef } from 'react'
import * as Cesium from 'cesium'
import { syncEntities } from '../lib/entitySync'
import { objectiveStarIcon, reserveMarkerIcon } from '../lib/markerIcons'
import { ACCENT_HEX, HOSTILE_HEX } from '../lib/colors'
import type { StudyMark, StudyMarks } from '../types/routeStudy'

interface DisplayMark extends StudyMark {
  id: string
  kind: 'reserve' | 'objective'
}
export function useStudyMarkEntities({
  viewer,
  marks,
}: {
  viewer: Cesium.Viewer | undefined
  marks: StudyMarks
}) {
  const entityMapRef = useRef(new Map<string, { item: DisplayMark; entity: Cesium.Entity }>())
  const displayMarks = useMemo<DisplayMark[]>(
    () => [
      ...marks.reserves.map((mark) => ({ ...mark, id: `study-reserve:${mark.id}`, kind: 'reserve' as const })),
      ...marks.objectives.map((mark) => ({ ...mark, id: `study-objective:${mark.id}`, kind: 'objective' as const })),
    ],
    [marks],
  )

  useEffect(() => {
    if (!viewer) return
    syncEntities(viewer, displayMarks, entityMapRef, (mark) => {
      const reserve = mark.kind === 'reserve'
      const color = Cesium.Color.fromCssColorString(reserve ? HOSTILE_HEX : ACCENT_HEX)
      return {
        position: Cesium.Cartesian3.fromDegrees(mark.lon, mark.lat),
        billboard: {
          image: reserve ? reserveMarkerIcon(HOSTILE_HEX) : objectiveStarIcon(ACCENT_HEX),
          width: reserve ? 30 : 28,
          height: reserve ? 30 : 28,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: mark.name,
          font: '600 12px system-ui, sans-serif',
          fillColor: color,
          showBackground: true,
          backgroundColor: Cesium.Color.fromCssColorString('#10151c').withAlpha(0.85),
          backgroundPadding: new Cesium.Cartesian2(6, 3),
          pixelOffset: new Cesium.Cartesian2(19, 0),
          horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      }
    })
  }, [viewer, displayMarks])

  useEffect(() => {
    const entityMap = entityMapRef.current
    return () => {
      if (!viewer) return
      for (const { entity } of entityMap.values()) viewer.entities.remove(entity)
      entityMap.clear()
    }
  }, [viewer])
}
