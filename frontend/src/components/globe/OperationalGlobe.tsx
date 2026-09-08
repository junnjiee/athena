import { Viewer, useCesium } from 'resium'
import type * as Cesium from 'cesium'
import { worldTerrain } from '../../lib/cesium-setup'
import { OPERATIONAL_MAX_SELECTION_EXTENT_METERS } from '../../lib/selectionGeometry'
import { usePlacementTool } from '../../hooks/usePlacementTool'
import { useStudyMarkEntities } from '../../hooks/useStudyMarkEntities'
import { useCorridorEntities } from '../../hooks/useCorridorEntities'
import { RectangleSelectionController } from './RectangleSelectionController'
import { ViewerBridge } from './ViewerBridge'
import type { CorridorLine } from '../../lib/routeStudy'
import type { LonLat } from '../../types/entities'
import type { SelectionResult } from '../../types/selection'
import type { OperationalToolMode, StudyMarks } from '../../types/routeStudy'

interface Props {
  toolMode: OperationalToolMode
  resetToken: number
  marks: StudyMarks
  lines: CorridorLine[]
  selectedCorridorId: string | null
  onSelectionFinalize: (selection: SelectionResult) => void
  onViewerReady: (viewer: Cesium.Viewer) => void
  onPlace: (mode: 'place-reserve' | 'place-study-objective', position: LonLat) => void
}
const hiddenCredits = document.createElement('div')

function OperationalOverlayController({
  toolMode,
  marks,
  lines,
  selectedCorridorId,
  onPlace,
}: Pick<Props, 'toolMode' | 'marks' | 'lines' | 'selectedCorridorId' | 'onPlace'>) {
  const { viewer } = useCesium()
  useStudyMarkEntities({ viewer, marks })
  useCorridorEntities({ viewer, lines, selectedCorridorId })
  usePlacementTool({
    viewer,
    mode: toolMode,
    onPlace: (mode, position) => {
      if (mode === 'place-reserve' || mode === 'place-study-objective') onPlace(mode, position)
    },
    isPlaceableMode: (mode) => mode === 'place-reserve' || mode === 'place-study-objective',
    prioritizeExisting: false,
  })
  return null
}

export function OperationalGlobe({
  toolMode,
  resetToken,
  marks,
  lines,
  selectedCorridorId,
  onSelectionFinalize,
  onViewerReady,
  onPlace,
}: Props) {
  return (
    <Viewer
      full
      terrain={worldTerrain}
      creditContainer={hiddenCredits}
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
        armed={toolMode === 'select-area'}
        resetToken={resetToken}
        maxExtentMeters={OPERATIONAL_MAX_SELECTION_EXTENT_METERS}
        onSelectionFinalize={onSelectionFinalize}
      />
      <OperationalOverlayController
        toolMode={toolMode}
        marks={marks}
        lines={lines}
        selectedCorridorId={selectedCorridorId}
        onPlace={onPlace}
      />
    </Viewer>
  )
}

