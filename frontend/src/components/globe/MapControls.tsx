import { Compass, Plus, Minus, MousePointer2, ChevronUp, ChevronDown } from 'lucide-react'

interface Props<M extends string> {
  onResetNorth: () => void
  onZoomIn: () => void
  onZoomOut: () => void
  toolMode: M
  onSetToolMode: (mode: M) => void
  navigateMode?: M
  /** Scene morphing, where the surface still offers it. The planning surface
   *  does not: it is always a map, tilted rather than morphed. */
  is3D?: boolean
  onToggleSceneMode?: () => void
  /** Camera pitch, for surfaces that read as a map but still need to show
   *  depth. Negative degrees; -90 is straight down. */
  pitchDegrees?: number
  onTilt?: (deltaDegrees: number) => void
}

export function MapControls<M extends string>({
  onResetNorth,
  onZoomIn,
  onZoomOut,
  toolMode,
  onSetToolMode,
  navigateMode = 'navigate' as M,
  is3D,
  onToggleSceneMode,
  pitchDegrees,
  onTilt,
}: Props<M>) {
  return (
    <div className="flex items-end gap-2">
      <ToolButton
        title="Pointer"
        active={toolMode === navigateMode}
        disabled={false}
        onClick={() => onSetToolMode(navigateMode)}
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

      {onToggleSceneMode && (
        <button
          type="button"
          onClick={onToggleSceneMode}
          title="Toggle 2D / 3D"
          className="glass flex h-11 items-center justify-center rounded-xl px-3 text-sm text-(--text) transition-colors hover:text-(--text-h)"
        >
          {is3D ? '3D' : '2D'}
        </button>
      )}

      {onTilt && (
        <div className="glass flex flex-col overflow-hidden rounded-xl">
          <button
            type="button"
            onClick={() => onTilt(15)}
            title="Lean over the map — reveals relief"
            aria-label="Tilt camera down"
            className="flex h-[22px] w-11 items-center justify-center text-(--text) transition-colors hover:text-(--text-h)"
          >
            <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
          <div className="px-1 text-center text-[9px] text-(--text-dim)">
            {Math.round(Math.abs(pitchDegrees ?? -90))}°
          </div>
          <button
            type="button"
            onClick={() => onTilt(-15)}
            title="Back towards straight down"
            aria-label="Tilt camera up"
            className="flex h-[22px] w-11 items-center justify-center text-(--text) transition-colors hover:text-(--text-h)"
          >
            <ChevronUp className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        </div>
      )}

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
