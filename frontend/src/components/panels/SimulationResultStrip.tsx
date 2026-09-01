import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileText, Play, X } from 'lucide-react'
import { batchOutcome, useSimulation } from '../../state/simulation'
import { fetchReplay } from '../../lib/api'
import { usePlayback } from '../../state/playback'
import { usePlan } from '../../state/plan'

/**
 * The end of a batch, offered where the operator already is.
 *
 * Finishing a run used to drop you nowhere: the modal said "done", and seeing
 * what actually happened meant closing it, finding the Simulations page,
 * finding the batch, and loading the plan back onto its ground — which is the
 * same plan and the same ground already on screen. This closes that loop in one
 * click, without leaving the map.
 */

export function SimulationResultStrip() {
  const phase = useSimulation((s) => s.phase)
  const results = useSimulation((s) => s.results)
  const failures = useSimulation((s) => s.failures)
  const replayPath = useSimulation((s) => s.replayPath)
  const batchId = useSimulation((s) => s.batchId)
  const reset = useSimulation((s) => s.reset)
  const planName = usePlan((s) => s.planName)
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)

  if (phase !== 'done' || results.length === 0) return null

  const outcome = batchOutcome(results)
  const verdict =
    outcome === null
      ? '—'
      : outcome.blueWinRate >= 0.5
        ? 'Blue takes the ground'
        : outcome.inconclusive / outcome.runs > 0.5
          ? 'Undecided'
          : 'Blue fails'

  async function watch() {
    if (!replayPath) return
    setLoading(true)
    try {
      // The plan and its ground are already loaded — this is the batch that was
      // just run against them, so nothing needs restoring.
      const log = await fetchReplay(replayPath)
      usePlayback.getState().open(log, `${planName || 'Run'} — run 1`)
      reset()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="glass pointer-events-auto flex items-center gap-3 rounded-xl px-4 py-2.5">
      <div>
        <div className="text-sm text-(--text-h)">{verdict}</div>
        <div className="text-xs text-(--text-dim)">
          {outcome?.runs ?? 0} run{(outcome?.runs ?? 0) === 1 ? '' : 's'} ·{' '}
          {Math.round((outcome?.blueWinRate ?? 0) * 100)}% blue
          {failures.length > 0 && (
            <span className="text-(--hostile)"> · {failures.length} failed</span>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={() => void watch()}
        disabled={!replayPath || loading}
        className="flex items-center gap-1.5 rounded-md border border-(--accent-border) px-3 py-1.5 text-xs text-(--text-h) transition-colors hover:bg-white/5 disabled:opacity-50"
      >
        <Play className="h-3.5 w-3.5" strokeWidth={1.75} />
        {loading ? 'Loading…' : 'Watch it back'}
      </button>

      <button
        type="button"
        onClick={() => batchId && navigate(`/simulations/${batchId}`)}
        disabled={!batchId}
        className="flex items-center gap-1.5 rounded-md border border-(--border) px-3 py-1.5 text-xs text-(--text) transition-colors hover:border-(--border-strong) hover:text-(--text-h) disabled:opacity-50"
      >
        <FileText className="h-3.5 w-3.5" strokeWidth={1.75} />
        What to change
      </button>

      <button
        type="button"
        title="Dismiss"
        onClick={reset}
        className="rounded-md p-1 text-(--text-dim) transition-colors hover:text-(--text-h)"
      >
        <X className="h-4 w-4" strokeWidth={1.75} />
      </button>
    </div>
  )
}
