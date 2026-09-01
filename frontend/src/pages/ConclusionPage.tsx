import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  AlertTriangle,
  ChevronLeft,
  Info,
  Loader2,
  Map,
  MessageSquare,
  Play,
  TriangleAlert,
} from 'lucide-react'
import { Sidebar } from '../components/layout/Sidebar'
import { ReplayViewer } from '../components/panels/ReplayViewer'
import {
  fetchPlanDiagnostics,
  fetchReplay,
  fetchSimulationBatch,
  type BatchDetail,
  type ImportDiagnostics,
} from '../lib/api'
import {
  buildRecommendations,
  type Recommendation,
  type RecommendationSeverity,
} from '../lib/recommendations'
import { summarizeBatch, type ReplayLog, type RunResult } from '../types/replay'
import { FRIENDLY_HEX, HOSTILE_HEX } from '../lib/colors'
import { fetchPlan } from '../lib/api'
import { useBattleground } from '../state/battleground'
import { usePlan } from '../state/plan'
import { useMission } from '../state/mission'
import { usePlayback } from '../state/playback'
import { buildPathDensity } from '../lib/replayGeo'

/**
 * What a batch concluded, why, and what to do about it.
 *
 * The Simulations list answers "what did I run"; this answers "so what". It
 * carries the verdict with its confidence interval, the ground as it was
 * actually fought over, what each section commander said it was doing, and a
 * ranked list of changes with the evidence that produced them.
 */

const SEVERITY_STYLE: Record<
  RecommendationSeverity,
  { icon: typeof AlertTriangle; className: string }
> = {
  critical: { icon: TriangleAlert, className: 'text-(--hostile)' },
  warning: { icon: AlertTriangle, className: 'text-amber-400' },
  note: { icon: Info, className: 'text-(--text-dim)' },
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`
}

function Card({
  title,
  children,
  className = '',
}: {
  title: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={`glass flex flex-col gap-3 rounded-xl p-4 ${className}`}>
      <div className="text-xs tracking-wide text-(--text-dim)">{title}</div>
      {children}
    </section>
  )
}

function RecommendationRow({
  recommendation,
  onApply,
}: {
  recommendation: Recommendation
  onApply: (fix: NonNullable<Recommendation['fix']>) => void
}) {
  const { icon: Icon, className } = SEVERITY_STYLE[recommendation.severity]
  return (
    <div className="flex items-start gap-3 rounded-lg border border-(--border) bg-black/20 p-3">
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${className}`} strokeWidth={1.75} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="text-sm text-(--text-h)">{recommendation.title}</div>
        <div className="text-xs text-(--text-dim)">{recommendation.evidence}</div>
        <div className="text-xs text-(--text)">{recommendation.action}</div>
        {recommendation.fix && (
          <button
            type="button"
            onClick={() => onApply(recommendation.fix!)}
            className="mt-1 w-fit rounded-md border border-(--accent-border) px-2.5 py-1 text-xs text-(--text-h) transition-colors hover:bg-white/5"
          >
            {recommendation.fix.kind === 'ticks'
              ? `Re-run with ${recommendation.fix.ticks} ticks`
              : `Re-run with ${recommendation.fix.runs} runs`}
          </button>
        )}
      </div>
    </div>
  )
}

export function ConclusionPage() {
  const { batchId = '' } = useParams()
  const navigate = useNavigate()
  const [detail, setDetail] = useState<BatchDetail | null>(null)
  const [replay, setReplay] = useState<ReplayLog | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [watching, setWatching] = useState(false)
  const [diagnostics, setDiagnostics] = useState<ImportDiagnostics | null>(null)
  const [loadingMap, setLoadingMap] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetchSimulationBatch(batchId)
      .then((value) => {
        if (cancelled) return
        setDetail(value)
        // One representative run, for the ground and the reasoning. The verdict
        // comes from every run's stored outcome, which needs no replay at all.
        const first = value.runs.find((run) => run.replayPath)
        if (first?.replayPath) {
          void fetchReplay(first.replayPath).then((log) => {
            if (!cancelled) setReplay(log)
          })
        }
        // Whether the plan was even possible. If it was not, every other
        // finding on this page is describing a run that proved nothing.
        if (value.planId) {
          void fetchPlanDiagnostics(value.planId)
            .then((found) => {
              if (!cancelled) setDiagnostics(found)
            })
            .catch(() => undefined)
        }
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
    () =>
      (detail?.runs ?? [])
        .map((run) => run.summary)
        .filter((summary): summary is RunResult => summary !== null),
    [detail],
  )
  const outcome = scored.length > 0 ? summarizeBatch(scored) : null

  const recommendations = useMemo(
    () =>
      outcome
        ? buildRecommendations({
            outcome,
            ticks: detail?.ticks ?? 0,
            replay,
            objectiveReachable: diagnostics?.blueObjectiveReachable,
          })
        : [],
    [outcome, detail, replay, diagnostics],
  )

  /** Commander decisions across the representative run, newest first. */
  const reasoning = useMemo(() => {
    if (!replay) return []
    return replay.steps
      .flatMap((step) =>
        (step.decisions ?? []).map((decision) => ({ tick: step.step, ...decision })),
      )
      .reverse()
  }, [replay])

  /** Restore the plan onto its ground, load the run, and go and watch it there.
   *  A run means little without the ground it crossed. */
  async function watchOnMap() {
    if (!detail?.planId || !replay) return
    setLoadingMap(true)
    try {
      const saved = await fetchPlan(detail.planId)

      // Every run, not just the one being watched: "where does this plan take
      // people" is a question about the batch. Capped because each replay is a
      // real download and the shape of the answer settles quickly.
      const paths = detail.runs
        .map((run) => run.replayPath)
        .filter((path): path is string => path !== null)
        .slice(0, 12)
      const replays = (
        await Promise.all(
          paths.map((path) => fetchReplay(path).catch(() => null)),
        )
      ).filter((log): log is ReplayLog => log !== null)
      const density = replays.length
        ? buildPathDensity(saved.grid, replays)
        : null

      useBattleground.getState().loadSaved(saved.meta, saved.grid, saved.features)
      useMission.setState({ hHour: saved.plan.hHour })
      usePlan.getState().seedFromSaved({
        id: saved.plan.id,
        name: saved.plan.name,
        groundName: saved.meta.name,
        units: saved.plan.units,
        objectives: saved.plan.objectives,
        routes: saved.plan.routes,
      })
      usePlayback
        .getState()
        .open(replay, `${detail.planName ?? 'Run'} — run 1`, density)
      navigate('/')
    } catch (cause: unknown) {
      setLoadingMap(false)
      setError(cause instanceof Error ? cause.message : 'could not open the battleground')
    }
  }

  function applyFix(fix: NonNullable<Recommendation['fix']>) {
    // The plan is edited on the battleground screen, so hand the operator back
    // there with the suggested settings rather than silently re-running.
    const query =
      fix.kind === 'ticks' ? `ticks=${fix.ticks}` : `runs=${fix.runs}`
    navigate(`/?plan=${detail?.planId ?? ''}&${query}`)
  }

  const verdict = outcome
    ? outcome.blueWinRate >= 0.5
      ? 'This plan works'
      : outcome.inconclusive / outcome.runs > 0.5
        ? 'Inconclusive'
        : 'This plan fails'
    : '—'

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-(--bg)">
      <Sidebar />
      <main className="absolute inset-y-4 right-4 left-60 overflow-auto rounded-2xl">
        <div className="glass-deep flex min-h-full flex-col gap-4 rounded-2xl p-6">
          <button
            type="button"
            onClick={() => navigate('/simulations')}
            className="flex w-fit items-center gap-1.5 text-xs text-(--text-dim) transition-colors hover:text-(--text-h)"
          >
            <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.75} />
            All simulations
          </button>

          {error && <div className="text-sm text-(--hostile)">{error}</div>}
          {!detail && !error && (
            <Loader2 className="h-4 w-4 animate-spin text-(--text-dim)" strokeWidth={1.75} />
          )}

          {detail && outcome && (
            <>
              <div>
                <div className="text-2xl text-(--text-h)">{verdict}</div>
                <div className="text-xs text-(--text-dim)">
                  {detail.planName ?? 'Unknown plan'} · {outcome.runs} runs ·{' '}
                  {detail.ticks} ticks · {detail.soldiers ?? '—'} soldiers
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <Card title="BLUE WIN RATE">
                  <div className="text-3xl tabular-nums text-(--text-h)">
                    {pct(outcome.blueWinRate)}
                  </div>
                  <div className="text-xs text-(--text-dim)">
                    95% confidence {pct(outcome.blueWinRateLow)} –{' '}
                    {pct(outcome.blueWinRateHigh)}
                  </div>
                  <div className="flex h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full bg-(--accent)"
                      style={{ width: `${outcome.blueWinRate * 100}%` }}
                    />
                  </div>
                </Card>
                <Card title="COST">
                  <div className="text-sm text-(--text-h)">
                    <span style={{ color: FRIENDLY_HEX }}>
                      −{outcome.meanBlueLosses.toFixed(1)}
                    </span>{' '}
                    blue ·{' '}
                    <span style={{ color: HOSTILE_HEX }}>
                      −{outcome.meanRedLosses.toFixed(1)}
                    </span>{' '}
                    red
                  </div>
                  <div className="text-xs text-(--text-dim)">
                    average losses a run, over {outcome.meanTicks.toFixed(0)} ticks
                  </div>
                </Card>
                <Card title="SPREAD">
                  <div className="text-sm text-(--text-h)">
                    {outcome.blueWins} blue · {outcome.redWins} red ·{' '}
                    {outcome.inconclusive} undecided
                  </div>
                  <div className="text-xs text-(--text-dim)">
                    seeded, so any run can be reproduced exactly
                  </div>
                </Card>
              </div>

              <Card title="WHAT TO CHANGE">
                {recommendations.length === 0 ? (
                  <div className="text-xs text-(--text-dim)">
                    Nothing stands out. The plan holds up over these runs.
                  </div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {recommendations.map((recommendation) => (
                      <RecommendationRow
                        key={recommendation.id}
                        recommendation={recommendation}
                        onApply={applyFix}
                      />
                    ))}
                  </div>
                )}
              </Card>

              <Card title="THE GROUND, AS IT WAS FOUGHT">
                {replay ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void watchOnMap()}
                      disabled={loadingMap}
                      className="flex w-fit items-center gap-2 rounded-md border border-(--accent-border) px-3 py-1.5 text-xs text-(--text-h) transition-colors hover:bg-white/5 disabled:opacity-50"
                    >
                      <Map className="h-3.5 w-3.5" strokeWidth={1.75} />
                      {loadingMap ? 'Opening the battleground…' : 'Watch on the battleground'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setWatching(true)}
                      className="flex w-fit items-center gap-2 rounded-md border border-(--border) px-3 py-1.5 text-xs text-(--text) transition-colors hover:border-(--border-strong) hover:text-(--text-h)"
                    >
                      <Play className="h-3.5 w-3.5" strokeWidth={1.75} />
                      Quick view
                    </button>
                  </div>
                ) : (
                  <div className="text-xs text-(--text-dim)">Loading the run…</div>
                )}
              </Card>

              <Card title="WHAT THE COMMANDERS WERE THINKING">
                {reasoning.length === 0 ? (
                  <div className="text-xs text-(--text-dim)">
                    No reasoning recorded — this batch ran before agents reported it,
                    or every soldier followed the section policy.
                  </div>
                ) : (
                  <div className="flex max-h-80 flex-col gap-1 overflow-y-auto pr-1">
                    {reasoning.map((entry, index) => (
                      <div
                        key={`${entry.tick}-${entry.soldier_index}-${index}`}
                        className="flex items-start gap-2 rounded-md px-1.5 py-1.5 text-xs hover:bg-white/5"
                      >
                        <MessageSquare
                          className="mt-0.5 h-3 w-3 shrink-0 text-(--text-dim)"
                          strokeWidth={1.75}
                        />
                        <div className="min-w-0">
                          <span className="text-(--text-dim) tabular-nums">
                            t{entry.tick}
                          </span>{' '}
                          <span className="text-(--text-dim)">
                            #{entry.soldier_index}
                          </span>{' '}
                          <span className="text-(--text-h)">{entry.action}</span>
                          <div className="text-(--text)">{entry.rationale}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </>
          )}
        </div>
      </main>

      {watching && detail && (
        <ReplayViewer
          replayPath={detail.runs.find((run) => run.replayPath)?.replayPath ?? ''}
          label={`${detail.planName ?? 'Run'} — representative run`}
          onClose={() => setWatching(false)}
        />
      )}
    </div>
  )
}
