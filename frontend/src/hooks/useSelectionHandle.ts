import { useEffect, useRef } from 'react'
import * as Cesium from 'cesium'
import { markerWorldPosition } from '../lib/pickTerrain'
import { handleWorldPosition } from '../lib/unitHandle'
import { ACCENT_HEX } from '../lib/colors'
import type { PlacedUnit } from '../types/entities'

interface Args {
  viewer: Cesium.Viewer | undefined
  units: PlacedUnit[]
  selectedUnitId: string | null
}

/** Rotate-handle affordance shown only for the currently selected unit -- a
 *  small dot at the shape's current facing direction, connected to its center
 *  by a thin dashed line, using the exact same position math as the
 *  interaction hit-test (useUnitEditing.ts's handleWorldPosition) so what's
 *  drawn and what's clickable never disagree. Rebuilt (not CallbackProperty-
 *  driven) whenever the selection or the selected unit's data changes -- moves
 *  and rotations already trigger a full React state update on every drag
 *  step, so this stays in sync for free. */
export function useSelectionHandle({ viewer, units, selectedUnitId }: Args) {
  const entitiesRef = useRef<Cesium.Entity[]>([])

  useEffect(() => {
    if (!viewer) return

    for (const entity of entitiesRef.current) viewer.entities.remove(entity)
    entitiesRef.current = []

    const unit = selectedUnitId ? units.find((u) => u.id === selectedUnitId) : undefined
    if (!unit) return

    const center = markerWorldPosition(unit.position)
    const handlePos = handleWorldPosition(unit)
    const color = Cesium.Color.fromCssColorString(ACCENT_HEX)

    entitiesRef.current = [
      viewer.entities.add({
        polyline: {
          positions: [center, handlePos],
          clampToGround: true,
          width: 1.5,
          material: new Cesium.PolylineDashMaterialProperty({ color, dashLength: 6 }),
        },
      }),
      viewer.entities.add({
        position: handlePos,
        point: {
          pixelSize: 10,
          color,
          outlineColor: Cesium.Color.fromCssColorString('#10151c'),
          outlineWidth: 1.5,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      }),
    ]
  }, [viewer, units, selectedUnitId])

  useEffect(() => {
    return () => {
      if (!viewer) return
      for (const entity of entitiesRef.current) viewer.entities.remove(entity)
      entitiesRef.current = []
    }
  }, [viewer])
}
