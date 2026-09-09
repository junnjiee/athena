import { useState } from 'react'
import { AlertTriangle, Ban, Loader2, MapPin, ShieldCheck, Trash2, Users } from 'lucide-react'
import { corridorColor, corridorLabel } from '../../lib/corridors'
import {
  allocationByInlet,
  blockInlets,
  blockForceOrbat,
  blockSummary,
  formatExactCount,
  sealingByInlet,
  unblockableByInlet,
} from '../../lib/blockForces'
import { ECHELON_LABEL, availabilitySummary, weaponSummary } from '../../lib/orbatTree'
import { formatOperationalOffset } from '../../lib/reserveTiming'
import { formatRouteDistance } from '../../lib/routeStudy'
import type {
  BlockAllocation,
  BlockCandidate,
  BlockPoint,
  InletBlock,
  OrbatUnit,
  RouteStudy,
  SealingAssessment,
} from '../../types/routeStudy'

interface Props {
  study: RouteStudy
  units: OrbatUnit[]
  running: boolean
  selectedCorridorId: string | null
  onSelectCorridor: (id: string) => void
  onRun: () => void
  placingBlockInletId: string | null
  onBeginBlockPoint: (inletId: string) => void
  onClearBlockPoint: (inletId: string) => void
  onSetDelayAssessment: (inletId: string, delayMinutes: number | null) => void
}

/**
 * The S3 pass: what could be put on each axis/inlet.
 *
 * An option set for a commander to time, not a plan. The engine never asks
 * whether a block force arrives first or whether it can hold what is coming —
 * only whether it is free and where it lies relative to the inlet.
 */
export function BlockForcePanel({
  study,
  units,
  running,
  selectedCorridorId,
  onSelectCorridor,
  onRun,
  placingBlockInletId,
  onBeginBlockPoint,
  onClearBlockPoint,
  onSetDelayAssessment,
}: Props) {
  const [selectedInletId, setSelectedInletId] = useState<string | null>(null)
  const plan = study.blockPlan
  const counts = availabilitySummary(units)
  const corridorNames = new Map(
    study.result.corridors.map((corridor, index) => [
      corridor.id,
      { label: corridorLabel(corridor, index, study.corridorEdits), color: corridorColor(index) },
    ]),
  )
  const inlets = plan ? blockInlets(plan) : []
  const allocated = plan ? allocationByInlet(plan) : new Map()
  const sealing = plan ? sealingByInlet(plan) : new Map()
  const blockPoints = new Map((plan?.block_points ?? []).map((point) => [point.inlet_id, point]))
  const inletNames = new Map(inlets.map((block) => [
    block.inlet_id,
    `${corridorNames.get(block.corridor_id)?.label ?? block.corridor_id} · inlet ${block.inlet_number}`,
  ]))
  const unblockable = plan ? unblockableByInlet(plan) : new Map<string, string>()
  const uncovered = new Set(
    (plan?.uncovered ?? []).map((entry) => entry.inlet_id ?? `legacy:${entry.corridor_id}`),
  )
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

      <div className="mb-2 flex items-center gap-1.5 px-0.5 text-[11px] text-(--text-dim)">
        <Users className="h-3.5 w-3.5" />
        {counts.uncommitted} of {counts.total} unit{counts.total === 1 ? '' : 's'} available for tasking
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

        {(plan?.rejected_block_points?.length ?? 0) > 0 && (
          <div className="rounded-md border border-amber-400/20 bg-amber-400/10 px-2 py-1.5 text-[10px] text-amber-300">
            {plan!.rejected_block_points!.map((rejection) => (
              <div key={`${rejection.inlet_id}:${rejection.reason}`}>
                {inletNames.get(rejection.inlet_id) ?? rejection.inlet_id} · {rejection.reason}
              </div>
            ))}
          </div>
        )}

        {(plan?.rejected_delay_assessments?.length ?? 0) > 0 && (
          <div className="rounded-md border border-amber-400/20 bg-amber-400/10 px-2 py-1.5 text-[10px] text-amber-300">
            {plan!.rejected_delay_assessments!.map((rejection) => (
              <div key={`${rejection.inlet_id}:${rejection.reason}`}>
                {inletNames.get(rejection.inlet_id) ?? rejection.inlet_id} · {rejection.reason}
              </div>
            ))}
          </div>
        )}

        {inlets.map((block) => (
          <InletBlockRow
            key={block.inlet_id}
            block={block}
            named={corridorNames.get(block.corridor_id)}
            allocation={allocated.get(block.inlet_id)}
            sealing={sealing.get(block.inlet_id)}
            blockPoint={blockPoints.get(block.inlet_id)}
            units={units}
            unblockableReason={unblockable.get(block.inlet_id)}
            uncovered={uncovered.has(block.inlet_id)}
            selected={selectedInletId === block.inlet_id}
            corridorSelected={selectedCorridorId === block.corridor_id}
            onSelect={() => {
              setSelectedInletId(block.inlet_id)
              onSelectCorridor(block.corridor_id)
            }}
            placingBlockPoint={placingBlockInletId === block.inlet_id}
            onBeginBlockPoint={() => onBeginBlockPoint(block.inlet_id)}
            onClearBlockPoint={() => onClearBlockPoint(block.inlet_id)}
            onSetDelayAssessment={(minutes) => onSetDelayAssessment(block.inlet_id, minutes)}
            blockPointControlsDisabled={running}
          />
        ))}

        {plan && (
          <p className="px-0.5 pt-1 text-[10px] leading-relaxed text-(--text-dim)">
            Every axis is an inlet. Coverage drives allocation; sufficiency describes the result.
            Distances are straight-line to the inlet, not road distance or time. An operator-set
            block point times enemy contact; own-force arrival remains a separate judgement.
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

function InletBlockRow({
  block,
  named,
  allocation,
  sealing,
  blockPoint,
  units,
  unblockableReason,
  uncovered,
  selected,
  corridorSelected,
  onSelect,
  placingBlockPoint,
  onBeginBlockPoint,
  onClearBlockPoint,
  onSetDelayAssessment,
  blockPointControlsDisabled,
}: {
  block: InletBlock
  named: { label: string; color: string } | undefined
  allocation: BlockAllocation | undefined
  sealing: SealingAssessment | undefined
  blockPoint: BlockPoint | undefined
  units: OrbatUnit[]
  unblockableReason: string | undefined
  uncovered: boolean
  selected: boolean
  corridorSelected: boolean
  onSelect: () => void
  placingBlockPoint: boolean
  onBeginBlockPoint: () => void
  onClearBlockPoint: () => void
  onSetDelayAssessment: (delayMinutes: number | null) => void
  blockPointControlsDisabled: boolean
}) {
  const forceRows = allocation ? blockForceOrbat(units, allocation.unit_id) : []
  const assignedCandidate = allocation
    ? block.candidates.find((candidate) => candidate.unit_id === allocation.unit_id)
    : undefined

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Block options for ${named?.label ?? block.corridor_id}, inlet ${block.inlet_number}`}
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
          : corridorSelected
            ? 'border-(--accent-border)/40 bg-(--accent-bg)/40'
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
        <span className="shrink-0 text-[10px] tracking-wide text-(--text-dim)">
          INLET {block.inlet_number}
        </span>
      </div>

      {allocation && (
        <div className="mt-1.5">
          <div className="flex items-center gap-1.5 text-[11px] text-(--accent)">
            <ShieldCheck className="h-3.5 w-3.5" />
            {allocation.unit_name} · {formatRouteDistance(allocation.distance_meters)} out
          </div>
          <div className="mt-1 text-[10px] text-(--text)">
            {candidateWeapons(assignedCandidate)}
          </div>
          {sealing && (
            <SealingResult
              assessment={sealing}
              contactUnitName={allocation.unit_name}
              disabled={blockPointControlsDisabled}
              onSetDelayAssessment={onSetDelayAssessment}
            />
          )}
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
                  {(unit.weapons?.length ?? 0) > 0 && (
                    <span className="max-w-24 truncate text-(--text-dim)">
                      {weaponSummary(unit.weapons)}
                    </span>
                  )}
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
          {allocation && (
            <div className="mb-2 rounded border border-(--border) bg-black/10 px-1.5 py-1.5 text-[10px]">
              <div className="flex items-center gap-1.5">
                <MapPin className="h-3 w-3 text-(--accent)" />
                <span className="min-w-0 flex-1 text-(--text)">
                  {blockPoint
                    ? `Enemy reaches block point ${formatOperationalOffset(blockPoint.enemy_movement_seconds / 60)} after moving`
                    : 'No exact block point set'}
                </span>
                {blockPoint && (
                  <button
                    type="button"
                    title="Clear block point"
                    disabled={blockPointControlsDisabled}
                    onClick={onClearBlockPoint}
                    className="text-(--text-dim) hover:text-(--hostile) disabled:opacity-40"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
              {blockPoint && blockPoint.snap_distance_meters >= 5 && (
                <div className="mt-0.5 text-[9px] text-(--text-dim)">
                  Snapped {Math.round(blockPoint.snap_distance_meters)} m onto the routed inlet.
                </div>
              )}
              <button
                type="button"
                disabled={blockPointControlsDisabled}
                onClick={onBeginBlockPoint}
                className={`mt-1 text-[9px] disabled:opacity-40 ${placingBlockPoint ? 'text-amber-300' : 'text-(--accent)'}`}
              >
                {placingBlockPoint
                  ? 'Click the inlet on the map · Esc to cancel'
                  : blockPoint ? 'Move block point' : 'Set block point on map'}
              </button>
            </div>
          )}
          <div className="text-[10px] tracking-wide text-(--text-dim)">
            CANDIDATES ({block.candidates.length})
          </div>
          {block.candidates.length === 0 && (
            <div className="mt-1 text-[11px] text-(--text-dim)">
              No uncommitted unit can be put on this inlet.
            </div>
          )}
          {block.candidates.map((candidate) => (
            <div
              key={candidate.unit_id}
              className={`mt-1 text-[11px] ${
                allocation && candidate.unit_name === allocation.unit_name
                  ? 'text-(--accent)'
                  : 'text-(--text)'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate">{candidate.unit_name}</span>
                <span className="text-(--text-dim)">{ECHELON_LABEL[candidate.echelon]}</span>
                <span className="tabular-nums">{formatRouteDistance(candidate.distance_meters)}</span>
              </div>
              <div className="truncate text-[10px] text-(--text-dim)">
                {candidateWeapons(candidate)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const HARDNESS_LABEL: Record<NonNullable<SealingAssessment['target_hardness']>, string> = {
  soft_skin: 'soft-skin',
  hard_skin_light: 'light armour',
  hard_skin_heavy: 'heavy armour',
}

function SealingResult({
  assessment,
  contactUnitName,
  disabled,
  onSetDelayAssessment,
}: {
  assessment: SealingAssessment
  contactUnitName: string
  disabled: boolean
  onSetDelayAssessment: (delayMinutes: number | null) => void
}) {
  const presentation = {
    destroyed_at_block: {
      label: 'Reserve destroyed at block',
      className: 'border-(--accent-border) bg-(--accent-bg) text-(--accent)',
    },
    delayed_and_attrited: {
      label: 'Reserve delayed and attrited',
      className: 'border-amber-400/20 bg-amber-400/10 text-amber-300',
    },
    passed: {
      label: 'Reserve passes the block',
      className: 'border-(--hostile)/25 bg-(--hostile)/10 text-(--hostile)',
    },
    unknown: {
      label: 'Sufficiency unknown',
      className: 'border-(--border) bg-black/15 text-(--text-dim)',
    },
  }[assessment.outcome]

  const target = assessment.target_platforms
    .map(({ platform, count }) => `${formatExactCount(count)} ${platform}`)
    .join(' · ')
  const remaining = formatExactCount(assessment.remaining_platform_count)
  const targetCount = formatExactCount(assessment.target_platform_count)

  return (
    <div className={`mt-2 rounded-md border px-2 py-1.5 ${presentation.className}`}>
      <div className="text-[10px] font-medium tracking-wide">{presentation.label.toUpperCase()}</div>
      {assessment.outcome === 'delayed_and_attrited' && (
        <div className="mt-0.5 text-[10px]">{remaining} of {targetCount} hardest platforms remain</div>
      )}
      {assessment.outcome === 'passed' && (
        <div className="mt-0.5 text-[10px]">No recorded weapon is effective against the hardest platforms</div>
      )}
      {assessment.outcome === 'unknown' && (
        <div className="mt-0.5 text-[10px]">{assessment.reason}</div>
      )}
      {assessment.target_hardness && target && (
        <div className="mt-1 text-[9px] text-(--text-dim)">
          TARGET · {HARDNESS_LABEL[assessment.target_hardness]} · {target}
        </div>
      )}
      {assessment.target_hardness && (
        <div className="mt-0.5 text-[9px] text-(--text-dim)">
          EFFECTIVE · {assessment.effective_weapon_count > 0
            ? weaponSummary(assessment.effective_weapons)
            : 'none recorded'}
        </div>
      )}
      {assessment.outcome === 'delayed_and_attrited' && (
        <DelayAssessmentEditor
          key={assessment.reaction?.delay_minutes ?? 'unset'}
          value={assessment.reaction?.delay_minutes ?? null}
          disabled={disabled}
          onSave={onSetDelayAssessment}
        />
      )}
      {assessment.reaction && (
        <ReactionChain assessment={assessment} contactUnitName={contactUnitName} />
      )}
    </div>
  )
}

function DelayAssessmentEditor({
  value,
  disabled,
  onSave,
}: {
  value: number | null
  disabled: boolean
  onSave: (delayMinutes: number | null) => void
}) {
  const [draft, setDraft] = useState(value == null ? '' : String(value))

  const parsed = Number(draft)
  const valid = draft.trim() !== '' && Number.isFinite(parsed) && parsed > 0 && parsed <= 10_080
  const changed = valid && parsed !== value

  return (
    <div className="mt-1.5 border-t border-current/15 pt-1.5 text-[9px] text-(--text-dim)">
      <div className="tracking-wide">OPERATOR DELAY ASSESSMENT</div>
      <div className="mt-1 flex items-center gap-1">
        <input
          type="number"
          min={1}
          max={10_080}
          step={1}
          value={draft}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          aria-label="Delay duration in minutes"
          placeholder="minutes"
          className="min-w-0 flex-1 rounded border border-current/20 bg-black/20 px-1.5 py-1 text-(--text) outline-none disabled:opacity-40"
        />
        <span>min</span>
        <button
          type="button"
          disabled={disabled || !changed}
          onClick={() => onSave(parsed)}
          className="rounded border border-current/20 px-1.5 py-1 text-(--text) disabled:opacity-40"
        >
          Apply
        </button>
        {value != null && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => onSave(null)}
            className="rounded border border-current/20 px-1.5 py-1 disabled:opacity-40"
          >
            Clear
          </button>
        )}
      </div>
      {!valid && draft.trim() !== '' && (
        <div className="mt-1 normal-case text-(--hostile)">Enter 1–10,080 minutes.</div>
      )}
      <div className="mt-1 normal-case leading-relaxed">
        Enter a judged delay; Athena will not infer one from attrition alone.
      </div>
    </div>
  )
}

function ReactionChain({
  assessment,
  contactUnitName,
}: {
  assessment: SealingAssessment
  contactUnitName: string
}) {
  const reaction = assessment.reaction!
  const time = (minutes: number | null | undefined) =>
    minutes == null ? 'time incomplete' : formatOperationalOffset(minutes)
  const continuation = reaction.remnant_continued == null
    ? 'continuation unknown'
    : reaction.remnant_continued
      ? 'remnant continued'
      : 'no remnant continued'
  const objective = reaction.objective_outcome === 'did_not_reach'
    ? 'did not reach objective'
    : reaction.objective_outcome === 'reached'
      ? `reached objective · ${time(reaction.objective_arrival_minutes)}`
      : 'objective outcome unknown'

  return (
    <div className="mt-1.5 border-t border-current/15 pt-1.5 text-[9px] text-(--text-dim)">
      <div className="tracking-wide">REACTION CHAIN</div>
      <div className="mt-0.5">COMMENCED · {time(reaction.commencement_minutes)}</div>
      <div>CONTACTED BY {contactUnitName.toUpperCase()} · {time(reaction.contact_minutes)}</div>
      {assessment.outcome === 'delayed_and_attrited' && (
        <div>DELAY · {time(reaction.delay_minutes)}</div>
      )}
      <div>{continuation.toUpperCase()}</div>
      <div>{objective.toUpperCase()}</div>
      {reaction.unknowns.length > 0 && (
        <div className="mt-1 normal-case leading-relaxed" title={reaction.unknowns.join('; ')}>
          Incomplete: {reaction.unknowns.join(' · ')}
        </div>
      )}
    </div>
  )
}

function candidateWeapons(candidate: BlockCandidate | undefined): string {
  if (!candidate) return 'No weapons recorded'
  if (candidate.weapons) return weaponSummary(candidate.weapons)
  return candidate.strength != null
    ? `${candidate.strength} strong · legacy result; re-run to measure weapons`
    : 'No weapons recorded'
}
