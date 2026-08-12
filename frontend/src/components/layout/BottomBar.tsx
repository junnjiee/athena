import { Copy, Play, Save, TrendingUp } from 'lucide-react'
import { useBattleground } from '../../state/battleground'
import { usePlan } from '../../state/plan'
import { batchOutcome, useSimulation } from '../../state/simulation'

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
  const simPhase = useSimulation((s) => s.phase)
  const simRequested = useSimulation((s) => s.requested)
  const simResults = useSimulation((s) => s.results)

  const outcome = batchOutcome(simResults)
  const criticals = analysis?.warnings.filter((w) => w.severity === 'critical').length ?? 0
  // A simulated win rate is evidence; route exposure is a heuristic standing in
  // for one. Once runs exist they decide the confidence readout.
  const confidence = outcome
    ? outcome.blueWinRate >= 0.6
      ? 'High'
      : outcome.blueWinRate >= 0.35
        ? 'Medium'
        : 'Low'
    : !analysis
      ? null
      : criticals > 0 || analysis.exposure > 0.35
        ? 'Low'
        : analysis.exposure > 0.15
          ? 'Medium'
          : 'High'

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
      <div className="min-w-0 shrink">
        <div className="text-xs tracking-wide whitespace-nowrap text-(--text-dim)">CURRENT PLAN</div>
        {canRunSimulation ? (
          // A plan is named independently of the ground it sits on, so two
          // courses of action can share one battleground (#53).
          <input
            value={planTitle}
            onChange={(e) => setPlanTitle(e.target.value)}
            placeholder={planName || 'Untitled Plan'}
            aria-label="Plan name"
            className="w-full max-w-48 min-w-24 truncate border-b border-transparent bg-transparent text-sm text-(--text-h) placeholder:text-(--text-dim) hover:border-(--border) focus:border-(--accent) focus:outline-none"
          />
        ) : (
          <div className="text-sm text-(--text-h)">No ground selected</div>
        )}
        <div className="text-xs text-(--text-dim)">
          {statusLine}
          {savedPlanId && <span className="ml-1.5 opacity-70">· saved</span>}
        </div>
      </div>

      {/* The metric cluster is the first thing to go when space is tight. It is
          read-only context; the plan name and the action buttons are not, and
          letting all three compete made the bar tall enough to overlap the
          terrain panel pinned above it. */}
      <div className="hidden shrink items-center gap-6 lg:flex xl:gap-10">
        <div className="hidden xl:block">
          <div className="text-xs tracking-wide whitespace-nowrap text-(--text-dim)">
            {outcome
              ? `BLUE SUCCESS (${outcome.runs} RUN${outcome.runs === 1 ? '' : 'S'})`
              : 'ESTIMATED OUTCOME'}
          </div>
          <div className={`text-xl font-medium ${outcome ? 'text-(--text-h)' : 'text-(--text-dim)'}`}>
            {outcome ? `${Math.round(outcome.blueWinRate * 100)} %` : '—'}
          </div>
        </div>
        <div>
          <div className="text-xs whitespace-nowrap text-(--text-dim)">Plan Exposure</div>
          <div className={`text-lg ${analysis ? 'text-(--text-h)' : 'text-(--text-dim)'}`}>
            {analysis ? `${Math.round(analysis.exposure * 100)} %` : '—'}
          </div>
        </div>
        <div>
          <div className="text-xs whitespace-nowrap text-(--text-dim)">Time to Objective</div>
          <div className={`text-lg ${analysis ? 'text-(--text-h)' : 'text-(--text-dim)'}`}>
            {analysis && analysis.totalEtaMinutes > 0 ? etaRange(analysis.totalEtaMinutes) : '—'}
          </div>
        </div>
        <div>
          <div className="text-xs whitespace-nowrap text-(--text-dim)">Confidence</div>
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

      <div className="flex shrink-0 items-center gap-2">
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
            {simPhase === 'running' ? 'Simulating…' : 'Run Simulation'}
            <div className="text-xs font-normal opacity-80">
              {simPhase === 'running'
                ? `${simResults.length} / ${simRequested}`
                : outcome
                  ? 'View results'
                  : 'Monte Carlo'}
            </div>
          </span>
        </button>
      </div>
    </div>
  )
}
