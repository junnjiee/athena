import { useEffect, useState } from 'react'
import { AlertTriangle, Ban, Loader2, Radar, Trash2 } from 'lucide-react'
import { Sidebar } from '../components/layout/Sidebar'
import {
  deleteRouteStudy,
  listOperationalAreas,
  listRouteStudies,
} from '../lib/api'
import {
  corridorColor,
  corridorLabel,
  corridorMinutes,
  isChokeBlocked,
  unreachableSummary,
} from '../lib/corridors'
import { useRouteStudy } from '../state/routeStudy'
import type { OperationalAreaMeta, RouteStudySummary } from '../types/routeStudy'

/**
 * The S2 surface: which approaches an enemy reserve can reinforce along.
 *
 * A study stands on an operational area — wide ground with its road network —
 * rather than on a battleground, which is the tactical grid a plan is drawn on.
 */

type ListState =
  | { kind: 'loading' }
  | { kind: 'ready'; studies: RouteStudySummary[]; areas: OperationalAreaMeta[] }
  | { kind: 'error'; message: string }

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

export function RouteStudiesPage() {
  const [state, setState] = useState<ListState>({ kind: 'loading' })
  const [busyId, setBusyId] = useState<string | null>(null)

  const phase = useRouteStudy((s) => s.phase)
  const error = useRouteStudy((s) => s.error)
  const study = useRouteStudy((s) => s.study)
  const load = useRouteStudy((s) => s.load)
  const selectedCorridorId = useRouteStudy((s) => s.selectedCorridorId)
  const selectCorridor = useRouteStudy((s) => s.selectCorridor)
  const renameCorridor = useRouteStudy((s) => s.renameCorridor)
  const toggleChoke = useRouteStudy((s) => s.toggleChoke)

  useEffect(() => {
    let cancelled = false
    Promise.all([listRouteStudies(), listOperationalAreas()])
      .then(([studies, areas]) => {
        if (!cancelled) setState({ kind: 'ready', studies, areas })
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({
            kind: 'error',
            message: err instanceof Error ? err.message : 'failed to load route studies',
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleDelete(id: string) {
    setBusyId(id)
    try {
      await deleteRouteStudy(id)
      setState((prev) =>
        prev.kind === 'ready'
          ? { ...prev, studies: prev.studies.filter((s) => s.id !== id) }
          : prev,
      )
    } finally {
      setBusyId(null)
    }
  }

  const corridors = study?.result.corridors ?? []
  const unreachable = study ? unreachableSummary(study.result, study.marks) : []

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-(--bg) text-(--text)">
      <Sidebar />
      <div className="absolute top-4 right-4 bottom-4 left-60 overflow-y-auto">
        <header className="mb-6">
          <h1 className="flex items-center gap-2 text-xl text-(--text-h)">
            <Radar className="h-5 w-5" strokeWidth={1.75} />
            Route Studies
          </h1>
          <p className="mt-1 text-sm text-(--text-dim)">
            Where an enemy reserve can reinforce from, over real ground.
          </p>
        </header>

        {state.kind === 'loading' && (
          <div className="flex items-center gap-2 text-sm text-(--text-dim)">
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
            Loading…
          </div>
        )}

        {state.kind === 'error' && (
          <div className="glass rounded-xl px-4 py-3 text-sm text-(--hostile)">{state.message}</div>
        )}

        {state.kind === 'ready' && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[20rem_1fr]">
            <section className="flex flex-col gap-3">
              <h2 className="text-xs tracking-wide text-(--text-dim)">STUDIES</h2>
              {state.studies.length === 0 && (
                <div className="glass rounded-xl px-4 py-3 text-sm text-(--text-dim)">
                  {state.areas.length === 0
                    ? 'No operational areas yet. Generate one to study its road network.'
                    : 'No studies yet.'}
                </div>
              )}
              {state.studies.map((summary) => (
                <div
                  key={summary.id}
                  className={`glass flex items-center justify-between gap-2 rounded-xl px-4 py-3 ${
                    study?.id === summary.id ? 'ring-1 ring-(--accent)' : ''
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => void load(summary.id)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="truncate text-sm text-(--text-h)">{summary.name}</div>
                    <div className="text-xs text-(--text-dim)">{formatDate(summary.updatedAt)}</div>
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${summary.name}`}
                    disabled={busyId === summary.id}
                    onClick={() => void handleDelete(summary.id)}
                    className="text-(--text-dim) transition-colors hover:text-(--hostile) disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                  </button>
                </div>
              ))}
            </section>

            <section className="flex flex-col gap-3">
              {!study && (
                <div className="glass rounded-xl px-4 py-3 text-sm text-(--text-dim)">
                  Select a study to see its corridors.
                </div>
              )}

              {error && (
                <div className="glass rounded-xl px-4 py-3 text-sm text-(--hostile)">{error}</div>
              )}

              {study && (
                <>
                  <div className="flex items-baseline justify-between">
                    <h2 className="text-xs tracking-wide text-(--text-dim)">
                      APPROACHES ({corridors.length})
                    </h2>
                    {phase === 'running' && (
                      <span className="flex items-center gap-1.5 text-xs text-(--text-dim)">
                        <Loader2 className="h-3 w-3 animate-spin" strokeWidth={2} />
                        Re-running
                      </span>
                    )}
                  </div>

                  {/* An absent route is a finding. Showing it above the corridors
                      keeps "we found no way in" from reading as "no threat". */}
                  {unreachable.length > 0 && (
                    <div className="glass rounded-xl px-4 py-3">
                      <div className="flex items-center gap-2 text-xs tracking-wide text-(--hostile)">
                        <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2} />
                        NO ROUTE FOUND
                      </div>
                      <ul className="mt-2 space-y-1 text-sm text-(--text-dim)">
                        {unreachable.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {corridors.length === 0 && phase !== 'running' && (
                    <div className="glass rounded-xl px-4 py-3 text-sm text-(--text-dim)">
                      No corridors. Every marked pair is listed above.
                    </div>
                  )}

                  {corridors.map((corridor, index) => {
                    const blocked = isChokeBlocked(corridor, study.edgeOverrides)
                    const canBlock = corridor.choke_edge_ids.length > 0
                    return (
                      <div
                        key={corridor.id}
                        className={`glass rounded-xl px-4 py-3 ${
                          selectedCorridorId === corridor.id ? 'ring-1 ring-(--accent)' : ''
                        }`}
                        onClick={() => selectCorridor(corridor.id)}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className="h-3 w-3 shrink-0 rounded-full"
                            style={{ backgroundColor: corridorColor(index) }}
                          />
                          <input
                            value={corridorLabel(corridor, index, study.corridorEdits)}
                            onChange={(e) => void renameCorridor(corridor.id, e.target.value)}
                            aria-label={`Name for corridor ${index + 1}`}
                            className="min-w-0 flex-1 border-b border-transparent bg-transparent text-sm text-(--text-h) hover:border-(--border) focus:border-(--accent) focus:outline-none"
                          />
                          <span className="shrink-0 text-xs text-(--text-dim)">
                            {corridorMinutes(corridor)} min
                          </span>
                        </div>

                        <div className="mt-2 flex items-center justify-between text-xs text-(--text-dim)">
                          <span>
                            {corridor.routes.length} route
                            {corridor.routes.length === 1 ? '' : 's'}
                            {' · '}
                            {canBlock
                              ? `${corridor.choke_edge_ids.length} choke segment${
                                  corridor.choke_edge_ids.length === 1 ? '' : 's'
                                }`
                              : 'no single choke point'}
                          </span>
                          <button
                            type="button"
                            disabled={!canBlock || phase === 'running'}
                            title={
                              canBlock
                                ? 'Mark this corridor’s choke point impassable and re-run'
                                : 'These routes share no ground, so there is nowhere to block them all at once'
                            }
                            onClick={(e) => {
                              e.stopPropagation()
                              void toggleChoke(corridor)
                            }}
                            className={`flex items-center gap-1.5 rounded-lg px-2 py-1 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                              blocked ? 'text-(--hostile)' : 'hover:text-(--text-h)'
                            }`}
                          >
                            <Ban className="h-3.5 w-3.5" strokeWidth={2} />
                            {blocked ? 'Blocked' : 'Block'}
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
