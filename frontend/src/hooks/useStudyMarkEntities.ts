import { useEffect, useMemo, useRef } from 'react'
import * as Cesium from 'cesium'
import { syncEntityGroups } from '../lib/entitySync'
import { objectiveStarIcon, reserveMarkerIcon } from '../lib/markerIcons'
import { ACCENT_HEX, ASSESSED_HEX, HOSTILE_HEX } from '../lib/colors'
import type { StudyMark, StudyMarks } from '../types/routeStudy'

interface DisplayMark extends StudyMark {
  id: string
  kind: 'reserve' | 'objective'
}

/** How long a freshly dropped mark stays oversized before settling. */
const PULSE_MS = 900

export function useStudyMarkEntities({
  viewer,
  marks,
}: {
  viewer: Cesium.Viewer | undefined
  marks: StudyMarks
}) {
  const entityMapRef = useRef(new Map<string, { item: DisplayMark; entities: Cesium.Entity[] }>())
  // When each mark first appeared, so the drop animation runs once per mark
  // rather than restarting every time a rename rebuilds its entity.
  const pulseStartRef = useRef(new Map<string, number>())
  const displayMarks = useMemo<DisplayMark[]>(
    () => [
      ...marks.reserves.map((mark) => ({ ...mark, id: `study-reserve:${mark.id}`, kind: 'reserve' as const })),
      ...marks.objectives.map((mark) => ({ ...mark, id: `study-objective:${mark.id}`, kind: 'objective' as const })),
    ],
    [marks],
  )

  useEffect(() => {
    if (!viewer) return

    const live = new Set(displayMarks.map((mark) => mark.id))
    for (const id of pulseStartRef.current.keys()) {
      if (!live.has(id)) pulseStartRef.current.delete(id)
    }

    syncEntityGroups(viewer, displayMarks, entityMapRef, (mark) => {
      const reserve = mark.kind === 'reserve'
      const reserveColor = mark.intelligence_status === 'confirmed' ? HOSTILE_HEX : ASSESSED_HEX
      const color = Cesium.Color.fromCssColorString(reserve ? reserveColor : ACCENT_HEX)

      let placedAt = pulseStartRef.current.get(mark.id)
      if (placedAt === undefined) {
        placedAt = Date.now()
        pulseStartRef.current.set(mark.id, placedAt)
      }
      const start = placedAt
      // A mark dropped at operational zoom is a 30 px icon on 50 km of ground.
      // Landing it at two and a half times size and settling over ~1 s is what
      // makes the click legibly land somewhere, rather than appearing to do
      // nothing at all.
      const scale = new Cesium.CallbackProperty(() => {
        const t = (Date.now() - start) / PULSE_MS
        return t >= 1 ? 1 : 1 + 1.5 * (1 - t) * (1 - t)
      }, false)

      const marker: Cesium.Entity.ConstructorOptions = {
        position: Cesium.Cartesian3.fromDegrees(mark.lon, mark.lat),
        billboard: {
          image: reserve ? reserveMarkerIcon(reserveColor) : objectiveStarIcon(ACCENT_HEX),
          width: reserve ? 30 : 28,
          height: reserve ? 30 : 28,
          scale,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: {
          text: reserve && mark.level ? `${mark.level} · ${mark.name}` : mark.name,
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

      // An objective drawn as ground keeps its footprint; the star stays as the
      // label anchor so the two read as one mark.
      if (!mark.bbox) return [marker]
      return [
        marker,
        {
          rectangle: {
            coordinates: Cesium.Rectangle.fromDegrees(
              mark.bbox.west,
              mark.bbox.south,
              mark.bbox.east,
              mark.bbox.north,
            ),
            material: color.withAlpha(0.18),
            outline: true,
            outlineColor: color,
            outlineWidth: 2,
            classificationType: Cesium.ClassificationType.TERRAIN,
          },
        },
      ]
    })
  }, [viewer, displayMarks])

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
