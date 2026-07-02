import { useEffect, useRef } from 'react'
import * as Cesium from 'cesium'
import { clampCorner, computeRectangleStats, flyToSelectionPreview } from '../lib/selectionGeometry'
import type { SelectionResult } from '../types/selection'

interface Args {
  viewer: Cesium.Viewer | undefined
  armed: boolean
  resetToken: number
  onSelectionFinalize: (result: SelectionResult) => void
}

export function useRectangleSelection({ viewer, armed, resetToken, onSelectionFinalize }: Args) {
  const rectangleRef = useRef<Cesium.Rectangle | null>(null)
  const startCartographicRef = useRef<Cesium.Cartographic | null>(null)
  const isDraggingRef = useRef(false)
  const entityRef = useRef<Cesium.Entity | null>(null)
  const onSelectionFinalizeRef = useRef(onSelectionFinalize)
  useEffect(() => {
    onSelectionFinalizeRef.current = onSelectionFinalize
  }, [onSelectionFinalize])

  // Cesium's Viewer is an imperative escape-hatch object, not React-managed state --
  // mirroring it into a ref lets us toggle its camera-controller flags through the ref
  // (React's sanctioned mutable-escape-hatch pattern) instead of assigning directly to
  // the hook-provided `viewer` value.
  const viewerRef = useRef<Cesium.Viewer | undefined>(undefined)
  useEffect(() => {
    viewerRef.current = viewer
  }, [viewer])

  function ensureEntity(v: Cesium.Viewer) {
    if (entityRef.current) return entityRef.current
    entityRef.current = v.entities.add({
      rectangle: {
        coordinates: new Cesium.CallbackProperty(() => rectangleRef.current, false),
        material: Cesium.Color.fromCssColorString('#4b8cf0').withAlpha(0.25), // mirrors --friendly
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString('#4b8cf0'),
        outlineWidth: 2,
        classificationType: Cesium.ClassificationType.TERRAIN, // drapes over terrain, no heightReference needed
      },
    })
    return entityRef.current
  }

  function pickCartographic(v: Cesium.Viewer, windowPosition: Cesium.Cartesian2) {
    const cartesian = v.camera.pickEllipsoid(windowPosition, v.scene.globe.ellipsoid)
    if (!cartesian) return undefined
    return Cesium.Cartographic.fromCartesian(cartesian, v.scene.globe.ellipsoid)
  }

  useEffect(() => {
    if (!viewer) return

    // viewerRef is our own ref mirroring Cesium's imperative Viewer; toggling controller
    // flags through it is the sanctioned mutable-escape-hatch pattern, not React state.
    /* eslint-disable react-hooks/immutability */
    const controller = viewerRef.current?.scene.screenSpaceCameraController
    if (controller) {
      controller.enableRotate = !armed
      controller.enableTranslate = !armed
    }
    /* eslint-enable react-hooks/immutability */

    if (!armed) return

    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)

    handler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      const carto = pickCartographic(viewer, movement.position)
      if (!carto) return
      startCartographicRef.current = carto
      isDraggingRef.current = true
      rectangleRef.current = Cesium.Rectangle.fromCartographicArray([carto, carto])
      ensureEntity(viewer)
    }, Cesium.ScreenSpaceEventType.LEFT_DOWN)

    handler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
      if (!isDraggingRef.current || !startCartographicRef.current) return
      const carto = pickCartographic(viewer, movement.endPosition)
      if (!carto) return
      const clamped = clampCorner(startCartographicRef.current, carto)
      rectangleRef.current = Cesium.Rectangle.fromCartographicArray([startCartographicRef.current, clamped])
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE)

    handler.setInputAction(() => {
      if (!isDraggingRef.current || !rectangleRef.current) return
      isDraggingRef.current = false
      const finalRectangle = rectangleRef.current
      flyToSelectionPreview(viewer, finalRectangle)
      onSelectionFinalizeRef.current({ rectangle: finalRectangle, stats: computeRectangleStats(finalRectangle) })
    }, Cesium.ScreenSpaceEventType.LEFT_UP)

    return () => {
      handler.destroy()
      isDraggingRef.current = false
      startCartographicRef.current = null
      const cleanupController = viewerRef.current?.scene.screenSpaceCameraController
      if (cleanupController) {
        cleanupController.enableRotate = true
        cleanupController.enableTranslate = true
      }
    }
  }, [viewer, armed])

  useEffect(() => {
    if (!viewer || resetToken === 0) return
    if (entityRef.current) {
      viewer.entities.remove(entityRef.current)
      entityRef.current = null
    }
    rectangleRef.current = null
  }, [viewer, resetToken])
}
