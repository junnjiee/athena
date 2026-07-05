import { MousePointer2, Pencil, Square, Star, Users, Diamond } from 'lucide-react'
import type { ToolMode } from '../../types/entities'

interface Props {
  toolMode: ToolMode
  onSetToolMode: (mode: ToolMode) => void
  planningMode: boolean
  /** Whether the battlefield has finished generating -- placement tools need real
   *  grid/terrain data behind them, not just a name+selection. */
  battlefieldReady: boolean
}

export function DrawPlanToolbar({ toolMode, onSetToolMode, planningMode, battlefieldReady }: Props) {
  function toggle(mode: ToolMode) {
    onSetToolMode(toolMode === mode ? 'navigate' : mode)
  }

  const canPlace = planningMode && battlefieldReady
  const placementTitle = (label: string) =>
    !planningMode ? 'Name the battleground to begin planning' : !battlefieldReady ? 'Generate the battlefield first' : label

  return (
    <div className="glass w-44 rounded-xl p-3">
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
          title={placementTitle('Draw movement route (click a unit to start)')}
          active={toolMode === 'draw-route'}
          disabled={!canPlace}
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
          title={placementTitle('Place objective')}
          active={toolMode === 'place-objective'}
          disabled={!canPlace}
          onClick={() => toggle('place-objective')}
        >
          <Star className="h-4 w-4" strokeWidth={1.75} />
        </ToolButton>
      </div>

      <div className="mt-2 flex gap-1.5">
        <ToolButton
          title={placementTitle('Place blue-force unit')}
          active={toolMode === 'place-blue'}
          disabled={!canPlace}
          onClick={() => toggle('place-blue')}
          colorClass="text-(--friendly)"
        >
          <Users className="h-4 w-4" strokeWidth={1.75} />
        </ToolButton>
        <ToolButton
          title={placementTitle('Place red-force threat')}
          active={toolMode === 'place-red'}
          disabled={!canPlace}
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
