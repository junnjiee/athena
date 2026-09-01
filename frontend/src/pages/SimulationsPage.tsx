import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Activity, ChevronLeft, Loader2, RefreshCw } from 'lucide-react'
import { Sidebar } from '../components/layout/Sidebar'
import {
  fetchSimulationBatch,
  listSimulationBatches,
  type BatchDetail,
  type BatchSummary,
} from '../lib/api'
import { summarizeBatch, type RunResult } from '../types/replay'
import { ReplayViewer } from '../components/panels/ReplayViewer'

/**
 * Every batch that has ever been run, and what each one concluded.
 *
 * Results used to exist only in the tab that watched them stream: the engine
 * kept replays but not outcomes, and this service kept neither, so closing the
 * browser lost a completed batch. The engine now stores each run's outcome and
 * serves it back, which is what this page reads.
 */

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; batches: BatchSummary[] }
  | { kind: 'error'; message: string }

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function pct(value: number): string {
  return `${Math.round(value * 100)} %`
}

function BatchDetailView({ batchId, onBack }: { batchId: string; onBack: () => void }) {
  const [detail, setDetail] = useState<BatchDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [watching, setWatching] = useState<{ path: string; label: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchSimulationBatch(batchId)
      .then((value) => {
        if (!cancelled) setDetail(value)
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : 'could not load the batch')
        }
      })
    return () => {
      cancelled = true
    }
  }, [batchId])

  const scored = useMemo(
    () => (detail?.runs ?? []).map((run) => run.summary).filter((s): s is RunResult => s !== null),
    [detail],
  )
  const outcome = scored.length > 0 ? summarizeBatch(scored) : null

  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={onBack}
        className="flex w-fit items-center gap-1.5 text-xs text-(--text-dim) transition-colors hover:text-(--text-h)"
      >
        <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
        All simulations
      </button>

      {error && <div className="text-sm text-(--hostile)">{error}</div>}
      {!detail && !error && (
        <Loader2 className="h-4 w-4 animate-spin text-(--text-dim)" strokeWidth={1.75} />
      )}

      {detail && (
        <>
          <div>
            <div className="text-lg text-(--text-h)">{detail.planName ?? 'Unknown plan'}</div>
            <div className="text-xs text-(--text-dim)">
              {detail.simulationCount} runs · {detail.ticks} ticks ·{' '}
              {detail.soldiers ?? '—'} soldiers · {detail.model ?? 'default model'} ·{' '}
              {formatDate(detail.createdAt)}
            </div>
          </div>

          {outcome && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ['Blue win rate', pct(outcome.blueWinRate)],
                ['Runs scored', String(outcome.runs)],
                ['Mean blue losses', outcome.meanBlueLosses.toFixed(1)],
                ['Mean red losses', outcome.meanRedLosses.toFixed(1)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg bg-black/20 p-3">
                  <div className="text-xs text-(--text-dim)">{label}</div>
                  <div className="text-lg tabular-nums text-(--text-h)">{value}</div>
                </div>
              ))}
            </div>
          )}

          {outcome && outcome.inconclusive / outcome.runs > 0.5 && (
            <div className="rounded-lg border border-(--border) bg-black/20 p-3 text-xs text-(--text)">
              Over half of these runs ended with both sides alive. A soldier covers
              a few cells a tick, less over slow ground, so forces drawn hundreds of
              metres apart still need a bigger tick budget to reach each other.
            </div>
          )}

          <div className="overflow-x-auto rounded-lg border border-(--border)">
            <table className="w-full text-left text-xs">
              <thead className="text-(--text-dim)">
                <tr>
                  {['Run', 'Outcome', 'Ticks', 'Blue', 'Red', 'Shots', 'Hits'].map((h) => (
                    <th key={h} className="px-3 py-2 font-normal">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="text-(--text)">
                {detail.runs.map((run) => (
                  <tr
                    key={run.simulationId}
                    onClick={() =>
                      run.replayPath &&
                      setWatching({
                        path: run.replayPath,
                        label: `${detail.planName ?? 'Run'} — run ${run.simulationIndex + 1}`,
                      })
                    }
                    className={`border-t border-(--border) ${
                      run.replayPath ? 'cursor-pointer transition-colors hover:bg-white/5' : ''
                    }`}
                  >
                    <td className="px-3 py-2 tabular-nums">{run.simulationIndex + 1}</td>
                    <td className="px-3 py-2">
                      {run.status === 'failed' ? (
                        <span className="text-(--hostile)" title={run.error ?? undefined}>
                          failed
                        </span>
                      ) : (
                        (run.summary?.outcome ?? '—')
                      )}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{run.summary?.ticks ?? '—'}</td>
                    <td className="px-3 py-2 tabular-nums">
                      {run.summary ? `${run.summary.blueAlive} (−${run.summary.blueLosses})` : '—'}
                    </td>
                    <td className="px-3 py-2 tabular-nums">
                      {run.summary ? `${run.summary.redAlive} (−${run.summary.redLosses})` : '—'}
                    </td>
                    <td className="px-3 py-2 tabular-nums">{run.summary?.shotsFired ?? '—'}</td>
                    <td className="px-3 py-2 tabular-nums">{run.summary?.hits ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="text-[11px] text-(--text-dim)">
            Select a run to watch it back.
          </div>
        </>
      )}

      {watching && (
        <ReplayViewer
          replayPath={watching.path}
          label={watching.label}
          onClose={() => setWatching(null)}
        />
      )}
    </div>
  )
}

export function SimulationsPage() {
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [selected, setSelected] = useState<string | null>(null)
  const navigate = useNavigate()
  /** Bumped by the refresh button to re-run the load effect. */
  const [reloads, setReloads] = useState(0)

  useEffect(() => {
    let cancelled = false
    listSimulationBatches()
      .then((batches) => {
        if (!cancelled) setState({ kind: 'ready', batches })
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            kind: 'error',
            message: error instanceof Error ? error.message : 'could not load simulations',
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [reloads])

  function refresh() {
    setState({ kind: 'loading' })
    setReloads((count) => count + 1)
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-(--bg)">
      <Sidebar />
      <main className="absolute inset-y-4 right-4 left-60 overflow-auto rounded-2xl">
        <div className="glass-deep min-h-full rounded-2xl p-6">
          <div className="mb-5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-(--text-h)" strokeWidth={1.75} />
              <span className="text-sm tracking-widest text-(--text-h)">SIMULATIONS</span>
              {state.kind === 'ready' && (
                <span className="text-xs text-(--text-dim)">({state.batches.length})</span>
              )}
            </div>
            <button
              type="button"
              onClick={refresh}
              title="Refresh"
              className="rounded-md p-1.5 text-(--text-dim) transition-colors hover:text-(--text-h)"
            >
              <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.75} />
            </button>
          </div>

          {selected ? (
            <BatchDetailView key={selected} batchId={selected} onBack={() => setSelected(null)} />
          ) : (
            <>
              {state.kind === 'loading' && (
                <Loader2 className="h-4 w-4 animate-spin text-(--text-dim)" strokeWidth={1.75} />
              )}
              {state.kind === 'error' && (
                <div className="text-sm text-(--hostile)">{state.message}</div>
              )}
              {state.kind === 'ready' && state.batches.length === 0 && (
                <div className="text-sm text-(--text-dim)">
                  No simulations yet. Draw a plan, save it, and run one from the bottom bar.
                </div>
              )}
              {state.kind === 'ready' && state.batches.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs text-(--text-dim)">
                      <tr>
                        {['Plan', 'Run', 'Scale', 'Status', 'Result'].map((h) => (
                          <th key={h} className="px-3 py-2 font-normal">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {state.batches.map((batch) => (
                        <tr
                          key={batch.batchId}
                          onClick={() => navigate(`/simulations/${batch.batchId}`)}
                          className="cursor-pointer border-t border-(--border) transition-colors hover:bg-white/5"
                        >
                          <td className="px-3 py-3 text-(--text-h)">{batch.planName}</td>
                          <td className="px-3 py-3 text-xs text-(--text-dim)">
                            {formatDate(batch.createdAt)}
                          </td>
                          <td className="px-3 py-3 text-xs text-(--text-dim)">
                            {batch.simulationCount} × {batch.ticks} ticks · {batch.soldiers} soldiers
                          </td>
                          <td className="px-3 py-3 text-xs">
                            <span
                              className={
                                batch.failed > 0 ? 'text-(--hostile)' : 'text-(--text-dim)'
                              }
                            >
                              {batch.status}
                              {batch.failed > 0 && ` · ${batch.failed} failed`}
                            </span>
                          </td>
                          <td className="px-3 py-3 text-xs">
                            <BatchProgress batch={batch} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  )
}

/** The list shows how far a batch got; the win rate needs per-run outcomes,
 *  which are one request deeper. Opening a row fetches them. */
function BatchProgress({ batch }: { batch: BatchSummary }) {
  const done = batch.completed + batch.failed
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full bg-(--accent)"
          style={{
            width: `${batch.simulationCount === 0 ? 0 : (done / batch.simulationCount) * 100}%`,
          }}
        />
      </div>
      <span className="tabular-nums text-(--text-dim)">
        {done}/{batch.simulationCount}
      </span>
    </div>
  )
}
