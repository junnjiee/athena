import { Play, TrendingUp } from 'lucide-react'

interface Props {
  canRunSimulation: boolean
}

export function BottomBar({ canRunSimulation }: Props) {
  return (
    <div className="flex h-20 shrink-0 items-center justify-between border-t border-(--border) bg-(--panel-bg-solid) px-6">
      <div>
        <div className="text-xs tracking-wide text-(--text-dim)">CURRENT PLAN</div>
        <div className="text-sm text-(--text-h)">
          {canRunSimulation ? 'Untitled Plan' : 'No ground selected'}
        </div>
        <div className="text-xs text-(--text-dim)">
          {canRunSimulation ? 'Not run yet' : 'Select an area to begin'}
        </div>
      </div>

      <div className="flex items-center gap-10">
        <div>
          <div className="text-xs tracking-wide text-(--text-dim)">ESTIMATED OUTCOME (500 RUNS)</div>
          <div className="text-xl font-medium text-(--text-dim)">—</div>
        </div>
        <div>
          <div className="text-xs text-(--text-dim)">Casualties (Friendly)</div>
          <div className="text-lg text-(--text-dim)">—</div>
        </div>
        <div>
          <div className="text-xs text-(--text-dim)">Time to Objective</div>
          <div className="text-lg text-(--text-dim)">—</div>
        </div>
        <div>
          <div className="text-xs text-(--text-dim)">Confidence</div>
          <div className="flex items-center gap-1 text-lg text-(--text-dim)">
            <TrendingUp className="h-4 w-4" strokeWidth={1.75} />
            —
          </div>
        </div>
      </div>

      <button
        type="button"
        disabled={!canRunSimulation}
        className="flex items-center gap-2 rounded-md bg-(--accent) px-5 py-3 text-sm font-medium text-(--panel-bg-solid) transition-colors hover:bg-(--accent-hover) disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-(--text-dim)"
      >
        <Play className="h-4 w-4" strokeWidth={2} />
        <span className="text-left leading-tight">
          Run Simulation
          <div className="text-xs font-normal opacity-80">500 Runs</div>
        </span>
      </button>
    </div>
  )
}
