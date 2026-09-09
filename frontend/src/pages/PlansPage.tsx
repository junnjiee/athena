import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ClipboardList, Copy, Loader2, MapPin, Pencil, Search, Trash2, X } from 'lucide-react'
import { Sidebar } from '../components/layout/Sidebar'
import { deletePlan, duplicatePlan, fetchPlan, listPlans, renamePlan } from '../lib/api'
import { useBattleground } from '../state/battleground'
import { usePlan } from '../state/plan'
import { useMission } from '../state/mission'
import { filterPlans, sortPlans, SORT_LABELS, type SortKey } from '../lib/planSort'
import type { PlanSummary } from '../types/plan'
import { useRailOffset } from '../state/shell'

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; plans: PlanSummary[] }
  | { kind: 'error'; message: string }

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function PlansPage() {
  const railOffset = useRailOffset()
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [busyId, setBusyId] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('updated')
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
        if (!cancelled) {
          setState({
            kind: 'error',
            message: error instanceof Error ? error.message : 'failed to load plans',
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  const visible = useMemo(
    () => (state.kind === 'ready' ? sortPlans(filterPlans(state.plans, query), sortKey) : []),
    [state, query, sortKey],
  )

  function fail(error: unknown, fallback: string) {
    setState({ kind: 'error', message: error instanceof Error ? error.message : fallback })
  }

  async function refresh() {
    setState({ kind: 'ready', plans: await listPlans() })
  }

  async function handleDelete(id: string, name: string) {
    if (!window.confirm(`Delete "${name}"? This can't be undone.`)) return
    setBusyId(id)
    try {
      await deletePlan(id)
      setState((prev) =>
        prev.kind === 'ready' ? { kind: 'ready', plans: prev.plans.filter((p) => p.id !== id) } : prev,
      )
    } catch (error: unknown) {
      fail(error, 'failed to delete plan')
    } finally {
      setBusyId(null)
    }
  }

  async function handleDuplicate(id: string) {
    setBusyId(id)
    try {
      await duplicatePlan(id)
      await refresh()
    } catch (error: unknown) {
      fail(error, 'failed to duplicate plan')
    } finally {
      setBusyId(null)
    }
  }

  async function commitRename(id: string) {
    const name = draftName.trim()
    setRenamingId(null)
    if (name === '') return
    setBusyId(id)
    try {
      await renamePlan(id, name)
      setState((prev) =>
        prev.kind === 'ready'
          ? { kind: 'ready', plans: prev.plans.map((p) => (p.id === id ? { ...p, name } : p)) }
          : prev,
      )
    } catch (error: unknown) {
      fail(error, 'failed to rename plan')
    } finally {
      setBusyId(null)
    }
  }

  async function handleLoad(id: string) {
    setBusyId(id)
    try {
      const saved = await fetchPlan(id)
      loadSaved(saved.meta, saved.grid, saved.features)
      // Restore the mission window alongside the drawing; the forecast itself
      // is re-fetched for this battleground by the panel's own effect.
      useMission.setState({ hHour: saved.plan.hHour })
      seedFromSaved({
        id: saved.plan.id,
        name: saved.plan.name,
        groundName: saved.meta.name,
        units: saved.plan.units,
        objectives: saved.plan.objectives,
        routes: saved.plan.routes,
      })
      navigate('/')
    } catch (error: unknown) {
      setBusyId(null)
      fail(error, 'failed to load plan')
    }
  }

  const busy = busyId !== null

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-(--bg) text-(--text)">
      <Sidebar />
      <div className={`absolute top-4 right-4 bottom-4 ${railOffset}`}>
        <div className="glass-deep flex h-full flex-col rounded-2xl p-6">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-sm tracking-wide text-(--text-dim)">
              <ClipboardList className="h-4 w-4" strokeWidth={1.75} />
              SAVED PLANS
              {state.kind === 'ready' && (
                <span className="text-(--text-dim)">
                  ({visible.length}
                  {visible.length !== state.plans.length && ` of ${state.plans.length}`})
                </span>
              )}
            </div>

            {state.kind === 'ready' && state.plans.length > 0 && (
              <div className="flex items-center gap-2">
                <div className="glass flex items-center gap-2 rounded-lg px-2.5 py-1.5">
                  <Search className="h-3.5 w-3.5 text-(--text-dim)" strokeWidth={1.75} />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search plans or ground…"
                    aria-label="Search plans"
                    className="w-52 bg-transparent text-xs text-(--text-h) placeholder:text-(--text-dim) focus:outline-none"
                  />
                  {query !== '' && (
                    <button
                      type="button"
                      onClick={() => setQuery('')}
                      title="Clear search"
                      className="text-(--text-dim) transition-colors hover:text-(--text-h)"
                    >
                      <X className="h-3.5 w-3.5" strokeWidth={1.75} />
                    </button>
                  )}
                </div>
                <select
                  value={sortKey}
                  onChange={(e) => setSortKey(e.target.value as SortKey)}
                  aria-label="Sort plans"
                  className="glass rounded-lg px-2.5 py-2 text-xs text-(--text) focus:outline-none"
                >
                  {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                    <option key={key} value={key} className="bg-(--panel-bg-solid)">
                      {SORT_LABELS[key]}
                    </option>
                  ))}
                </select>
              </div>
            )}
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

          {state.kind === 'ready' && state.plans.length > 0 && visible.length === 0 && (
            <div className="text-sm text-(--text-dim)">No plans match "{query}".</div>
          )}

          {visible.length > 0 && (
            <div className="flex flex-col gap-2 overflow-y-auto">
              {visible.map((plan) => (
                <div
                  key={plan.id}
                  className="glass flex items-center justify-between gap-4 rounded-xl px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    {renamingId === plan.id ? (
                      <input
                        autoFocus
                        value={draftName}
                        onChange={(e) => setDraftName(e.target.value)}
                        onBlur={() => void commitRename(plan.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void commitRename(plan.id)
                          if (e.key === 'Escape') setRenamingId(null)
                        }}
                        aria-label="Plan name"
                        className="w-full border-b border-(--accent) bg-transparent text-sm text-(--text-h) focus:outline-none"
                      />
                    ) : (
                      <div className="truncate text-sm text-(--text-h)">{plan.name}</div>
                    )}
                    <div className="flex items-center gap-1.5 text-xs text-(--text-dim)">
                      <MapPin className="h-3 w-3" strokeWidth={1.75} />
                      {plan.battlegroundName} · edited {formatDate(plan.updatedAt)}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      title="Rename"
                      disabled={busy}
                      onClick={() => {
                        setRenamingId(plan.id)
                        setDraftName(plan.name)
                      }}
                      className="rounded-xl p-2 text-(--text-dim) transition-colors hover:text-(--text-h) disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Pencil className="h-4 w-4" strokeWidth={1.75} />
                    </button>
                    <button
                      type="button"
                      title="Duplicate"
                      disabled={busy}
                      onClick={() => void handleDuplicate(plan.id)}
                      className="rounded-xl p-2 text-(--text-dim) transition-colors hover:text-(--text-h) disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {busyId === plan.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
                      ) : (
                        <Copy className="h-4 w-4" strokeWidth={1.75} />
                      )}
                    </button>
                    <button
                      type="button"
                      title="Delete"
                      disabled={busy}
                      onClick={() => void handleDelete(plan.id, plan.name)}
                      className="rounded-xl p-2 text-(--text-dim) transition-colors hover:text-(--hostile) disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleLoad(plan.id)}
                      className="ml-1 rounded-xl bg-(--accent) px-4 py-2 text-sm font-medium text-(--panel-bg-solid) transition-colors hover:bg-(--accent-hover) disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-(--text-dim)"
                    >
                      {busyId === plan.id ? 'Loading…' : 'Load'}
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
