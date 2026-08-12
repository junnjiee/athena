import { useEffect, useRef } from 'react'
import { useCesium } from 'resium'
import type * as Cesium from 'cesium'

interface Props {
  onViewerReady: (viewer: Cesium.Viewer) => void
}

/** Invisible child of <Viewer> that hands the live Cesium.Viewer instance up to the
 *  page via a callback, so page-level chrome (zoom, compass, layer toggles) outside
 *  the <Viewer> tree can drive it imperatively. Must be rendered as a child of
 *  <Viewer> -- see RectangleSelectionController for why (useCesium()'s context
 *  provider is rendered by <Viewer> around its children, not accessible from a
 *  component that itself renders <Viewer>). */
export function ViewerBridge({ onViewerReady }: Props) {
  const { viewer } = useCesium()
  // Callers pass an inline `onViewerReady` (its "apply once, at mount" doc
  // comments assume exactly that), so it gets a fresh reference on every
  // render. A `[viewer, onViewerReady]` dependency array would re-fire the
  // callback on every one of the page's re-renders, not once -- for camera-
  // moving callers that's not idempotent: each re-render cancels the
  // previous flyTo animation mid-flight and restarts it, so the camera
  // never actually reaches its destination. Fire at most once per distinct
  // viewer instance instead, independent of how often this re-renders.
  const firedForRef = useRef<Cesium.Viewer | null>(null)

  useEffect(() => {
    if (!viewer || firedForRef.current === viewer) return
    firedForRef.current = viewer
    // Dev-only handle for console debugging / E2E drivers; stripped in prod builds.
    if (import.meta.env.DEV) {
      ;(window as unknown as Record<string, unknown>).__athenaViewer = viewer
    }
    onViewerReady(viewer)
  })

  return null
}
