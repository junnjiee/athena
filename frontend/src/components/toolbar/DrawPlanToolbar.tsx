import { Pencil, Star } from 'lucide-react'
import { areaPositionSymbol, blueAreaSymbol, trenchSymbol } from '../../lib/tacticalSymbols'
import { FRIENDLY_HEX, HOSTILE_HEX } from '../../lib/colors'
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
  const placementReason = !planningMode
    ? 'Name the battleground to begin planning'
    : !battlefieldReady
      ? 'Generate the battlefield first'
      : ''

  return (
    <div className="glass flex w-56 flex-col rounded-xl p-3">
      <div className="mb-2 text-xs tracking-wide text-(--text-dim)">DRAW / PLAN</div>
      <div className="flex max-h-[calc(100vh-19rem)] flex-col gap-1 overflow-y-auto pr-1">
        <ToolRow
          label="Draw Route"
          reason={placementReason}
          active={toolMode === 'draw-route'}
          disabled={!canPlace}
          onClick={() => toggle('draw-route')}
        >
          <Pencil className="h-3.5 w-3.5" strokeWidth={1.75} />
        </ToolRow>
        <ToolRow
          label="Objective"
          reason={placementReason}
          active={toolMode === 'place-objective'}
          disabled={!canPlace}
          onClick={() => toggle('place-objective')}
        >
          <Star className="h-3.5 w-3.5" strokeWidth={1.75} />
        </ToolRow>
        <ToolRow
          label="Blue Force Section"
          reason={placementReason}
          active={toolMode === 'place-blue-section'}
          disabled={!canPlace}
          onClick={() => toggle('place-blue-section')}
        >
          <img src={blueAreaSymbol(2, FRIENDLY_HEX).url} alt="" className="h-4 w-6" />
        </ToolRow>
        <ToolRow
          label="Blue Force Platoon"
          reason={placementReason}
          active={toolMode === 'place-blue-platoon'}
          disabled={!canPlace}
          onClick={() => toggle('place-blue-platoon')}
        >
          <img src={blueAreaSymbol(3, FRIENDLY_HEX).url} alt="" className="h-4 w-6" />
        </ToolRow>
        <ToolRow
          label="Red Force Section"
          reason={placementReason}
          active={toolMode === 'place-red-section'}
          disabled={!canPlace}
          onClick={() => toggle('place-red-section')}
        >
          <img src={areaPositionSymbol(2, HOSTILE_HEX).url} alt="" className="h-4 w-6" />
        </ToolRow>
        <ToolRow
          label="Red Force Platoon"
          reason={placementReason}
          active={toolMode === 'place-red-platoon'}
          disabled={!canPlace}
          onClick={() => toggle('place-red-platoon')}
        >
          <img src={areaPositionSymbol(3, HOSTILE_HEX).url} alt="" className="h-4 w-6" />
        </ToolRow>
        <ToolRow
          label="Trench Position"
          reason={placementReason}
          active={toolMode === 'place-trench'}
          disabled={!canPlace}
          onClick={() => toggle('place-trench')}
        >
          <img src={trenchSymbol(false).url} alt="" className="h-4 w-5" />
        </ToolRow>
        <ToolRow
          label="Prepared Trench"
          reason={placementReason}
          active={toolMode === 'place-prepared-trench'}
          disabled={!canPlace}
          onClick={() => toggle('place-prepared-trench')}
        >
          <img src={trenchSymbol(true).url} alt="" className="h-4 w-5" />
        </ToolRow>
      </div>
    </div>
  )
}

interface ToolRowProps {
  label: string
  /** disabled-state reason, shown as a native tooltip */
  reason: string
  active: boolean
  disabled: boolean
  onClick: () => void
  colorClass?: string
  children: React.ReactNode
}

function ToolRow({ label, reason, active, disabled, onClick, colorClass, children }: ToolRowProps) {
  return (
    <button
      type="button"
      title={disabled ? reason : undefined}
      disabled={disabled}
      onClick={onClick}
      className={`flex items-center gap-2 rounded-md border px-2 py-1.5 text-left text-sm transition-colors ${
        disabled
          ? `border-transparent opacity-40 ${colorClass ?? 'text-(--text-dim)'}`
          : active
            ? 'border-(--accent-border) bg-(--accent-bg) text-(--accent)'
            : `border-transparent hover:bg-white/5 hover:text-(--text-h) ${colorClass ?? 'text-(--text)'}`
      }`}
    >
      <span className="flex h-5 w-6 shrink-0 items-center justify-center">{children}</span>
      {label}
    </button>
  )
}
