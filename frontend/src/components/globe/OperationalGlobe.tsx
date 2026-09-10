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
import { useRoadLabelEntities } from '../../hooks/useRoadLabelEntities'
import { useOperationalRoadDrawing } from '../../hooks/useOperationalRoadDrawing'
import { RectangleSelectionController } from './RectangleSelectionController'
import { ViewerBridge } from './ViewerBridge'
import type { CorridorLine } from '../../lib/routeStudy'
import type { S2Overlay } from '../../lib/overlays'
import type { LonLat } from '../../types/entities'
import type { SelectionResult } from '../../types/selection'
import type { BBoxDeg } from '../../types/terrain'
import type {
  BlockPlan,
  OperationalToolMode,
  OrbatUnit,
  RoadGraph,
  RoadEdit,
  StudyMarks,
} from '../../types/routeStudy'

type PlaceMode = 'place-reserve' | 'place-orbat-unit' | 'place-block-point'

/** Largest objective a single drag may designate. Objectives are ground inside
 *  the study, not another study. */
const OBJECTIVE_MAX_EXTENT_METERS = 15_000

interface Props {
  toolMode: OperationalToolMode
  resetToken: number
  /** Bounds of the area under study, drawn so its edge is never in doubt. */
  areaBbox: BBoxDeg | null
  marks: StudyMarks
  /** Which S2 overlay reserve colours read as; see DOCTRINE.md §3. */
  overlay: S2Overlay
  lines: CorridorLine[]
  selectedCorridorId: string | null
  /** Corridors the selected course of action rides on, and how hard. */
  courseEmphasis: Map<string, 'main' | 'supporting'>
  orbatUnits: OrbatUnit[]
  selectedUnitId: string | null
  blockPlan: BlockPlan | null
  graph: RoadGraph | null
  roadEdits: Record<string, RoadEdit>
  onSelectionFinalize: (selection: SelectionResult) => void
  onObjectiveAreaFinalize: (selection: SelectionResult) => void
  onViewerReady: (viewer: Cesium.Viewer) => void
  onPlace: (mode: PlaceMode, position: LonLat) => void
  onRoadComplete: (points: LonLat[]) => void
  onRoadCancel: () => void
}
const hiddenCredits = document.createElement('div')

function isPlaceMode(mode: OperationalToolMode): mode is PlaceMode {
  return mode === 'place-reserve' || mode === 'place-orbat-unit' || mode === 'place-block-point'
}

function OperationalOverlayController({
  toolMode,
  areaBbox,
  marks,
  overlay,
  lines,
  selectedCorridorId,
  courseEmphasis,
  orbatUnits,
  selectedUnitId,
  blockPlan,
  graph,
  roadEdits,
  onPlace,
  onRoadComplete,
  onRoadCancel,
}: Pick<
  Props,
  | 'toolMode'
  | 'areaBbox'
  | 'marks'
  | 'overlay'
  | 'lines'
  | 'selectedCorridorId'
  | 'courseEmphasis'
  | 'orbatUnits'
  | 'selectedUnitId'
  | 'blockPlan'
  | 'graph'
  | 'roadEdits'
  | 'onPlace'
  | 'onRoadComplete'
  | 'onRoadCancel'
>) {
  const { viewer } = useCesium()
  const allocatedUnitIds = new Set((blockPlan?.allocation ?? []).map((entry) => entry.unit_id))

  // Under everything else: the detected network is context, not a finding.
  useRoadNetworkEntities({ viewer, graph })
  useRoadLabelEntities({ viewer, graph, roadEdits })
  useAreaBoundsEntity({ viewer, bbox: areaBbox })
  useStudyMarkEntities({ viewer, marks, overlay })
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
  useOperationalRoadDrawing({
    viewer,
    active: toolMode === 'draw-road' || toolMode === 'break-road',
    onComplete: onRoadComplete,
    onCancel: onRoadCancel,
  })
  return null
}

export function OperationalGlobe({
  toolMode,
  resetToken,
  areaBbox,
  marks,
  overlay,
  lines,
  selectedCorridorId,
  courseEmphasis,
  orbatUnits,
  selectedUnitId,
  blockPlan,
  graph,
  roadEdits,
  onSelectionFinalize,
  onObjectiveAreaFinalize,
  onViewerReady,
  onPlace,
  onRoadComplete,
  onRoadCancel,
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
        overlay={overlay}
        lines={lines}
        selectedCorridorId={selectedCorridorId}
        courseEmphasis={courseEmphasis}
        orbatUnits={orbatUnits}
        selectedUnitId={selectedUnitId}
        blockPlan={blockPlan}
        graph={graph}
        roadEdits={roadEdits}
        onPlace={onPlace}
        onRoadComplete={onRoadComplete}
        onRoadCancel={onRoadCancel}
      />
    </Viewer>
  )
}
