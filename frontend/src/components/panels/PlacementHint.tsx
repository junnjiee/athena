import type { ToolMode } from '../../types/entities'

interface Props {
  toolMode: ToolMode
  isDrawingRoute: boolean
  /** Topo view active: route drawing is freehand press-drag there, not
   *  click-waypoints like the 3D globe. */
  topo?: boolean
}

function hintFor(toolMode: ToolMode, isDrawingRoute: boolean, topo: boolean): string | null {
  switch (toolMode) {
    case 'place-objective':
      return 'Click the map to place an objective'
    case 'place-blue-section':
      return 'Click the map to place a blue force section'
    case 'place-blue-platoon':
      return 'Click the map to place a blue force platoon'
    case 'place-red-section':
      return 'Click the map to place a red force section'
    case 'place-red-platoon':
      return 'Click the map to place a red force platoon'
    case 'place-trench':
      return 'Click the map to place a trench position'
    case 'place-prepared-trench':
      return 'Click the map to place a prepared trench position'
    case 'draw-route':
      if (topo) {
        return isDrawingRoute
          ? 'Release on a unit or objective to link the route end · Esc to cancel'
          : 'Press and drag from a unit to sketch its route'
      }
      return isDrawingRoute
        ? 'Click to add a waypoint · click a unit/objective or press Enter to finish · Esc to cancel'
        : 'Click an existing unit to start a movement route'
    default:
      return null
  }
}

export function PlacementHint({ toolMode, isDrawingRoute, topo = false }: Props) {
  const hint = hintFor(toolMode, isDrawingRoute, topo)
  if (!hint) return null

  return (
    <div className="glass rounded-full px-4 py-2 text-sm text-(--text-h)">
      {hint}
    </div>
  )
}
