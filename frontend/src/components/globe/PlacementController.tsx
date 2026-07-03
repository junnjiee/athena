import { useCesium } from 'resium'
import { useUnitEntities } from '../../hooks/useUnitEntities'
import { useObjectiveEntities } from '../../hooks/useObjectiveEntities'
import { useRouteEntities } from '../../hooks/useRouteEntities'
import { usePlacementTool } from '../../hooks/usePlacementTool'
import { useRouteDrawing } from '../../hooks/useRouteDrawing'
import type { LonLat, PlacedObjective, PlacedRoute, PlacedUnit, ToolMode } from '../../types/entities'

interface NewRouteInput {
  side: PlacedRoute['side']
  startUnitId: string
  points: LonLat[]
  endRef: PlacedRoute['endRef']
}

interface Props {
  toolMode: ToolMode
  units: PlacedUnit[]
  objectives: PlacedObjective[]
  routes: PlacedRoute[]
  onPlace: (mode: 'place-blue' | 'place-red' | 'place-objective', position: LonLat) => void
  onRouteComplete: (route: NewRouteInput) => void
  onRouteDrawingChange?: (isDrawing: boolean) => void
}

export function PlacementController({
  toolMode,
  units,
  objectives,
  routes,
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
    onRouteComplete,
    onDrawingChange: onRouteDrawingChange,
  })

  return null
}
