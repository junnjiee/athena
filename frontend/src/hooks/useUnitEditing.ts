import { useEffect, useRef } from 'react'
import * as Cesium from 'cesium'
import { markerWorldPosition, pickGroundPosition } from '../lib/pickTerrain'
import { handleWorldPosition } from '../lib/unitHandle'
import { bearingRadians } from '../lib/bearing'
import { findNearestUnit, findNearestObjective } from '../lib/nearestMarker3D'
import type { LonLat, PlacedObjective, PlacedUnit } from '../types/entities'

interface Args {
  viewer: Cesium.Viewer | undefined
  /** Only active in 'navigate' mode -- draw-route and the placement tools each
   *  already own left-click on this same canvas, so editing must stay out of
   *  their way. */
  active: boolean
  units: PlacedUnit[]
  objectives: PlacedObjective[]
  selectedUnitId: string | null
  onSelectUnit: (id: string | null) => void
  onMoveUnit: (id: string, position: LonLat) => void
  onMoveObjective: (id: string, position: LonLat) => void
  onRotateUnit: (id: string, rotationRadians: number) => void
}

const HANDLE_HIT_RADIUS_PX = 14
const CLICK_SLOP_PX = 5

type Drag =
  | { kind: 'unit'; id: string; pressed: Cesium.Cartesian2; moved: boolean }
  | { kind: 'objective'; id: string; pressed: Cesium.Cartesian2; moved: boolean }
  | { kind: 'rotate'; id: string; center: Cesium.Cartesian3 }

function cartesianToLonLat(viewer: Cesium.Viewer, cartesian: Cesium.Cartesian3): LonLat {
  const carto = Cesium.Cartographic.fromCartesian(cartesian, viewer.scene.globe.ellipsoid)
  return { longitude: Cesium.Math.toDegrees(carto.longitude), latitude: Cesium.Math.toDegrees(carto.latitude) }
}

/** Click-to-select, drag-to-move, and drag-the-handle-to-rotate for placed
 *  units/objectives on the 3D globe -- the 3D counterpart to TopoPlanOverlay's
 *  same three gestures on the 2D topo view. A plain click (released within
 *  CLICK_SLOP_PX of the press) selects; a real drag repositions. Camera
 *  rotate/translate are suspended only while an actual drag is in flight
 *  (mirroring useRectangleSelection.ts), so ordinary camera panning in
 *  'navigate' mode is otherwise untouched. */
export function useUnitEditing({
  viewer,
  active,
  units,
  objectives,
  selectedUnitId,
  onSelectUnit,
  onMoveUnit,
  onMoveObjective,
  onRotateUnit,
}: Args) {
  const unitsRef = useRef(units)
  const objectivesRef = useRef(objectives)
  const selectedUnitIdRef = useRef(selectedUnitId)
  const onSelectUnitRef = useRef(onSelectUnit)
  const onMoveUnitRef = useRef(onMoveUnit)
  const onMoveObjectiveRef = useRef(onMoveObjective)
  const onRotateUnitRef = useRef(onRotateUnit)
  const dragRef = useRef<Drag | null>(null)

  useEffect(() => {
    unitsRef.current = units
  }, [units])
  useEffect(() => {
    objectivesRef.current = objectives
  }, [objectives])
  useEffect(() => {
    selectedUnitIdRef.current = selectedUnitId
  }, [selectedUnitId])
  useEffect(() => {
    onSelectUnitRef.current = onSelectUnit
  }, [onSelectUnit])
  useEffect(() => {
    onMoveUnitRef.current = onMoveUnit
  }, [onMoveUnit])
  useEffect(() => {
    onMoveObjectiveRef.current = onMoveObjective
  }, [onMoveObjective])
  useEffect(() => {
    onRotateUnitRef.current = onRotateUnit
  }, [onRotateUnit])

  useEffect(() => {
    if (!viewer || !active) return

    const controller = viewer.scene.screenSpaceCameraController

    // Suspend zoom too, not just rotate/translate: a trackpad two-finger pinch
    // incidental to a click-and-drag gesture arrives as a synthetic wheel event
    // independent of the mouse button state, and would otherwise still reach
    // Cesium's camera controller mid-drag -- the likely cause of the reported
    // "sudden zoom out while moving elements".
    function setCameraEnabled(enabled: boolean) {
      controller.enableRotate = enabled
      controller.enableTranslate = enabled
      controller.enableZoom = enabled
    }

    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)

    handler.setInputAction((event: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      const selectedId = selectedUnitIdRef.current
      if (selectedId) {
        const selectedUnit = unitsRef.current.find((u) => u.id === selectedId)
        if (selectedUnit) {
          const screen = viewer.scene.cartesianToCanvasCoordinates(handleWorldPosition(selectedUnit))
          if (screen && Cesium.Cartesian2.distance(screen, event.position) <= HANDLE_HIT_RADIUS_PX) {
            dragRef.current = { kind: 'rotate', id: selectedUnit.id, center: markerWorldPosition(selectedUnit.position) }
            setCameraEnabled(false)
            return
          }
        }
      }

      const nearestUnit = findNearestUnit(viewer, event.position, unitsRef.current)
      if (nearestUnit) {
        dragRef.current = { kind: 'unit', id: nearestUnit.id, pressed: event.position, moved: false }
        setCameraEnabled(false)
        return
      }

      const nearestObjective = findNearestObjective(viewer, event.position, objectivesRef.current)
      if (nearestObjective) {
        dragRef.current = { kind: 'objective', id: nearestObjective.id, pressed: event.position, moved: false }
        setCameraEnabled(false)
        return
      }

      if (selectedId) onSelectUnitRef.current(null)
    }, Cesium.ScreenSpaceEventType.LEFT_DOWN)

    handler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
      const drag = dragRef.current
      if (!drag) return

      if (drag.kind === 'rotate') {
        const cartesian = pickGroundPosition(viewer, movement.endPosition)
        if (!cartesian) return
        const angle = bearingRadians(cartesianToLonLat(viewer, drag.center), cartesianToLonLat(viewer, cartesian))
        onRotateUnitRef.current(drag.id, angle)
        return
      }

      if (!drag.moved && Cesium.Cartesian2.distance(drag.pressed, movement.endPosition) > CLICK_SLOP_PX) {
        drag.moved = true
      }
      if (!drag.moved) return

      const cartesian = pickGroundPosition(viewer, movement.endPosition)
      if (!cartesian) return
      const lonLat = cartesianToLonLat(viewer, cartesian)
      if (drag.kind === 'unit') onMoveUnitRef.current(drag.id, lonLat)
      else onMoveObjectiveRef.current(drag.id, lonLat)
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE)

    handler.setInputAction(() => {
      const drag = dragRef.current
      dragRef.current = null
      setCameraEnabled(true)
      if (drag && drag.kind === 'unit' && !drag.moved) onSelectUnitRef.current(drag.id)
    }, Cesium.ScreenSpaceEventType.LEFT_UP)

    return () => {
      handler.destroy()
      setCameraEnabled(true)
      dragRef.current = null
    }
  }, [viewer, active])
}
