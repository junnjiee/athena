import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ClipboardList, Loader2, MapPin, Trash2 } from 'lucide-react'
import { Sidebar } from '../components/layout/Sidebar'
import { deletePlan, fetchPlan, listPlans } from '../lib/api'
import { useBattleground } from '../state/battleground'
import { usePlan } from '../state/plan'
import type { PlanSummary } from '../types/plan'

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; plans: PlanSummary[] }
  | { kind: 'error'; message: string }

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

export function PlansPage() {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const loadSaved = useBattleground((s) => s.loadSaved)
  const seedFromSaved = usePlan((s) => s.seedFromSaved)
  const navigate = useNavigate()

  useEffect(() => {
    let cancelled = false
    listPlans()
      .then((plans) => {
        if (!cancelled) setState({ kind: 'ready', plans })
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ kind: 'error', message: error instanceof Error ? error.message : 'failed to load plans' })
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleDelete(id: string, name: string) {
    if (!window.confirm(`Delete "${name}"? This can't be undone.`)) return
    setDeletingId(id)
    try {
      await deletePlan(id)
      setState((prev) =>
        prev.kind === 'ready' ? { kind: 'ready', plans: prev.plans.filter((p) => p.id !== id) } : prev,
      )
    } catch (error: unknown) {
      setState({ kind: 'error', message: error instanceof Error ? error.message : 'failed to delete plan' })
    } finally {
      setDeletingId(null)
    }
  }

  async function handleLoad(id: string) {
    setLoadingId(id)
    try {
      const saved = await fetchPlan(id)
      loadSaved(saved.meta, saved.grid, saved.features)
      seedFromSaved({
        name: saved.plan.name,
        units: saved.plan.units,
        objectives: saved.plan.objectives,
        routes: saved.plan.routes,
      })
      navigate('/')
    } catch (error: unknown) {
      setLoadingId(null)
      setState({ kind: 'error', message: error instanceof Error ? error.message : 'failed to load plan' })
    }
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-(--bg) text-(--text)">
      <Sidebar />
      <div className="absolute top-4 right-4 bottom-4 left-60">
        <div className="glass-deep flex h-full flex-col rounded-2xl p-6">
          <div className="mb-4 flex items-center gap-2 text-sm tracking-wide text-(--text-dim)">
            <ClipboardList className="h-4 w-4" strokeWidth={1.75} />
            SAVED PLANS
          </div>

          {state.kind === 'loading' && (
            <div className="flex items-center gap-2 text-sm text-(--text-dim)">
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
              Loading…
            </div>
          )}

          {state.kind === 'error' && <div className="text-sm text-(--hostile)">{state.message}</div>}

          {state.kind === 'ready' && state.plans.length === 0 && (
            <div className="text-sm text-(--text-dim)">
              No plans saved yet — generate a battleground, draw a plan, and click "Save Plan."
            </div>
          )}

          {state.kind === 'ready' && state.plans.length > 0 && (
            <div className="flex flex-col gap-2 overflow-y-auto">
              {state.plans.map((plan) => (
                <div
                  key={plan.id}
                  className="glass flex items-center justify-between gap-4 rounded-xl px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm text-(--text-h)">{plan.name}</div>
                    <div className="flex items-center gap-1.5 text-xs text-(--text-dim)">
                      <MapPin className="h-3 w-3" strokeWidth={1.75} />
                      {plan.battlegroundName} · {formatDate(plan.createdAt)}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      title="Delete"
                      disabled={loadingId !== null || deletingId !== null}
                      onClick={() => handleDelete(plan.id, plan.name)}
                      className="rounded-xl p-2 text-(--text-dim) transition-colors hover:text-(--hostile) disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {deletingId === plan.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
                      ) : (
                        <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                      )}
                    </button>
                    <button
                      type="button"
                      disabled={loadingId !== null || deletingId !== null}
                      onClick={() => handleLoad(plan.id)}
                      className="rounded-xl bg-(--accent) px-4 py-2 text-sm font-medium text-(--panel-bg-solid) transition-colors hover:bg-(--accent-hover) disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-(--text-dim)"
                    >
                      {loadingId === plan.id ? 'Loading…' : 'Load'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
