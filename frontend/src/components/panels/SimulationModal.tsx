import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Play, TriangleAlert, X } from 'lucide-react'
import { usePlan } from '../../state/plan'
import {
  DEFAULT_SIMULATION_SETTINGS,
  batchOutcome,
  useSimulation,
} from '../../state/simulation'
import { fetchPlanDiagnostics, fetchSimulationStatus, type ImportDiagnostics } from '../../lib/api'
import { countAgents, countSoldiers, soldiersBySide } from '../../lib/establishment'

/**
 * Run a Monte Carlo batch over the saved plan and watch the odds converge.
 *
 * A run needs a *saved* plan, not the drawing on screen: the engine is handed a
 * scenario built server-side from the stored plan and its stored terrain, so an
 * unsaved edit would silently not be simulated.
 */

interface Props {
  open: boolean
  onClose: () => void
}

// A single one-tick run is the cheapest thing that exercises the whole path --
// worth having when checking that a plan reaches the engine at all, rather than
// paying for a hundred runs to find out.
const RUN_COUNTS = [1, 10, 50, 100, 250]
const TICK_COUNTS = [1, 30, 60, 120, 240]

function pct(value: number): string {
  return `${Math.round(value * 100)} %`
}

function Choice<T extends number>({
  label,
  values,
  value,
  disabled,
  onChange,
}: {
  label: string
  values: readonly T[]
  value: T
  disabled: boolean
  onChange: (value: T) => void
}) {
  return (
    <div>
      <div className="mb-1.5 text-xs tracking-wide text-(--text-dim)">{label}</div>
      <div className="flex gap-1.5">
        {values.map((option) => (
          <button
            key={option}
            type="button"
            disabled={disabled}
            onClick={() => onChange(option)}
            className={`rounded-md border px-3 py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              option === value
                ? 'border-(--accent) text-(--text-h)'
                : 'border-(--border) text-(--text) hover:border-(--border-strong)'
            }`}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  )
}

export function SimulationModal({ open, onClose }: Props) {
  const savedPlanId = usePlan((s) => s.savedPlanId)
  const units = usePlan((s) => s.units)

  const phase = useSimulation((s) => s.phase)
  const requested = useSimulation((s) => s.requested)
  const soldiersFielded = useSimulation((s) => s.soldiers)
  const submitted = useSimulation((s) => s.diagnostics)
  const results = useSimulation((s) => s.results)
  const failures = useSimulation((s) => s.failures)
  const error = useSimulation((s) => s.error)
  const progress = useSimulation((s) => s.progress)
  const run = useSimulation((s) => s.run)
  const cancel = useSimulation((s) => s.cancel)

  const [simulationCount, setSimulationCount] = useState(DEFAULT_SIMULATION_SETTINGS.simulationCount)
  const [ticks, setTicks] = useState(DEFAULT_SIMULATION_SETTINGS.ticks)
  const [engineReady, setEngineReady] = useState<boolean | null>(null)
  // Checked when the dialog opens rather than reported after submitting, so an
  // impossible plan costs nothing to discover.
  const [preflight, setPreflight] = useState<ImportDiagnostics | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void fetchSimulationStatus()
      .then((status) => {
        if (!cancelled) setEngineReady(status.configured)
      })
      .catch(() => {
        if (!cancelled) setEngineReady(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  useEffect(() => {
    if (!open || !savedPlanId) return
    let cancelled = false
    void fetchPlanDiagnostics(savedPlanId)
      .then((value) => {
        if (!cancelled) setPreflight(value)
      })
      .catch(() => {
        // A pre-flight that cannot run is not a reason to block a run.
        if (!cancelled) setPreflight(null)
      })
    return () => {
      cancelled = true
    }
  }, [open, savedPlanId])

  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  const sides = useMemo(() => soldiersBySide(units), [units])
  // The cost line describes the run you are about to start, so it always prices
  // the plan as it stands now. `soldiersFielded` is what the server actually
  // built for the last batch, which belongs with that batch's results — after an
  // edit the two legitimately disagree.
  const soldiers = useMemo(() => countSoldiers(units), [units])
  const agents = useMemo(() => countAgents(units), [units])
  const outcome = batchOutcome(results)
  const settled = results.length + failures.length

  // Runs still going, newest state per run.
  const inFlight = useMemo(
    () => Object.values(progress).sort((a, b) => a.simulationIndex - b.simulationIndex),
    [progress],
  )

  // Ticks completed across the whole batch, counting a finished run as whole.
  // This is what actually moves while a run is in flight.
  const tickProgress = useMemo(() => {
    if (requested === 0) return 0
    const perRun = ticks
    const done = settled * perRun
    const partial = inFlight.reduce((total, run) => total + run.tick, 0)
    return Math.min(1, (done + partial) / (requested * perRun))
  }, [requested, ticks, settled, inFlight])
  const busy = phase === 'submitting' || phase === 'running'

  if (!open) return null

  const blocker =
    engineReady === false
      ? 'The simulation engine is not configured on the server (ENGINE_URL / ENGINE_API_TOKEN).'
      : !savedPlanId
        ? 'Save the plan first — the engine runs the stored plan, not the drawing on screen.'
        : soldiers === 0
          ? 'Place a force before running: this plan has no units.'
          : sides.blue === 0 || sides.red === 0
            ? 'Both sides need soldiers — a run with one side present ends immediately.'
            : null

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="glass-deep flex max-h-[85vh] w-full max-w-2xl flex-col gap-4 overflow-auto rounded-2xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-medium text-(--text-h)">Run Simulation</div>
            <div className="text-xs text-(--text-dim)">
              AI-driven soldiers fight the plan {simulationCount} times over real ground.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Close"
            className="shrink-0 rounded-md p-1.5 text-(--text-dim) transition-colors hover:text-(--text-h)"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>

        {blocker && (
          <div className="flex items-start gap-2 rounded-lg border border-(--border) bg-black/20 p-3 text-xs text-(--text)">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-(--hostile)" strokeWidth={1.75} />
            {blocker}
          </div>
        )}

        <div className="flex flex-wrap gap-6">
          <Choice label="RUNS" values={RUN_COUNTS} value={simulationCount} disabled={busy} onChange={setSimulationCount} />
          <Choice label="MAX TICKS" values={TICK_COUNTS} value={ticks} disabled={busy} onChange={setTicks} />
        </div>

        {/* What the batch costs, before committing to it rather than after. Only
            section commanders make a model call — the rest follow them — so the
            price is sections, not soldiers. */}
        <div className="space-y-1 rounded-lg bg-black/20 p-3 text-xs text-(--text-dim)">
          <div>
            <span className="text-(--text)">{soldiers}</span> soldiers
            <span className="opacity-60"> ({sides.blue} blue, {sides.red} red)</span> in{' '}
            <span className="text-(--text)">{agents}</span> sections ·{' '}
            <span className="text-(--text)">{ticks}</span> ticks ·{' '}
            <span className="text-(--text)">{simulationCount}</span> runs
          </div>
          <div>
            ≈{' '}
            <span className="text-(--text-h)">
              {(agents * ticks * simulationCount).toLocaleString()}
            </span>{' '}
            model calls, one per section commander per tick. The other{' '}
            {(soldiers - agents).toLocaleString()} soldiers follow their commander
            and cost nothing. A run stops early once one side has nobody left.
          </div>
        </div>

        {/* An objective on the far side of a river with no crossing is not a
            hard plan, it is an impossible one. Said as loudly as possible: the
            alternative is watching a force stand on a bank for the whole tick
            budget and reading the result as "inconclusive". */}
        {(preflight ?? submitted)?.blueObjectiveReachable === false && (
          <div className="flex items-start gap-2 rounded-lg border border-(--hostile)/50 bg-(--hostile)/10 p-3 text-xs text-(--text)">
            <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0 text-(--hostile)" strokeWidth={1.75} />
            <span>
              <span className="text-(--text-h)">Blue cannot reach its objective.</span>{' '}
              The ground between them is severed — water or a slope with no way
              across. This plan cannot succeed however long it runs. Move the
              objective, or route the force to a crossing.
            </span>
          </div>
        )}
        {(preflight ?? submitted)?.redObjectiveReachable === false && (
          <div className="flex items-start gap-2 rounded-lg border border-(--border) bg-black/20 p-3 text-xs text-(--text)">
            <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0 text-amber-400" strokeWidth={1.75} />
            <span>Red cannot reach the objective either — it can only defend where it stands.</span>
          </div>
        )}

        {/* Quantizing real elevation to integer metres can leave steps a soldier
            cannot climb. Said here, while the batch is running, rather than
            leaving it to look like agents that will not advance. */}
        {(preflight ?? submitted) !== null && ((preflight ?? submitted)!.unclimbableSteps ?? 0) > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-(--border) bg-black/20 p-3 text-xs text-(--text)">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-(--text-dim)" strokeWidth={1.75} />
            <span>
              This ground has{' '}
              <span className="text-(--text-h)">
                {(preflight ?? submitted)!.unclimbableSteps.toLocaleString()}
              </span>{' '}
              cell steps too steep to climb, out of{' '}
              {(preflight ?? submitted)!.cells.toLocaleString()} cells. Soldiers will route around
              them, and a high count on steep ground shows up as attacks that stall.
            </span>
          </div>
        )}

        {busy && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-xs text-(--text-dim)">
              <span>
                {phase === 'submitting'
                  ? 'Queueing the batch…'
                  : `${settled} of ${requested} runs complete`}
              </span>
              {failures.length > 0 && (
                <span className="text-(--hostile)">{failures.length} failed</span>
              )}
            </div>

            {/* Ticks, not runs. A single run takes minutes, so a bar that only
                moves when a whole run lands sits at zero for the entire wait and
                is indistinguishable from a hang. */}
            <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full bg-(--accent) transition-[width] duration-200"
                style={{ width: `${Math.round(tickProgress * 100)}%` }}
              />
            </div>

            {inFlight.length === 0 && phase === 'running' && (
              <div className="text-xs text-(--text-dim)">
                Waiting for a worker to pick the batch up…
              </div>
            )}

            {inFlight.map((run) => (
              <div
                key={run.simulationIndex}
                className="flex items-center gap-2 rounded-md bg-black/20 px-2.5 py-1.5 text-xs"
              >
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    run.inContact ? 'bg-(--hostile)' : 'bg-(--accent)'
                  }`}
                />
                <span className="text-(--text-dim)">run {run.simulationIndex + 1}</span>
                <span className="tabular-nums text-(--text-h)">
                  tick {run.tick}/{run.ticks}
                </span>
                <span className="text-(--text-dim)">
                  {run.inContact ? 'in contact' : 'advancing'}
                </span>
                <span className="ml-auto tabular-nums text-(--text-dim)">
                  <span style={{ color: 'var(--friendly)' }}>{run.blueAlive}</span> v{' '}
                  <span style={{ color: 'var(--hostile)' }}>{run.redAlive}</span> ·{' '}
                  {run.shotsFired} shots · {run.modelCalls} calls
                </span>
              </div>
            ))}
          </div>
        )}

        {outcome && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Blue wins" value={pct(outcome.blueWinRate)} accent />
            <Stat label="Red wins" value={pct(outcome.redWins / outcome.runs)} />
            <Stat label="Inconclusive" value={pct(outcome.inconclusive / outcome.runs)} />
            <Stat label="Mean ticks" value={outcome.meanTicks.toFixed(0)} />
            <Stat label="Blue losses" value={outcome.meanBlueLosses.toFixed(1)} />
            <Stat label="Red losses" value={outcome.meanRedLosses.toFixed(1)} />
            <Stat label="Runs scored" value={String(outcome.runs)} />
            <Stat label="Soldiers fielded" value={String(soldiersFielded)} />
            {failures.length > 0 && <Stat label="Failed" value={String(failures.length)} />}
          </div>
        )}

        {outcome && outcome.inconclusive / outcome.runs > 0.5 && (
          <div className="rounded-lg border border-(--border) bg-black/20 p-3 text-xs text-(--text-dim)">
            Most runs ended with both sides alive. On a one-metre grid a soldier moves one
            cell per tick, so a plan drawn over hundreds of metres needs far more ticks
            than this before the two sides can meet.
          </div>
        )}

        {error && <div className="text-xs text-(--hostile)">{error}</div>}

        <div className="flex items-center justify-end gap-2">
          {busy ? (
            <button
              type="button"
              onClick={cancel}
              className="glass rounded-xl px-4 py-2.5 text-sm text-(--text) transition-colors hover:text-(--text-h)"
            >
              Stop watching
            </button>
          ) : (
            <button
              type="button"
              disabled={blocker !== null || engineReady === null}
              onClick={() => {
                if (!savedPlanId) return
                void run(savedPlanId, { simulationCount, ticks })
                // Hand the operator straight back to the ground. Progress lives
                // in the engine panel over the map, not behind this dialog.
                onClose()
              }}
              className="flex items-center gap-2 rounded-xl bg-(--accent) px-5 py-2.5 text-sm font-medium text-(--panel-bg-solid) transition-colors hover:bg-(--accent-hover) disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-(--text-dim)"
            >
              <Play className="h-4 w-4" strokeWidth={2} />
              {results.length > 0 ? 'Run again' : 'Run'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg bg-black/20 p-3">
      <div className="text-xs whitespace-nowrap text-(--text-dim)">{label}</div>
      <div className={`text-lg ${accent ? 'text-(--accent)' : 'text-(--text-h)'}`}>{value}</div>
    </div>
  )
}
