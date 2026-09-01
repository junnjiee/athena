import { useMemo } from 'react'
import { Activity, Brain, Radio, Timer, Zap } from 'lucide-react'
import { useSimulation } from '../../state/simulation'
import { FRIENDLY_HEX, HOSTILE_HEX } from '../../lib/colors'

/**
 * What the engine is doing, while it is doing it.
 *
 * A batch used to be a bar and a wait. Everything here is a number the engine
 * already computes per tick and previously threw away: which commanders are
 * thinking this tick, how many soldiers are executing a standing order instead,
 * how long a tick is taking, and what it has cost so far.
 *
 * It is deliberately specific about *who* is deciding. "3 agents active" is a
 * status light; "Blue A commander, Red B commander" is the simulation being
 * legible.
 */

function Stat({
  icon: Icon,
  label,
  value,
  tone = 'text-(--text-h)',
}: {
  icon: typeof Zap
  label: string
  value: string
  tone?: string
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-3 w-3 shrink-0 text-(--text-dim)" strokeWidth={1.75} />
      <span className="text-(--text-dim)">{label}</span>
      <span className={`ml-auto tabular-nums ${tone}`}>{value}</span>
    </div>
  )
}

export function EngineActivityPanel() {
  const phase = useSimulation((s) => s.phase)
  const progress = useSimulation((s) => s.progress)
  const results = useSimulation((s) => s.results)
  const requested = useSimulation((s) => s.requested)

  const runs = useMemo(
    () => Object.values(progress).sort((a, b) => a.simulationIndex - b.simulationIndex),
    [progress],
  )

  if (phase !== 'running' && phase !== 'submitting') return null

  // Aggregate across runs in flight; usually one, but a batch fans out.
  const deciding = runs.flatMap((run) => run.deciding ?? [])
  const totalCalls = runs.reduce((n, r) => n + (r.totalCalls ?? r.modelCalls), 0)
  const standing = runs.reduce((n, r) => n + (r.standingOrders ?? 0), 0)
  const tickMs = runs.length
    ? Math.round(runs.reduce((n, r) => n + (r.tickMs ?? 0), 0) / runs.length)
    : 0
  const shots = runs.reduce((n, r) => n + r.shotsFired, 0)
  const contact = runs.some((r) => r.inContact)

  return (
    <div className="glass w-64 rounded-xl p-3">
      <div className="mb-2 flex items-center gap-2 text-xs tracking-wide text-(--text-dim)">
        <Activity className="h-3.5 w-3.5" strokeWidth={1.75} />
        ENGINE
        <span
          className={`ml-auto h-1.5 w-1.5 rounded-full ${
            contact ? 'bg-(--hostile)' : 'bg-(--accent)'
          } animate-pulse`}
        />
        <span className={contact ? 'text-(--hostile)' : 'text-(--accent)'}>
          {phase === 'submitting' ? 'queueing' : contact ? 'in contact' : 'advancing'}
        </span>
      </div>

      {phase === 'submitting' && (
        <div className="text-xs text-(--text-dim)">
          Building the scenario and handing it to the engine…
        </div>
      )}

      {runs.length === 0 && phase === 'running' && (
        <div className="text-xs text-(--text-dim)">
          Queued. Waiting for a worker to claim it…
        </div>
      )}

      {runs.map((run) => (
        <div key={run.simulationIndex} className="mb-2">
          <div className="mb-1 flex items-baseline justify-between text-xs">
            <span className="text-(--text-dim)">run {run.simulationIndex + 1}</span>
            <span className="tabular-nums text-(--text-h)">
              tick {run.tick}/{run.ticks}
            </span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full bg-(--accent) transition-[width] duration-200"
              style={{ width: `${(run.tick / Math.max(1, run.ticks)) * 100}%` }}
            />
          </div>
          <div className="mt-1 flex justify-between text-[11px] tabular-nums text-(--text-dim)">
            <span>
              <span style={{ color: FRIENDLY_HEX }}>{run.blueAlive}</span> v{' '}
              <span style={{ color: HOSTILE_HEX }}>{run.redAlive}</span> alive
            </span>
            <span>{run.shotsFired} shots</span>
          </div>
        </div>
      ))}

      {/* The bit that makes it a simulation rather than a progress bar: the
          soldiers currently being asked what to do. */}
      {deciding.length > 0 && (
        <div className="mt-2 border-t border-(--border) pt-2">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] text-(--text-dim)">
            <Brain className="h-3 w-3" strokeWidth={1.75} />
            deciding now
          </div>
          <div className="flex flex-wrap gap-1">
            {deciding.slice(0, 8).map((who) => (
              <span
                key={`${who.side}-${who.soldier}`}
                className="rounded px-1.5 py-0.5 text-[10px] tabular-nums"
                style={{
                  color: who.side === 'blue' ? FRIENDLY_HEX : HOSTILE_HEX,
                  background: 'rgba(255,255,255,0.06)',
                }}
              >
                {who.section || `#${who.soldier}`}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-2 flex flex-col gap-1 border-t border-(--border) pt-2 text-[11px]">
        <Stat icon={Zap} label="model calls" value={totalCalls.toLocaleString()} />
        <Stat
          icon={Radio}
          label="standing orders"
          value={standing.toLocaleString()}
          tone="text-(--text)"
        />
        <Stat icon={Timer} label="last tick" value={tickMs ? `${tickMs} ms` : '—'} />
        <Stat
          icon={Activity}
          label="runs done"
          value={`${results.length}/${requested}`}
        />
      </div>

      {shots > 0 && (
        <div className="mt-2 text-[11px] text-(--text-dim)">
          {shots} rounds fired so far.
        </div>
      )}
    </div>
  )
}
