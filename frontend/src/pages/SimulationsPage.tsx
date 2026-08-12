import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Activity, FileUp, Loader2, MapPin, Trash2 } from 'lucide-react'
import { Sidebar } from '../components/layout/Sidebar'
import { ImportReplayModal } from '../components/panels/ImportReplayModal'
import { deleteReplay, listReplays } from '../lib/api'
import { useReplay } from '../state/replay'
import type { SimulationRunSummary } from '../types/replayLog'

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; runs: SimulationRunSummary[] }
  | { kind: 'error'; message: string }

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function SimulationsPage() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [busyId, setBusyId] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const load = useReplay((s) => s.load)
  const navigate = useNavigate()

  useEffect(() => {
    let cancelled = false
    listReplays()
      .then((runs) => {
        if (!cancelled) setState({ kind: 'ready', runs })
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setState({
            kind: 'error',
            message: error instanceof Error ? error.message : 'failed to load simulation runs',
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  function fail(error: unknown, fallback: string) {
    setState({ kind: 'error', message: error instanceof Error ? error.message : fallback })
  }

  async function handleDelete(id: string, name: string) {
    if (!window.confirm(`Delete "${name}"? This can't be undone.`)) return
    setBusyId(id)
    try {
      await deleteReplay(id)
      setState((prev) =>
        prev.kind === 'ready' ? { kind: 'ready', runs: prev.runs.filter((r) => r.id !== id) } : prev,
      )
    } catch (error: unknown) {
      fail(error, 'failed to delete simulation run')
    } finally {
      setBusyId(null)
    }
  }

  async function handleLoad(id: string) {
    setBusyId(id)
    try {
      await load(id)
      navigate('/')
    } catch (error: unknown) {
      setBusyId(null)
      fail(error, 'failed to load simulation run')
    }
  }

  const busy = busyId !== null

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-(--bg) text-(--text)">
      <Sidebar />
      <div className="absolute top-4 right-4 bottom-4 left-60">
        <div className="glass-deep flex h-full flex-col rounded-2xl p-6">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-sm tracking-wide text-(--text-dim)">
              <Activity className="h-4 w-4" strokeWidth={1.75} />
              SIMULATION RUNS
              {state.kind === 'ready' && <span className="text-(--text-dim)">({state.runs.length})</span>}
            </div>
            <button
              type="button"
              onClick={() => setImportOpen(true)}
              className="flex items-center gap-2 rounded-xl bg-(--accent) px-4 py-2 text-sm font-medium text-(--panel-bg-solid) transition-colors hover:bg-(--accent-hover)"
            >
              <FileUp className="h-4 w-4" strokeWidth={1.75} />
              Import Replay
            </button>
          </div>

          {state.kind === 'loading' && (
            <div className="flex items-center gap-2 text-sm text-(--text-dim)">
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
              Loading…
            </div>
          )}

          {state.kind === 'error' && <div className="text-sm text-(--hostile)">{state.message}</div>}

          {state.kind === 'ready' && state.runs.length === 0 && (
            <div className="text-sm text-(--text-dim)">
              No simulation runs imported yet — run a plan through the engine externally, then click "Import
              Replay" to bring the result back in.
            </div>
          )}

          {state.kind === 'ready' && state.runs.length > 0 && (
            <div className="flex flex-col gap-2 overflow-y-auto">
              {state.runs.map((run) => (
                <div
                  key={run.id}
                  className="glass flex items-center justify-between gap-4 rounded-xl px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-(--text-h)">{run.name}</div>
                    <div className="flex items-center gap-1.5 text-xs text-(--text-dim)">
                      <MapPin className="h-3 w-3" strokeWidth={1.75} />
                      {run.battlegroundName} · {run.stepCount} steps · {run.soldierCount} soldiers · imported{' '}
                      {formatDate(run.createdAt)}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      title="Delete"
                      disabled={busy}
                      onClick={() => void handleDelete(run.id, run.name)}
                      className="rounded-xl p-2 text-(--text-dim) transition-colors hover:text-(--hostile) disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleLoad(run.id)}
                      className="ml-1 rounded-xl bg-(--accent) px-4 py-2 text-sm font-medium text-(--panel-bg-solid) transition-colors hover:bg-(--accent-hover) disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-(--text-dim)"
                    >
                      {busyId === run.id ? 'Loading…' : 'Load'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <ImportReplayModal open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  )
}
