import { Compass, Plus, Minus } from 'lucide-react'

interface Props {
  is3D: boolean
  onResetNorth: () => void
  onToggleSceneMode: () => void
  onZoomIn: () => void
  onZoomOut: () => void
}

export function MapControls({ is3D, onResetNorth, onToggleSceneMode, onZoomIn, onZoomOut }: Props) {
  return (
    <div className="flex items-end gap-2">
      <button
        type="button"
        onClick={onResetNorth}
        title="Reset north"
        className="flex h-11 w-11 items-center justify-center rounded-lg border border-(--border) bg-(--panel-bg) text-(--text) backdrop-blur-md hover:text-(--text-h)"
      >
        <Compass className="h-4 w-4" strokeWidth={1.75} />
      </button>

      <button
        type="button"
        onClick={onToggleSceneMode}
        title="Toggle 2D / 3D"
        className="flex h-11 items-center justify-center rounded-lg border border-(--border) bg-(--panel-bg) px-3 text-sm text-(--text) backdrop-blur-md hover:text-(--text-h)"
      >
        {is3D ? '3D' : '2D'}
      </button>

      <div className="flex flex-col overflow-hidden rounded-lg border border-(--border) bg-(--panel-bg) backdrop-blur-md">
        <button
          type="button"
          onClick={onZoomIn}
          title="Zoom in"
          className="flex h-[22px] w-11 items-center justify-center text-(--text) hover:text-(--text-h)"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
        <div className="h-px bg-(--border)" />
        <button
          type="button"
          onClick={onZoomOut}
          title="Zoom out"
          className="flex h-[22px] w-11 items-center justify-center text-(--text) hover:text-(--text-h)"
        >
          <Minus className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      </div>
    </div>
  )
}
