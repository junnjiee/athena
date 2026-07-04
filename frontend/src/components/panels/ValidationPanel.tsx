import { AlertTriangle, ShieldAlert, Waves, TrendingUp, Turtle } from 'lucide-react'
import { useBattleground } from '../../state/battleground'
import type { LonLat } from '../../types/entities'
import type { PlanWarning, WarningKind } from '../../lib/validate'

const KIND_ICON: Record<WarningKind, typeof AlertTriangle> = {
  steep: TrendingUp,
  water: Waves,
  exposed: ShieldAlert,
  slow: Turtle,
}

interface Props {
  onLocate: (positions: LonLat[]) => void
}

/** Grammarly-for-tactics: the validator's findings for the drawn plan. */
export function ValidationPanel({ onLocate }: Props) {
  const analysis = useBattleground((s) => s.planAnalysis)
  if (!analysis || analysis.warnings.length === 0) return null

  return (
    <div className="glass w-64 rounded-xl p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs tracking-wide text-(--text-dim)">
        <AlertTriangle className="h-3 w-3 text-(--hostile)" />
        PLAN VALIDATION · {analysis.warnings.length}
      </div>
      <div className="flex max-h-44 flex-col gap-1 overflow-y-auto pr-1">
        {analysis.warnings.map((warning) => (
          <WarningRow key={warning.id} warning={warning} onLocate={onLocate} />
        ))}
      </div>
    </div>
  )
}

function WarningRow({ warning, onLocate }: { warning: PlanWarning; onLocate: Props['onLocate'] }) {
  const Icon = KIND_ICON[warning.kind]
  const color = warning.severity === 'critical' ? 'text-(--hostile)' : 'text-amber-400'
  return (
    <button
      type="button"
      onClick={() => onLocate([warning.position])}
      className="flex items-start gap-2 rounded-md px-1.5 py-1.5 text-left text-xs text-(--text) transition-colors hover:bg-white/5 hover:text-(--text-h)"
    >
      <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${color}`} strokeWidth={1.75} />
      <span>{warning.message}</span>
    </button>
  )
}
