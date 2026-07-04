import { useCallback, useRef, useState } from 'react'
import * as Cesium from 'cesium'
import { computeMaximumZoomDistance } from '../lib/selectionGeometry'
import type { LonLat } from '../types/entities'

export function useMapControls() {
  const viewerRef = useRef<Cesium.Viewer | undefined>(undefined)
  const [is3D, setIs3D] = useState(true)
  const [satelliteVisible, setSatelliteVisible] = useState(true)
  const maxZoomDistanceRef = useRef<number | null>(null)

  const handleViewerReady = useCallback((viewer: Cesium.Viewer) => {
    viewerRef.current = viewer
  }, [])

  const getViewer = useCallback(() => viewerRef.current, [])

  const zoomIn = useCallback(() => {
    const viewer = viewerRef.current
    if (!viewer) return
    viewer.camera.zoomIn(viewer.camera.positionCartographic.height * 0.4)
  }, [])

  // Camera.prototype.zoomOut moves the camera directly and never consults
  // screenSpaceCameraController.maximumZoomDistance (confirmed against installed
  // cesium@1.143.0 -- zoom3D() just calls camera.move()), so the cap has to be
  // enforced here at the call site too, not just set on the controller.
  const zoomOut = useCallback(() => {
    const viewer = viewerRef.current
    if (!viewer) return
    const currentHeight = viewer.camera.positionCartographic.height
    const proposedAmount = currentHeight * 0.4
    const cap = maxZoomDistanceRef.current
    const amount = cap != null ? Math.max(0, Math.min(proposedAmount, cap - currentHeight)) : proposedAmount
    viewer.camera.zoomOut(amount)
  }, [])

  const setSelectionZoomCap = useCallback((rectangle: Cesium.Rectangle) => {
    const distance = computeMaximumZoomDistance(rectangle)
    maxZoomDistanceRef.current = distance
    const viewer = viewerRef.current
    if (viewer) viewer.scene.screenSpaceCameraController.maximumZoomDistance = distance
  }, [])

  const clearSelectionZoomCap = useCallback(() => {
    maxZoomDistanceRef.current = null
    const viewer = viewerRef.current
    if (viewer) viewer.scene.screenSpaceCameraController.maximumZoomDistance = Number.POSITIVE_INFINITY
  }, [])

  const resetNorth = useCallback(() => {
    const viewer = viewerRef.current
    if (!viewer) return
    viewer.camera.flyTo({
      destination: viewer.camera.position,
      orientation: { heading: 0, pitch: viewer.camera.pitch, roll: 0 },
      duration: 0.5,
    })
  }, [])

  const toggleSceneMode = useCallback(() => {
    const viewer = viewerRef.current
    if (!viewer) return
    if (is3D) {
      viewer.scene.morphTo2D(0.5)
    } else {
      viewer.scene.morphTo3D(0.5)
    }
    setIs3D((v) => !v)
  }, [is3D])

  const toggleSatellite = useCallback(() => {
    const viewer = viewerRef.current
    if (!viewer) return
    const layer = viewer.imageryLayers.get(0)
    if (!layer) return
    layer.show = !layer.show
    setSatelliteVisible(layer.show)
  }, [])

  const [elevationExaggerated, setElevationExaggerated] = useState(false)
  const headlampRemoveRef = useRef<(() => void) | null>(null)

  const toggleElevation = useCallback(() => {
    const viewer = viewerRef.current
    if (!viewer) return
    const next = !elevationExaggerated
    viewer.scene.globe.enableLighting = next

    // Cesium's default light tracks the real sun position for the current real-world
    // time, which can make the globe look unexpectedly dark (genuine night side) --
    // not what "make elevation more apparent" should mean. Use a "headlamp" light that
    // always shines from the camera's current view direction instead, so hillshading
    // is reliably visible no matter where/when the user is looking; restore the
    // default SunLight when toggled off.
    if (next) {
      headlampRemoveRef.current = viewer.scene.preRender.addEventListener(() => {
        viewer.scene.light = new Cesium.DirectionalLight({ direction: Cesium.Cartesian3.clone(viewer.camera.directionWC) })
      })
    } else {
      headlampRemoveRef.current?.()
      headlampRemoveRef.current = null
      viewer.scene.light = new Cesium.SunLight()
    }

    viewer.scene.verticalExaggeration = next ? 2.5 : 1.0
    setElevationExaggerated(next)
  }, [elevationExaggerated])

  const flyToPositions = useCallback((positions: LonLat[]) => {
    const viewer = viewerRef.current
    if (!viewer || positions.length === 0) return
    const cartesians = positions.map((p) => Cesium.Cartesian3.fromDegrees(p.longitude, p.latitude))
    const sphere =
      cartesians.length === 1
        ? new Cesium.BoundingSphere(cartesians[0], 400)
        : Cesium.BoundingSphere.fromPoints(cartesians)
    viewer.camera.flyToBoundingSphere(sphere, {
      duration: 1.5,
      offset: new Cesium.HeadingPitchRange(viewer.camera.heading, Cesium.Math.toRadians(-45), sphere.radius * 3),
    })
  }, [])

  return {
    handleViewerReady,
    getViewer,
    zoomIn,
    zoomOut,
    resetNorth,
    toggleSceneMode,
    toggleSatellite,
    toggleElevation,
    flyToPositions,
    setSelectionZoomCap,
    clearSelectionZoomCap,
    is3D,
    satelliteVisible,
    elevationExaggerated,
  }
}
