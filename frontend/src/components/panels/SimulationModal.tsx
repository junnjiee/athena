import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Play, X } from 'lucide-react'
import { usePlan } from '../../state/plan'
import {
  DEFAULT_SIMULATION_SETTINGS,
  batchOutcome,
  useSimulation,
} from '../../state/simulation'
import { fetchSimulationStatus } from '../../lib/api'
import { countSoldiers, soldiersBySide } from '../../lib/establishment'

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

const RUN_COUNTS = [10, 50, 100, 250]
const TICK_COUNTS = [30, 60, 120, 240]

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
  const results = useSimulation((s) => s.results)
  const failures = useSimulation((s) => s.failures)
  const error = useSimulation((s) => s.error)
  const run = useSimulation((s) => s.run)
  const cancel = useSimulation((s) => s.cancel)

  const [simulationCount, setSimulationCount] = useState(DEFAULT_SIMULATION_SETTINGS.simulationCount)
  const [ticks, setTicks] = useState(DEFAULT_SIMULATION_SETTINGS.ticks)
  const [engineReady, setEngineReady] = useState<boolean | null>(null)

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
  const outcome = batchOutcome(results)
  const settled = results.length + failures.length
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

        {/* Every soldier is one model call per tick, so the operator sees what a
            batch costs before committing to it rather than after. A platoon
            marker is 21 of them — the drawn markers are not the price. */}
        <div className="rounded-lg bg-black/20 p-3 text-xs text-(--text-dim)">
          <span className="text-(--text)">{soldiers}</span> soldiers
          <span className="opacity-60"> ({sides.blue} blue, {sides.red} red)</span> ·{' '}
          <span className="text-(--text)">{ticks}</span> ticks ·{' '}
          <span className="text-(--text)">{simulationCount}</span> runs ≈{' '}
          <span className="text-(--text)">
            {(soldiers * ticks * simulationCount).toLocaleString()}
          </span>{' '}
          agent decisions. Each is a model call, and a run stops early once one side has nobody left.
        </div>

        {busy && (
          <div>
            <div className="mb-1.5 flex items-center justify-between text-xs text-(--text-dim)">
              <span>{phase === 'submitting' ? 'Queueing batch…' : `${settled} of ${requested} runs complete`}</span>
              {failures.length > 0 && <span className="text-(--hostile)">{failures.length} failed</span>}
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full bg-(--accent) transition-[width] duration-300"
                style={{ width: requested === 0 ? '0%' : `${(settled / requested) * 100}%` }}
              />
            </div>
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
              onClick={() => savedPlanId && void run(savedPlanId, { simulationCount, ticks })}
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
