import { useCesium } from 'resium'
import { useUnitEntities } from '../../hooks/useUnitEntities'
import { useObjectiveEntities } from '../../hooks/useObjectiveEntities'
import { useRouteEntities } from '../../hooks/useRouteEntities'
import { usePlacementTool } from '../../hooks/usePlacementTool'
import { useRouteDrawing } from '../../hooks/useRouteDrawing'
import type { LonLat, PlacedObjective, PlacedRoute, PlacedUnit, ToolMode } from '../../types/entities'
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
  onPlace: (mode: 'place-blue' | 'place-red' | 'place-objective', position: LonLat) => void
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
  onPlace,
  onRouteComplete,
  onRouteDrawingChange,
}: Props) {
  const { viewer } = useCesium()

  useUnitEntities({ viewer, units })
  useObjectiveEntities({ viewer, objectives })
  useRouteEntities({ viewer, routes })
  usePlacementTool({ viewer, mode: toolMode, onPlace })
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

  return null
}
