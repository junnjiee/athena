import { useCallback, useRef, useState } from 'react'
import type * as Cesium from 'cesium'

export function useMapControls() {
  const viewerRef = useRef<Cesium.Viewer | undefined>(undefined)
  const [is3D, setIs3D] = useState(true)
  const [satelliteVisible, setSatelliteVisible] = useState(true)

  const handleViewerReady = useCallback((viewer: Cesium.Viewer) => {
    viewerRef.current = viewer
  }, [])

  const zoomIn = useCallback(() => {
    const viewer = viewerRef.current
    if (!viewer) return
    viewer.camera.zoomIn(viewer.camera.positionCartographic.height * 0.4)
  }, [])

  const zoomOut = useCallback(() => {
    const viewer = viewerRef.current
    if (!viewer) return
    viewer.camera.zoomOut(viewer.camera.positionCartographic.height * 0.4)
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

  return {
    handleViewerReady,
    zoomIn,
    zoomOut,
    resetNorth,
    toggleSceneMode,
    toggleSatellite,
    is3D,
    satelliteVisible,
  }
}
