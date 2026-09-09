import { Viewer, useCesium } from 'resium'
import type * as Cesium from 'cesium'
import { worldTerrain } from '../../lib/cesium-setup'
import { ACCENT_HEX } from '../../lib/colors'
import { OPERATIONAL_MAX_SELECTION_EXTENT_METERS } from '../../lib/selectionGeometry'
import { usePlacementTool } from '../../hooks/usePlacementTool'
import { useAreaBoundsEntity } from '../../hooks/useAreaBoundsEntity'
import { useStudyMarkEntities } from '../../hooks/useStudyMarkEntities'
import { useCorridorEntities } from '../../hooks/useCorridorEntities'
import { useOrbatEntities } from '../../hooks/useOrbatEntities'
import { useBlockLinkEntities } from '../../hooks/useBlockLinkEntities'
import { useRoadNetworkEntities } from '../../hooks/useRoadNetworkEntities'
import { RectangleSelectionController } from './RectangleSelectionController'
import { ViewerBridge } from './ViewerBridge'
import type { CorridorLine } from '../../lib/routeStudy'
import type { LonLat } from '../../types/entities'
import type { SelectionResult } from '../../types/selection'
import type { BBoxDeg } from '../../types/terrain'
import type {
  BlockPlan,
  OperationalToolMode,
  OrbatUnit,
  RoadGraph,
  StudyMarks,
} from '../../types/routeStudy'

type PlaceMode = 'place-reserve' | 'place-orbat-unit'

/** Largest objective a single drag may designate. Objectives are ground inside
 *  the study, not another study. */
const OBJECTIVE_MAX_EXTENT_METERS = 15_000

interface Props {
  toolMode: OperationalToolMode
  resetToken: number
  /** Bounds of the area under study, drawn so its edge is never in doubt. */
  areaBbox: BBoxDeg | null
  marks: StudyMarks
  lines: CorridorLine[]
  selectedCorridorId: string | null
  /** Corridors the selected course of action rides on, and how hard. */
  courseEmphasis: Map<string, 'main' | 'supporting'>
  orbatUnits: OrbatUnit[]
  selectedUnitId: string | null
  blockPlan: BlockPlan | null
  graph: RoadGraph | null
  onSelectionFinalize: (selection: SelectionResult) => void
  onObjectiveAreaFinalize: (selection: SelectionResult) => void
  onViewerReady: (viewer: Cesium.Viewer) => void
  onPlace: (mode: PlaceMode, position: LonLat) => void
}
const hiddenCredits = document.createElement('div')

function isPlaceMode(mode: OperationalToolMode): mode is PlaceMode {
  return mode === 'place-reserve' || mode === 'place-orbat-unit'
}

function OperationalOverlayController({
  toolMode,
  areaBbox,
  marks,
  lines,
  selectedCorridorId,
  courseEmphasis,
  orbatUnits,
  selectedUnitId,
  blockPlan,
  graph,
  onPlace,
}: Pick<
  Props,
  | 'toolMode'
  | 'areaBbox'
  | 'marks'
  | 'lines'
  | 'selectedCorridorId'
  | 'courseEmphasis'
  | 'orbatUnits'
  | 'selectedUnitId'
  | 'blockPlan'
  | 'graph'
  | 'onPlace'
>) {
  const { viewer } = useCesium()
  const allocatedUnitIds = new Set((blockPlan?.allocation ?? []).map((entry) => entry.unit_id))

  // Under everything else: the detected network is context, not a finding.
  useRoadNetworkEntities({ viewer, graph })
  useAreaBoundsEntity({ viewer, bbox: areaBbox })
  useStudyMarkEntities({ viewer, marks })
  useCorridorEntities({ viewer, lines, selectedCorridorId, courseEmphasis })
  useOrbatEntities({ viewer, units: orbatUnits, selectedUnitId, allocatedUnitIds })
  useBlockLinkEntities({ viewer, plan: blockPlan, units: orbatUnits, graph })
  usePlacementTool({
    viewer,
    mode: toolMode,
    onPlace: (mode, position) => {
      if (isPlaceMode(mode)) onPlace(mode, position)
    },
    isPlaceableMode: isPlaceMode,
    prioritizeExisting: false,
  })
  return null
}

export function OperationalGlobe({
  toolMode,
  resetToken,
  areaBbox,
  marks,
  lines,
  selectedCorridorId,
  courseEmphasis,
  orbatUnits,
  selectedUnitId,
  blockPlan,
  graph,
  onSelectionFinalize,
  onObjectiveAreaFinalize,
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
      <RectangleSelectionController
        armed={toolMode === 'draw-objective-area'}
        resetToken={resetToken}
        maxExtentMeters={OBJECTIVE_MAX_EXTENT_METERS}
        colorHex={ACCENT_HEX}
        frameOnFinalize={false}
        onSelectionFinalize={onObjectiveAreaFinalize}
      />
      <OperationalOverlayController
        toolMode={toolMode}
        areaBbox={areaBbox}
        marks={marks}
        lines={lines}
        selectedCorridorId={selectedCorridorId}
        courseEmphasis={courseEmphasis}
        orbatUnits={orbatUnits}
        selectedUnitId={selectedUnitId}
        blockPlan={blockPlan}
        graph={graph}
        onPlace={onPlace}
      />
    </Viewer>
  )
}
