import { useEffect } from 'react'
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

  useEffect(() => {
    if (viewer) onViewerReady(viewer)
  }, [viewer, onViewerReady])

  return null
}
