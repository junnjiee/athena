import { Viewer } from 'resium'
import type * as Cesium from 'cesium'
import { worldTerrain } from '../../lib/cesium-setup'
import { RectangleSelectionController } from './RectangleSelectionController'
import { ViewerBridge } from './ViewerBridge'
import type { SelectionResult } from '../../types/selection'

interface Props {
  armed: boolean
  resetToken: number
  onSelectionFinalize: (result: SelectionResult) => void
  onViewerReady: (viewer: Cesium.Viewer) => void
}

// Cesium's default widgets (geocoder, home button, scene-mode picker) are replaced by
// our own chrome (TopHeader, MapControls) to match the reference design, so all are
// disabled here.
export function CesiumGlobe({ armed, resetToken, onSelectionFinalize, onViewerReady }: Props) {
  return (
    <Viewer
      full
      terrain={worldTerrain}
      timeline={false}
      animation={false}
      vrButton={false}
      sceneModePicker={false}
      navigationHelpButton={false}
      fullscreenButton={false}
      baseLayerPicker={false}
      geocoder={false}
      homeButton={false}
      infoBox={false}
      selectionIndicator={false}
    >
      <ViewerBridge onViewerReady={onViewerReady} />
      <RectangleSelectionController
        armed={armed}
        resetToken={resetToken}
        onSelectionFinalize={onSelectionFinalize}
      />
    </Viewer>
  )
}
