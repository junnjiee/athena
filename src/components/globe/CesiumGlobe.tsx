import { Viewer } from 'resium'
import { worldTerrain } from '../../lib/cesium-setup'
import { RectangleSelectionController } from './RectangleSelectionController'
import type { SelectionResult } from '../../types/selection'

interface Props {
  armed: boolean
  resetToken: number
  onSelectionFinalize: (result: SelectionResult) => void
}

export function CesiumGlobe({ armed, resetToken, onSelectionFinalize }: Props) {
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
      geocoder={true}
      homeButton={true}
      infoBox={false}
      selectionIndicator={false}
    >
      <RectangleSelectionController
        armed={armed}
        resetToken={resetToken}
        onSelectionFinalize={onSelectionFinalize}
      />
    </Viewer>
  )
}
