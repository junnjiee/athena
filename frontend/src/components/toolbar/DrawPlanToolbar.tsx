import { MousePointer2, Pencil, Square, Star, Users, Diamond } from 'lucide-react'
import type { ToolMode } from '../../types/entities'

interface Props {
  toolMode: ToolMode
  onSetToolMode: (mode: ToolMode) => void
  planningMode: boolean
}

export function DrawPlanToolbar({ toolMode, onSetToolMode, planningMode }: Props) {
  function toggle(mode: ToolMode) {
    onSetToolMode(toolMode === mode ? 'navigate' : mode)
  }

  return (
    <div className="w-44 rounded-lg border border-(--border) bg-(--panel-bg) p-3 backdrop-blur-md shadow-(--shadow)">
      <div className="mb-2 text-xs tracking-wide text-(--text-dim)">DRAW / PLAN</div>
      <div className="grid grid-cols-4 gap-1.5">
        <ToolButton
          title="Pointer"
          active={toolMode === 'navigate'}
          disabled={false}
          onClick={() => onSetToolMode('navigate')}
        >
          <MousePointer2 className="h-4 w-4" strokeWidth={1.75} />
        </ToolButton>
        <ToolButton
          title={planningMode ? 'Draw movement route (click a unit to start)' : 'Name the battleground to begin planning'}
          active={toolMode === 'draw-route'}
          disabled={!planningMode}
          onClick={() => toggle('draw-route')}
        >
          <Pencil className="h-4 w-4" strokeWidth={1.75} />
        </ToolButton>
        <ToolButton
          title={planningMode ? 'Ground already selected for this battleground' : 'Select ground (drag a rectangle)'}
          active={toolMode === 'select-ground'}
          disabled={planningMode}
          onClick={() => toggle('select-ground')}
        >
          <Square className="h-4 w-4" strokeWidth={1.75} />
        </ToolButton>
        <ToolButton
          title={planningMode ? 'Place objective' : 'Name the battleground to begin planning'}
          active={toolMode === 'place-objective'}
          disabled={!planningMode}
          onClick={() => toggle('place-objective')}
        >
          <Star className="h-4 w-4" strokeWidth={1.75} />
        </ToolButton>
      </div>

      <div className="mt-2 flex gap-1.5">
        <ToolButton
          title={planningMode ? 'Place blue-force unit' : 'Name the battleground to begin planning'}
          active={toolMode === 'place-blue'}
          disabled={!planningMode}
          onClick={() => toggle('place-blue')}
          colorClass="text-(--friendly)"
        >
          <Users className="h-4 w-4" strokeWidth={1.75} />
        </ToolButton>
        <ToolButton
          title={planningMode ? 'Place red-force threat' : 'Name the battleground to begin planning'}
          active={toolMode === 'place-red'}
          disabled={!planningMode}
          onClick={() => toggle('place-red')}
          colorClass="text-(--hostile)"
        >
          <Diamond className="h-4 w-4" strokeWidth={1.75} />
        </ToolButton>
      </div>
    </div>
  )
}

interface ToolButtonProps {
  title: string
  active: boolean
  disabled: boolean
  onClick: () => void
  colorClass?: string
  children: React.ReactNode
}

function ToolButton({ title, active, disabled, onClick, colorClass, children }: ToolButtonProps) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-md border ${
        disabled
          ? `border-(--border) opacity-40 ${colorClass ?? 'text-(--text-dim)'}`
          : active
            ? 'border-(--accent-border) bg-(--accent-bg) text-(--accent)'
            : `border-(--border) hover:text-(--text-h) ${colorClass ?? 'text-(--text)'}`
      }`}
    >
      {children}
    </button>
  )
}
