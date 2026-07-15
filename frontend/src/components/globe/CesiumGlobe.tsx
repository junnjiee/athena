import { Viewer } from 'resium'
import type * as Cesium from 'cesium'
import { worldTerrain } from '../../lib/cesium-setup'
import { RectangleSelectionController } from './RectangleSelectionController'
import { ViewerBridge } from './ViewerBridge'
import { PlacementController } from './PlacementController'
import { BattlefieldController } from '../battlefield/BattlefieldController'
import type { SelectionResult } from '../../types/selection'
import type { LonLat, NewRouteInput, PlacedObjective, PlacedRoute, PlacedUnit, ToolMode } from '../../types/entities'
import type { MovementLoadout, MovementType } from '../../types/movement'

interface Props {
  armed: boolean
  resetToken: number
  onSelectionFinalize: (result: SelectionResult) => void
  onViewerReady: (viewer: Cesium.Viewer) => void
  toolMode: ToolMode
  units: PlacedUnit[]
  objectives: PlacedObjective[]
  routes: PlacedRoute[]
  movementType: MovementType
  loadout: MovementLoadout
  onPlace: (mode: 'place-blue' | 'place-red' | 'place-objective', position: LonLat) => void
  onRouteComplete: (route: NewRouteInput) => void
  onRouteDrawingChange?: (isDrawing: boolean) => void
}

// Cesium's default widgets (geocoder, home button, scene-mode picker) are replaced by
// our own chrome (TopHeader, MapControls) to match the reference design, so all are
// disabled here.
export function CesiumGlobe({
  armed,
  resetToken,
  onSelectionFinalize,
  onViewerReady,
  toolMode,
  units,
  objectives,
  routes,
  movementType,
  loadout,
  onPlace,
  onRouteComplete,
  onRouteDrawingChange,
}: Props) {
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
      <PlacementController
        toolMode={toolMode}
        units={units}
        objectives={objectives}
        routes={routes}
        movementType={movementType}
        loadout={loadout}
        onPlace={onPlace}
        onRouteComplete={onRouteComplete}
        onRouteDrawingChange={onRouteDrawingChange}
      />
      <BattlefieldController />
    </Viewer>
  )
}
