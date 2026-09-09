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

  // Straight down. The planning surface reads as a map, and every tilt is a
  // deliberate departure from that rather than wherever the camera drifted to.
  const [pitchDegrees, setPitchDegrees] = useState(-90)

  /** Orbits the camera around the ground at screen centre.
   *
   *  Not `setView` with a new pitch: that pivots the camera where it stands, so
   *  from straight down the ground swings out of frame entirely. Orbiting the
   *  point already being looked at is what makes this read as leaning over the
   *  map rather than turning away from it.
   *
   *  Cesium's true 2D mode is orthographic and cannot tilt at all, which is why
   *  the surface stays in the 3D scene and simply looks straight down instead. */
  const tilt = useCallback((deltaDegrees: number) => {
    const viewer = viewerRef.current
    if (!viewer) return
    const { camera, scene } = viewer

    const canvas = scene.canvas
    const screenCenter = new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2)
    const centered = camera.pickEllipsoid(screenCenter, scene.globe.ellipsoid)
    if (!centered) return

    setPitchDegrees((current) => {
      const next = Math.min(-5, Math.max(-90, current + deltaDegrees))
      const range = Cesium.Cartesian3.distance(camera.positionWC, centered)
      camera.lookAt(
        centered,
        new Cesium.HeadingPitchRange(camera.heading, Cesium.Math.toRadians(next), range),
      )
      // Release the reference frame, or every later pan orbits this point
      // instead of moving over the ground.
      camera.lookAtTransform(Cesium.Matrix4.IDENTITY)
      return next
    })
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
    const { scene, camera } = viewer

    // Cesium's morph does NOT preserve framing -- morphTo2D in particular parks the
    // camera at a whole-Earth altitude, so the battlefield vanishes and clicks land
    // on the far side of the planet. Capture what the camera is centered on now and
    // re-center there once the morph completes, keeping the AO in view (and drawable)
    // across the toggle.
    const canvas = scene.canvas
    const screenCenter = new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2)
    const centered = camera.pickEllipsoid(screenCenter, scene.globe.ellipsoid)
    const centerCarto = centered
      ? Cesium.Cartographic.fromCartesian(centered)
      : camera.positionCartographic.clone()
    const height = camera.positionCartographic.height

    const removeListener = scene.morphComplete.addEventListener(() => {
      removeListener()
      camera.setView({
        destination: Cesium.Cartesian3.fromRadians(centerCarto.longitude, centerCarto.latitude, height),
        orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
      })
    })

    if (is3D) {
      scene.morphTo2D(0.5)
    } else {
      scene.morphTo3D(0.5)
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
    tilt,
    pitchDegrees,
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
