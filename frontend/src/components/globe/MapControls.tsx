import { Compass, Plus, Minus, MousePointer2 } from 'lucide-react'
import type { ToolMode } from '../../types/entities'

interface Props {
  is3D: boolean
  onResetNorth: () => void
  onToggleSceneMode: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  toolMode: ToolMode
  onSetToolMode: (mode: ToolMode) => void
}

export function MapControls({ is3D, onResetNorth, onToggleSceneMode, onZoomIn, onZoomOut, toolMode, onSetToolMode }: Props) {
  return (
    <div className="flex items-end gap-2">
      <ToolButton
        title="Pointer"
        active={toolMode === 'navigate'}
        disabled={false}
        onClick={() => onSetToolMode('navigate')}
      >
        <MousePointer2 className="h-4 w-4" strokeWidth={1.75} />
      </ToolButton>

      <button
        type="button"
        onClick={onResetNorth}
        title="Reset north"
        className="glass flex h-11 w-11 items-center justify-center rounded-xl text-(--text) transition-colors hover:text-(--text-h)"
      >
        <Compass className="h-4 w-4" strokeWidth={1.75} />
      </button>

      <button
        type="button"
        onClick={onToggleSceneMode}
        title="Toggle 2D / 3D"
        className="glass flex h-11 items-center justify-center rounded-xl px-3 text-sm text-(--text) transition-colors hover:text-(--text-h)"
      >
        {is3D ? '3D' : '2D'}
      </button>

      <div className="glass flex flex-col overflow-hidden rounded-xl">
        <button
          type="button"
          onClick={onZoomIn}
          title="Zoom in"
          className="flex h-[22px] w-11 items-center justify-center text-(--text) transition-colors hover:text-(--text-h)"
        >
          <Plus className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
        <div className="h-px bg-(--border)" />
        <button
          type="button"
          onClick={onZoomOut}
          title="Zoom out"
          className="flex h-[22px] w-11 items-center justify-center text-(--text) transition-colors hover:text-(--text-h)"
        >
          <Minus className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      </div>
    </div>
  )
}

function ToolButton({
  title,
  active,
  disabled,
  onClick,
  children,
}: {
  title: string
  active: boolean
  disabled: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`glass flex h-11 w-11 items-center justify-center rounded-xl transition-colors ${
        disabled
          ? 'text-(--text-dim) opacity-40'
          : active
            ? 'text-(--accent)'
            : 'text-(--text) hover:text-(--text-h)'
      }`}
    >
      {children}
    </button>
  )
}
