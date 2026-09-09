import { useEffect, useRef } from 'react'
import * as Cesium from 'cesium'
import { clampCorner, computeRectangleStats, flyToSelectionPreview } from '../lib/selectionGeometry'
import type { SelectionResult } from '../types/selection'

interface Args {
  viewer: Cesium.Viewer | undefined
  armed: boolean
  resetToken: number
  maxExtentMeters?: number
  /** Drag colour, so a box that means "objective" cannot be mistaken for a box
   *  that means "ingest this ground". */
  colorHex?: string
  /** Ground selection reframes the camera on what was just chosen. Drawing an
   *  objective inside ground already framed must not move the camera — the
   *  operator is mid-sequence and about to draw another. */
  frameOnFinalize?: boolean
  onSelectionFinalize: (result: SelectionResult) => void
}

export function useRectangleSelection({
  viewer,
  armed,
  resetToken,
  maxExtentMeters,
  colorHex = '#4b8cf0', // mirrors --friendly
  frameOnFinalize = true,
  onSelectionFinalize,
}: Args) {
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

  function ensureEntity(v: Cesium.Viewer, hex: string) {
    if (entityRef.current) return entityRef.current
    const color = Cesium.Color.fromCssColorString(hex)
    entityRef.current = v.entities.add({
      rectangle: {
        coordinates: new Cesium.CallbackProperty(() => rectangleRef.current, false),
        material: color.withAlpha(0.25),
        outline: true,
        outlineColor: color,
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
    if (!viewer || !armed) return

    // Only an armed selector touches the camera flags. More than one of these
    // hooks runs at a time (ground selection and objective drawing are separate
    // instances), so an unarmed one writing `true` here would hand the camera
    // back mid-drag of whichever one is actually armed.
    //
    // viewerRef is our own ref mirroring Cesium's imperative Viewer; toggling controller
    // flags through it is the sanctioned mutable-escape-hatch pattern, not React state.
    /* eslint-disable react-hooks/immutability */
    const controller = viewerRef.current?.scene.screenSpaceCameraController
    if (controller) {
      controller.enableRotate = false
      controller.enableTranslate = false
    }
    /* eslint-enable react-hooks/immutability */

    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas)

    handler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      const carto = pickCartographic(viewer, movement.position)
      if (!carto) return
      startCartographicRef.current = carto
      isDraggingRef.current = true
      rectangleRef.current = Cesium.Rectangle.fromCartographicArray([carto, carto])
      ensureEntity(viewer, colorHex)
    }, Cesium.ScreenSpaceEventType.LEFT_DOWN)

    handler.setInputAction((movement: Cesium.ScreenSpaceEventHandler.MotionEvent) => {
      if (!isDraggingRef.current || !startCartographicRef.current) return
      const carto = pickCartographic(viewer, movement.endPosition)
      if (!carto) return
      const clamped = clampCorner(startCartographicRef.current, carto, maxExtentMeters)
      rectangleRef.current = Cesium.Rectangle.fromCartographicArray([startCartographicRef.current, clamped])
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE)

    handler.setInputAction(() => {
      if (!isDraggingRef.current || !rectangleRef.current) return
      isDraggingRef.current = false
      const finalRectangle = rectangleRef.current
      if (frameOnFinalize) flyToSelectionPreview(viewer, finalRectangle)
      // The drag-preview box has done its job once finalized -- remove it rather than
      // leaving it draped over the terrain through classification/planning. The globe
      // clipping applied on finalize already shows the selection bounds from here on.
      if (entityRef.current) {
        viewer.entities.remove(entityRef.current)
        entityRef.current = null
      }
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
  }, [viewer, armed, maxExtentMeters, colorHex, frameOnFinalize])

  useEffect(() => {
    if (!viewer || resetToken === 0) return
    if (entityRef.current) {
      viewer.entities.remove(entityRef.current)
      entityRef.current = null
    }
    rectangleRef.current = null
  }, [viewer, resetToken])
}
