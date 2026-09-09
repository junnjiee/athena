import { useEffect, useRef } from 'react'
import * as Cesium from 'cesium'
import type { BBoxDeg } from '../types/terrain'

/** Draws the operational area's edge on the ground.
 *
 *  A ground-clamped polyline rather than a `rectangle` with `outline: true` --
 *  rectangle outlines are drawn at a fixed height and float above or sink into
 *  anything but flat terrain, which is exactly the wrong behaviour for the one
 *  line telling the operator where the study stops. RHUMB keeps the four edges
 *  running true north/east so the box matches the bbox it came from.
 *
 *  Black, with a pale casing so it stays readable over dark ground and bright
 *  imagery alike. */
export function useAreaBoundsEntity({
  viewer,
  bbox,
}: {
  viewer: Cesium.Viewer | undefined
  bbox: BBoxDeg | null
}) {
  const entityRef = useRef<Cesium.Entity | null>(null)

  useEffect(() => {
    if (!viewer) return

    if (entityRef.current) {
      viewer.entities.remove(entityRef.current)
      entityRef.current = null
    }
    if (!bbox) return

    const { west, south, east, north } = bbox
    entityRef.current = viewer.entities.add({
      polyline: {
        positions: Cesium.Cartesian3.fromDegreesArray([
          west, south,
          east, south,
          east, north,
          west, north,
          west, south,
        ]),
        width: 4,
        clampToGround: true,
        arcType: Cesium.ArcType.RHUMB,
        material: new Cesium.PolylineOutlineMaterialProperty({
          color: Cesium.Color.BLACK,
          outlineColor: Cesium.Color.WHITE.withAlpha(0.45),
          outlineWidth: 2,
        }),
      },
    })

    return () => {
      if (entityRef.current) {
        viewer.entities.remove(entityRef.current)
        entityRef.current = null
      }
    }
  }, [viewer, bbox])
}
