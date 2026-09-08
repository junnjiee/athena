import { useCesium } from 'resium'
import { useUnitEntities } from '../../hooks/useUnitEntities'
import { useObjectiveEntities } from '../../hooks/useObjectiveEntities'
import { useRouteEntities } from '../../hooks/useRouteEntities'
import { usePlacementTool } from '../../hooks/usePlacementTool'
import { useRouteDrawing } from '../../hooks/useRouteDrawing'
import { useUnitEditing } from '../../hooks/useUnitEditing'
import { useSelectionHandle } from '../../hooks/useSelectionHandle'
import type { LonLat, PlaceableMode, PlacedObjective, PlacedRoute, PlacedUnit, ToolMode } from '../../types/entities'
import type { MovementLoadout, MovementType } from '../../types/movement'

interface NewRouteInput {
  side: PlacedRoute['side']
  startUnitId: string
  points: LonLat[]
  endRef: PlacedRoute['endRef']
  movementType: MovementType
  loadout: MovementLoadout
}

interface Props {
  toolMode: ToolMode
  units: PlacedUnit[]
  objectives: PlacedObjective[]
  routes: PlacedRoute[]
  movementType: MovementType
  loadout: MovementLoadout
  selectedUnitId: string | null
  onSelectUnit: (id: string | null) => void
  onMoveUnit: (id: string, position: LonLat) => void
  onMoveObjective: (id: string, position: LonLat) => void
  onRotateUnit: (id: string, rotationRadians: number) => void
  onSetToolMode: (mode: ToolMode) => void
  onPlace: (mode: PlaceableMode, position: LonLat) => void
  onRouteComplete: (route: NewRouteInput) => void
  onRouteDrawingChange?: (isDrawing: boolean) => void
}

export function PlacementController({
  toolMode,
  units,
  objectives,
  routes,
  movementType,
  loadout,
  selectedUnitId,
  onSelectUnit,
  onMoveUnit,
  onMoveObjective,
  onRotateUnit,
  onSetToolMode,
  onPlace,
  onRouteComplete,
  onRouteDrawingChange,
}: Props) {
  const { viewer } = useCesium()

  useUnitEntities({ viewer, units })
  useObjectiveEntities({ viewer, objectives })
  useRouteEntities({ viewer, routes })
  usePlacementTool({
    viewer,
    mode: toolMode,
    units,
    objectives,
    onSelectUnit,
    onSetToolMode,
    onPlace: (mode, position) => {
      if (mode !== 'navigate' && mode !== 'select-ground' && mode !== 'draw-route') onPlace(mode, position)
    },
  })
  useRouteDrawing({
    viewer,
    active: toolMode === 'draw-route',
    units,
    objectives,
    movementType,
    loadout,
    onRouteComplete,
    onDrawingChange: onRouteDrawingChange,
  })
  useUnitEditing({
    viewer,
    active: toolMode === 'navigate',
    units,
    objectives,
    selectedUnitId,
    onSelectUnit,
    onMoveUnit,
    onMoveObjective,
    onRotateUnit,
  })
  useSelectionHandle({ viewer, units, selectedUnitId })

  return null
}
