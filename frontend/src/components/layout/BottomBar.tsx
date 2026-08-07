import { Copy, Play, Save, TrendingUp } from 'lucide-react'
import { useBattleground } from '../../state/battleground'
import { usePlan } from '../../state/plan'

interface Props {
  canRunSimulation: boolean
  planName: string
  onRunSimulation: () => void
  onSavePlan: () => void
  /** Forks the drawing into a new plan row rather than overwriting. */
  onSaveAsNew: () => void
  saveState: 'idle' | 'saving' | 'saved' | 'error'
}

function etaRange(minutes: number): string {
  const low = Math.max(1, Math.round(minutes * 0.85))
  const high = Math.max(low + 1, Math.round(minutes * 1.2))
  return `${low} – ${high} min`
}

export function BottomBar({
  canRunSimulation,
  planName,
  onRunSimulation,
  onSavePlan,
  onSaveAsNew,
  saveState,
}: Props) {
  const phase = useBattleground((s) => s.phase)
  const analysis = useBattleground((s) => s.planAnalysis)
  const planTitle = usePlan((s) => s.planTitle)
  const setPlanTitle = usePlan((s) => s.setPlanTitle)
  const savedPlanId = usePlan((s) => s.savedPlanId)

  const criticals = analysis?.warnings.filter((w) => w.severity === 'critical').length ?? 0
  const confidence =
    !analysis ? null : criticals > 0 || analysis.exposure > 0.35 ? 'Low' : analysis.exposure > 0.15 ? 'Medium' : 'High'

  const statusLine =
    phase === 'ready'
      ? analysis
        ? `${analysis.routes.length} route${analysis.routes.length === 1 ? '' : 's'} · ${analysis.warnings.length} warning${analysis.warnings.length === 1 ? '' : 's'}`
        : 'Battlefield ready — draw a plan'
      : canRunSimulation
        ? 'Not run yet'
        : 'Select an area to begin'

  return (
    <div className="glass-deep pointer-events-auto flex items-center justify-between gap-6 rounded-2xl px-6 py-3">
      <div className="min-w-0">
        <div className="text-xs tracking-wide text-(--text-dim)">CURRENT PLAN</div>
        {canRunSimulation ? (
          // A plan is named independently of the ground it sits on, so two
          // courses of action can share one battleground (#53).
          <input
            value={planTitle}
            onChange={(e) => setPlanTitle(e.target.value)}
            placeholder={planName || 'Untitled Plan'}
            aria-label="Plan name"
            className="w-48 truncate border-b border-transparent bg-transparent text-sm text-(--text-h) placeholder:text-(--text-dim) hover:border-(--border) focus:border-(--accent) focus:outline-none"
          />
        ) : (
          <div className="text-sm text-(--text-h)">No ground selected</div>
        )}
        <div className="text-xs text-(--text-dim)">
          {statusLine}
          {savedPlanId && <span className="ml-1.5 opacity-70">· saved</span>}
        </div>
      </div>

      <div className="flex items-center gap-10">
        <div>
          <div className="text-xs tracking-wide text-(--text-dim)">ESTIMATED OUTCOME (500 RUNS)</div>
          <div className="text-xl font-medium text-(--text-dim)">—</div>
        </div>
        <div>
          <div className="text-xs text-(--text-dim)">Plan Exposure</div>
          <div className={`text-lg ${analysis ? 'text-(--text-h)' : 'text-(--text-dim)'}`}>
            {analysis ? `${Math.round(analysis.exposure * 100)} %` : '—'}
          </div>
        </div>
        <div>
          <div className="text-xs text-(--text-dim)">Time to Objective</div>
          <div className={`text-lg ${analysis ? 'text-(--text-h)' : 'text-(--text-dim)'}`}>
            {analysis && analysis.totalEtaMinutes > 0 ? etaRange(analysis.totalEtaMinutes) : '—'}
          </div>
        </div>
        <div>
          <div className="text-xs text-(--text-dim)">Confidence</div>
          <div
            className={`flex items-center gap-1 text-lg ${
              confidence === 'High'
                ? 'text-(--accent)'
                : confidence === 'Low'
                  ? 'text-(--hostile)'
                  : confidence
                    ? 'text-(--text-h)'
                    : 'text-(--text-dim)'
            }`}
          >
            <TrendingUp className="h-4 w-4" strokeWidth={1.75} />
            {confidence ?? '—'}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          disabled={!canRunSimulation || saveState === 'saving'}
          onClick={onSavePlan}
          className="glass flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm text-(--text) transition-colors hover:text-(--text-h) disabled:cursor-not-allowed disabled:text-(--text-dim)"
        >
          <Save className="h-4 w-4" strokeWidth={1.75} />
          {saveState === 'saving'
            ? 'Saving…'
            : saveState === 'saved'
              ? 'Saved'
              : saveState === 'error'
                ? 'Save failed'
                : savedPlanId
                  ? 'Update Plan'
                  : 'Save Plan'}
        </button>
        {savedPlanId && (
          <button
            type="button"
            disabled={!canRunSimulation || saveState === 'saving'}
            onClick={onSaveAsNew}
            title="Save as a new plan on this battleground"
            className="glass flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm text-(--text) transition-colors hover:text-(--text-h) disabled:cursor-not-allowed disabled:text-(--text-dim)"
          >
            <Copy className="h-4 w-4" strokeWidth={1.75} />
            Save as new
          </button>
        )}
        <button
          type="button"
          disabled={!canRunSimulation}
          onClick={onRunSimulation}
          className="flex items-center gap-2 rounded-xl bg-(--accent) px-5 py-2.5 text-sm font-medium text-(--panel-bg-solid) transition-colors hover:bg-(--accent-hover) disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-(--text-dim)"
        >
          <Play className="h-4 w-4" strokeWidth={2} />
          <span className="text-left leading-tight">
            Run Simulation
            <div className="text-xs font-normal opacity-80">500 Runs</div>
          </span>
        </button>
      </div>
    </div>
  )
}
