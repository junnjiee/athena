import { useEffect, useMemo, useState } from 'react'
import { Sparkles, Check, X, Shield, Zap } from 'lucide-react'
import { useBattleground } from '../../state/battleground'
import { suggestRoute, type RoutePath, type UnitKind } from '../../lib/pathfind'
import { analyzeRoute } from '../../lib/validate'
import type { LonLat, PlacedObjective, PlacedRoute, PlacedUnit, RouteEndpointRef } from '../../types/entities'

interface Props {
  units: PlacedUnit[]
  objectives: PlacedObjective[]
  onAccept: (route: { side: 'blue'; startUnitId: string; points: LonLat[]; endRef: RouteEndpointRef }) => void
}

type Goal =
  | { kind: 'objective'; id: string; position: LonLat; label: string }
  | { kind: 'unit'; id: string; position: LonLat; label: string }

/** Co-planner: pick a blue unit + a goal, drag the risk dial, and A* proposes the
 *  optimal covered approach — shown as a ghost route with a tradeoff vs. drawing
 *  it by hand. */
export function RouteSuggestionPanel({ units, objectives, onAccept }: Props) {
  const phase = useBattleground((s) => s.phase)
  const grid = useBattleground((s) => s.grid)
  const setSuggestedPath = useBattleground((s) => s.setSuggestedPath)

  const blueUnits = useMemo(() => units.filter((u) => u.side === 'blue'), [units])
  const goals = useMemo<Goal[]>(
    () => [
      ...objectives.map((o) => ({ kind: 'objective' as const, id: o.id, position: o.position, label: o.name })),
      ...blueUnits.map((u) => ({ kind: 'unit' as const, id: u.id, position: u.position, label: `${u.name} · ${u.typeLabel}` })),
    ],
    [objectives, blueUnits],
  )

  const [startId, setStartId] = useState<string>('')
  const [goalKey, setGoalKey] = useState<string>('')
  const [unitKind, setUnitKind] = useState<UnitKind>('infantry')
  const [lambda, setLambda] = useState(0.5)

  const startUnit = blueUnits.find((u) => u.id === startId) ?? null
  const goal = goals.find((g) => `${g.kind}:${g.id}` === goalKey && g.id !== startId) ?? null

  // Derived, not state: A* is single-digit-ms on this grid, so re-solving inline
  // as the risk dial drags is cheaper than orchestrating async state.
  const suggestion = useMemo<RoutePath | null>(() => {
    if (phase !== 'ready' || !grid || !startUnit || !goal) return null
    return suggestRoute(grid, {
      start: startUnit.position,
      goal: goal.position,
      unitKind,
      lambda,
    })
  }, [phase, grid, startUnit, goal, unitKind, lambda])
  const unreachable = suggestion === null && phase === 'ready' && !!grid && !!startUnit && !!goal

  // Mirror the ghost polyline into the battlefield renderer; clear it on unmount.
  useEffect(() => {
    setSuggestedPath(suggestion?.points ?? null)
    return () => setSuggestedPath(null)
  }, [suggestion, setSuggestedPath])

  if (phase !== 'ready' || blueUnits.length === 0 || goals.length < 1) return null

  function handleAccept() {
    if (!startUnit || !goal || !suggestion) return
    onAccept({
      side: 'blue',
      startUnitId: startUnit.id,
      points: suggestion.points,
      endRef: { kind: goal.kind, id: goal.id },
    })
    // resetting the goal derives suggestion → null, which clears the ghost
    setGoalKey('')
  }

  // Hand-drawn comparison: a straight line start→goal, scored the same way.
  const straightComparison =
    grid && startUnit && goal
      ? analyzeRoute(
          { id: 'compare', side: 'blue', startUnitId: startUnit.id, points: [startUnit.position, goal.position], endRef: null } as PlacedRoute,
          grid,
        ).metrics
      : null

  return (
    <div className="glass w-72 rounded-xl p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs tracking-wide text-(--text-dim)">
        <Sparkles className="h-3 w-3 text-(--accent)" />
        SUGGEST APPROACH
      </div>

      <div className="flex flex-col gap-2">
        <Select label="Unit" value={startId} onChange={setStartId} options={blueUnits.map((u) => ({ value: u.id, label: `${u.name} · ${u.typeLabel}` }))} placeholder="Select blue unit" />
        <Select label="Objective" value={goalKey} onChange={setGoalKey} options={goals.filter((g) => g.id !== startId).map((g) => ({ value: `${g.kind}:${g.id}`, label: g.label }))} placeholder="Select destination" />

        <div className="flex items-center gap-1 rounded-md border border-(--border) p-0.5">
          {(['infantry', 'mechanized'] as UnitKind[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setUnitKind(k)}
              className={`flex-1 rounded px-2 py-1 text-xs capitalize transition-colors ${
                unitKind === k ? 'bg-white/10 text-(--text-h)' : 'text-(--text-dim) hover:text-(--text-h)'
              }`}
            >
              {k}
            </button>
          ))}
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between text-xs text-(--text-dim)">
            <span className="flex items-center gap-1">
              <Zap className="h-3 w-3" /> Fastest
            </span>
            <span className="flex items-center gap-1">
              Safest <Shield className="h-3 w-3" />
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={lambda}
            onChange={(e) => setLambda(Number(e.target.value))}
            className="w-full accent-(--accent)"
          />
        </div>
      </div>

      {unreachable && (
        <div className="mt-2 rounded-md border border-(--hostile)/40 bg-(--hostile)/10 p-2 text-xs text-(--text-h)">
          No passable route for a {unitKind} unit.
        </div>
      )}

      {suggestion && (
        <div className="mt-3 rounded-md bg-white/5 p-2.5 text-xs">
          <div className="mb-1.5 flex items-center gap-1.5 text-sky-400">
            <span className="h-2 w-4 rounded-full border border-dashed border-sky-400" />
            Suggested approach
          </div>
          <Metric label="Distance" value={`${(suggestion.lengthMeters / 1000).toFixed(2)} km`} />
          <Metric label="Est. time" value={`${Math.max(1, Math.round(suggestion.etaMinutes))} min`} />
          <Metric label="Exposure" value={`${Math.round(suggestion.exposure * 100)}%`} accent={suggestion.exposure < 0.2} />
          {straightComparison && (
            <div className="mt-1.5 border-t border-(--border) pt-1.5 text-[11px] text-(--text-dim)">
              Direct line: {(straightComparison.lengthMeters / 1000).toFixed(2)} km ·{' '}
              {Math.round(straightComparison.exposure * 100)}% exposure
            </div>
          )}
          <div className="mt-2.5 flex gap-1.5">
            <button
              type="button"
              onClick={handleAccept}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-(--accent) py-1.5 font-medium text-(--panel-bg-solid) transition-colors hover:bg-(--accent-hover)"
            >
              <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> Accept
            </button>
            <button
              type="button"
              onClick={() => setGoalKey('')}
              className="flex items-center justify-center gap-1.5 rounded-md border border-(--border) px-3 py-1.5 text-(--text) transition-colors hover:text-(--text-h)"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function Select({
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  placeholder: string
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-(--text-dim)">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-(--border) bg-(--panel-bg-solid) px-2 py-1.5 text-sm text-(--text-h) outline-none focus:border-(--accent-border)"
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-(--text-dim)">{label}</span>
      <span className={accent ? 'text-(--accent)' : 'text-(--text-h)'}>{value}</span>
    </div>
  )
}
