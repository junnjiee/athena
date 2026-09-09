import { AlertTriangle, Ban, Loader2, ShieldCheck, Users } from 'lucide-react'
import { corridorColor, corridorLabel } from '../../lib/corridors'
import {
  allocationByCorridor,
  blockForceOrbat,
  blockSummary,
  unblockableByCorridor,
} from '../../lib/blockForces'
import { ECHELON_LABEL, ECHELON_ORDER, availabilitySummary, fitsWithin } from '../../lib/orbatTree'
import { formatRouteDistance } from '../../lib/routeStudy'
import type {
  BlockAllocation,
  CorridorBlock,
  Echelon,
  OrbatUnit,
  RouteStudy,
} from '../../types/routeStudy'

interface Props {
  study: RouteStudy
  units: OrbatUnit[]
  ceiling: Echelon
  running: boolean
  selectedCorridorId: string | null
  onSetCeiling: (ceiling: Echelon) => void
  onSelectCorridor: (id: string) => void
  onRun: () => void
}

/**
 * The S3 pass: what could be put on each corridor.
 *
 * An option set for a commander to time, not a plan. The engine never asks
 * whether a block force arrives first or whether it can hold what is coming —
 * only whether it is free, within the ceiling, and near enough to be offered.
 */
export function BlockForcePanel({
  study,
  units,
  ceiling,
  running,
  selectedCorridorId,
  onSetCeiling,
  onSelectCorridor,
  onRun,
}: Props) {
  const plan = study.blockPlan
  const counts = availabilitySummary(units)
  const withinCeiling = units.filter(
    (unit) => unit.availability === 'uncommitted' && fitsWithin(unit.echelon, ceiling),
  ).length
  const corridorNames = new Map(
    study.result.corridors.map((corridor, index) => [
      corridor.id,
      { label: corridorLabel(corridor, index, study.corridorEdits), color: corridorColor(index) },
    ]),
  )
  const allocated = plan ? allocationByCorridor(plan) : new Map()
  const unblockable = plan ? unblockableByCorridor(plan) : new Map<string, string>()
  const uncovered = new Set((plan?.uncovered ?? []).map((entry) => entry.corridor_id))
  const summary = plan ? blockSummary(plan) : null

  return (
    <div className="glass flex max-h-full w-80 flex-col rounded-xl p-3">
      <div className="mb-2 flex items-center justify-between text-xs tracking-wide text-(--text-dim)">
        <span className="flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5" strokeWidth={1.75} />
          BLOCK FORCES
        </span>
        {running && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />}
      </div>

      <label className="mb-2 block text-[10px] tracking-wide text-(--text-dim)">
        LARGEST FORMATION PER CORRIDOR
        <select
          value={ceiling}
          onChange={(event) => onSetCeiling(event.target.value as Echelon)}
          className="mt-1 w-full rounded-md border border-(--border) bg-(--panel-bg-solid) px-2 py-1.5 text-xs text-(--text-h) focus:outline-none"
        >
          {ECHELON_ORDER.map((echelon) => (
            <option key={echelon} value={echelon}>
              {ECHELON_LABEL[echelon]} or smaller
            </option>
          ))}
        </select>
      </label>

      <div className="mb-2 flex items-center gap-1.5 px-0.5 text-[11px] text-(--text-dim)">
        <Users className="h-3.5 w-3.5" />
        {withinCeiling} of {counts.total} unit{counts.total === 1 ? '' : 's'} free and within the
        ceiling
      </div>

      <button
        type="button"
        disabled={running || units.length === 0 || study.result.corridors.length === 0}
        onClick={onRun}
        className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-md bg-(--accent) py-2 text-sm font-medium text-(--panel-bg-solid) hover:bg-(--accent-hover) disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-(--text-dim)"
      >
        {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
        {running ? 'Allocating…' : plan ? 'Re-run block forces' : 'Find block forces'}
      </button>

      {units.length === 0 && (
        <div className="mb-2 px-1 text-[11px] text-(--text-dim)">
          List the force available on the ORBAT tab first.
        </div>
      )}

      <div className="flex min-h-0 flex-col gap-1.5 overflow-y-auto pr-1">
        {summary && (
          <div className="mb-1 flex gap-1.5 text-[10px] tracking-wide">
            <Tally label="BLOCKED" value={summary.allocated} tone="good" />
            <Tally label="UNCOVERED" value={summary.uncovered} tone="warn" />
            <Tally label="UNBLOCKABLE" value={summary.unblockable} tone="bad" />
          </div>
        )}

        {plan?.corridors.map((block) => (
          <CorridorBlockRow
            key={block.corridor_id}
            block={block}
            named={corridorNames.get(block.corridor_id)}
            allocation={allocated.get(block.corridor_id)}
            units={units}
            unblockableReason={unblockable.get(block.corridor_id)}
            uncovered={uncovered.has(block.corridor_id)}
            selected={selectedCorridorId === block.corridor_id}
            onSelect={() => onSelectCorridor(block.corridor_id)}
          />
        ))}

        {plan && (
          <p className="px-0.5 pt-1 text-[10px] leading-relaxed text-(--text-dim)">
            Distances are straight-line to the choke point, not road distance and not time. Nothing
            here says a block force arrives first, or that it can hold what is coming — that timing
            is yours to make.
          </p>
        )}
      </div>
    </div>
  )
}

function Tally({ label, value, tone }: { label: string; value: number; tone: 'good' | 'warn' | 'bad' }) {
  const color =
    tone === 'good'
      ? 'bg-(--accent)/15 text-(--accent)'
      : tone === 'warn'
        ? 'bg-amber-400/15 text-amber-300'
        : 'bg-(--hostile)/15 text-(--hostile)'
  return (
    <div className={`flex-1 rounded-md px-2 py-1.5 ${color}`}>
      <div className="text-sm leading-none">{value}</div>
      <div className="mt-1 text-[9px]">{label}</div>
    </div>
  )
}

function CorridorBlockRow({
  block,
  named,
  allocation,
  units,
  unblockableReason,
  uncovered,
  selected,
  onSelect,
}: {
  block: CorridorBlock
  named: { label: string; color: string } | undefined
  allocation: BlockAllocation | undefined
  units: OrbatUnit[]
  unblockableReason: string | undefined
  uncovered: boolean
  selected: boolean
  onSelect: () => void
}) {
  const forceRows = allocation ? blockForceOrbat(units, allocation.unit_id) : []

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Block options for ${named?.label ?? block.corridor_id}`}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault()
          onSelect()
        }
      }}
      className={`rounded-lg border p-2.5 transition-colors ${
        selected
          ? 'border-(--accent-border) bg-(--accent-bg)'
          : 'border-transparent bg-white/3 hover:bg-white/5'
      }`}
    >
      <div className="flex items-center gap-2">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: named?.color ?? '#64748b' }}
        />
        <span className="min-w-0 flex-1 truncate text-sm text-(--text-h)">
          {named?.label ?? block.corridor_id}
        </span>
      </div>

      {allocation && (
        <div className="mt-1.5">
          <div className="flex items-center gap-1.5 text-[11px] text-(--accent)">
            <ShieldCheck className="h-3.5 w-3.5" />
            {allocation.unit_name} · {formatRouteDistance(allocation.distance_meters)} out
          </div>
          {forceRows.length > 0 ? (
            <div className="mt-2 rounded-md border border-(--border) bg-black/15 px-2 py-1.5">
              <div className="mb-1 text-[9px] tracking-wide text-(--text-dim)">
                BLOCK FORCE · TASK ORGANISATION
              </div>
              {forceRows.map(({ unit, depth, hasChildren }) => (
                <div
                  key={unit.unit_id}
                  className="flex min-w-0 items-center gap-1 py-0.5 text-[10px]"
                  style={{ paddingLeft: depth * 12 }}
                >
                  <span aria-hidden="true" className="w-2 shrink-0 text-white/25">
                    {depth > 0 ? '└' : hasChildren ? '◆' : '•'}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-(--text-h)">{unit.name}</span>
                  <span className="text-(--text-dim)">{ECHELON_LABEL[unit.echelon]}</span>
                  {unit.redcon != null && <span className="text-(--accent)">R{unit.redcon}</span>}
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-1 text-[10px] text-amber-300">
              Saved allocation is no longer present in the current ORBAT.
            </div>
          )}
        </div>
      )}

      {unblockableReason && (
        <div className="mt-1.5 flex items-start gap-1.5 text-[11px] text-(--hostile)">
          <Ban className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Nothing can be put on it — {unblockableReason}
        </div>
      )}

      {uncovered && (
        <div className="mt-1.5 flex items-start gap-1.5 text-[11px] text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Blockable, but the force ran out before it.
        </div>
      )}

      {selected && (
        <div className="mt-2 border-t border-(--border) pt-2" onClick={(event) => event.stopPropagation()}>
          <div className="text-[10px] tracking-wide text-(--text-dim)">
            CANDIDATES ({block.candidates.length})
          </div>
          {block.candidates.length === 0 && (
            <div className="mt-1 text-[11px] text-(--text-dim)">
              No free unit within the ceiling can reach this choke point.
            </div>
          )}
          {block.candidates.map((candidate) => (
            <div
              key={candidate.unit_id}
              className={`mt-1 flex items-center gap-1.5 text-[11px] ${
                allocation && candidate.unit_name === allocation.unit_name
                  ? 'text-(--accent)'
                  : 'text-(--text)'
              }`}
            >
              <span className="min-w-0 flex-1 truncate">{candidate.unit_name}</span>
              <span className="text-(--text-dim)">{ECHELON_LABEL[candidate.echelon]}</span>
              <span className="text-(--text-dim)">{candidate.strength}</span>
              <span className="tabular-nums">{formatRouteDistance(candidate.distance_meters)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
