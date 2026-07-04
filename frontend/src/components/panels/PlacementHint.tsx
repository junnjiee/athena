import type { ToolMode } from '../../types/entities'

interface Props {
  toolMode: ToolMode
  isDrawingRoute: boolean
}

function hintFor(toolMode: ToolMode, isDrawingRoute: boolean): string | null {
  switch (toolMode) {
    case 'place-blue':
      return 'Click the map to place a blue-force unit'
    case 'place-red':
      return 'Click the map to place a red-force threat'
    case 'place-objective':
      return 'Click the map to place an objective'
    case 'draw-route':
      return isDrawingRoute
        ? 'Click to add a waypoint · click a unit/objective or press Enter to finish · Esc to cancel'
        : 'Click an existing unit to start a movement route'
    default:
      return null
  }
}

export function PlacementHint({ toolMode, isDrawingRoute }: Props) {
  const hint = hintFor(toolMode, isDrawingRoute)
  if (!hint) return null

  return (
    <div className="glass rounded-full px-4 py-2 text-sm text-(--text-h)">
      {hint}
    </div>
  )
}
