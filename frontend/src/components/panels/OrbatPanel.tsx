import { AlertTriangle, Crosshair, Plus, Trash2, Users } from 'lucide-react'
import {
  AVAILABILITY_LABEL,
  DEFAULT_STRENGTH,
  ECHELON_LABEL,
  ECHELON_ORDER,
  availabilitySummary,
  commitsWith,
  orbatIssues,
  orbatRows,
  validParents,
} from '../../lib/orbatTree'
import type { Availability, Echelon, OrbatUnit } from '../../types/routeStudy'

interface Props {
  units: OrbatUnit[]
  selectedUnitId: string | null
  placing: boolean
  placingEchelon: Echelon
  onSetPlacingEchelon: (echelon: Echelon) => void
  onBeginPlacing: () => void
  onSelectUnit: (unitId: string | null) => void
  onUpdateUnit: (unitId: string, patch: Partial<OrbatUnit>) => void
  onRemoveUnit: (unitId: string) => void
  onLocateUnit: (unit: OrbatUnit) => void
}

/**
 * The force actually available for this task — not the formation's whole
 * establishment.
 *
 * Units get moved around by mission requirement, so what can be committed today
 * is given per study rather than kept as a standing force list.
 */
export function OrbatPanel({
  units,
  selectedUnitId,
  placing,
  placingEchelon,
  onSetPlacingEchelon,
  onBeginPlacing,
  onSelectUnit,
  onUpdateUnit,
  onRemoveUnit,
  onLocateUnit,
}: Props) {
  const rows = orbatRows(units)
  const issues = orbatIssues(units)
  const counts = availabilitySummary(units)

  return (
    <div className="glass flex max-h-full w-80 flex-col rounded-xl p-3">
      <div className="mb-2 flex items-center justify-between text-xs tracking-wide text-(--text-dim)">
        <span className="flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5" strokeWidth={1.75} />
          ORDER OF BATTLE ({counts.total})
        </span>
        <span>{counts.uncommitted} free</span>
      </div>

      <div className="mb-2 flex items-center gap-1.5">
        <select
          value={placingEchelon}
          onChange={(event) => onSetPlacingEchelon(event.target.value as Echelon)}
          aria-label="Echelon to place"
          className="min-w-0 flex-1 rounded-md border border-(--border) bg-(--panel-bg-solid) px-2 py-1.5 text-xs text-(--text-h) focus:outline-none"
        >
          {ECHELON_ORDER.map((echelon) => (
            <option key={echelon} value={echelon}>
              {ECHELON_LABEL[echelon]} · {DEFAULT_STRENGTH[echelon]}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={onBeginPlacing}
          className={`flex items-center gap-1 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
            placing
              ? 'bg-(--accent) text-(--panel-bg-solid)'
              : 'border border-(--border) text-(--text) hover:text-(--text-h)'
          }`}
        >
          <Plus className="h-3.5 w-3.5" /> Place
        </button>
      </div>

      <div className="flex min-h-0 flex-col gap-1 overflow-y-auto pr-1">
        {issues.length > 0 && (
          <div className="mb-1 rounded-lg border border-(--hostile)/30 bg-(--hostile)/10 p-2.5">
            <div className="mb-1 flex items-center gap-1.5 text-[11px] tracking-wide text-(--hostile)">
              <AlertTriangle className="h-3.5 w-3.5" /> THE ENGINE WILL REFUSE THIS
            </div>
            {issues.map((issue) => (
              <div key={issue} className="text-[11px] text-(--text)">
                {issue}
              </div>
            ))}
          </div>
        )}

        {rows.length === 0 && (
          <div className="rounded-lg border border-dashed border-(--border) px-2.5 py-3 text-xs text-(--text-dim)">
            No force listed. Choose an echelon and click the ground to place one — each is stamped
            under the last unit that can hold it.
          </div>
        )}

        {rows.map(({ unit, depth, isLast, ancestorHasNext, hasChildren }) => (
          <div
            key={unit.unit_id}
            className="relative"
            style={{ paddingLeft: depth * 14 }}
          >
            {ancestorHasNext.map((continues, level) => continues && (
              <span
                key={level}
                aria-hidden="true"
                className="absolute top-0 bottom-0 w-px bg-white/15"
                style={{ left: level * 14 + 6 }}
              />
            ))}
            {depth > 0 && (
              <>
                <span
                  aria-hidden="true"
                  className="absolute top-0 w-px bg-white/20"
                  style={{
                    left: (depth - 1) * 14 + 6,
                    height: isLast ? 16 : '100%',
                  }}
                />
                <span
                  aria-hidden="true"
                  className="absolute h-px w-2 bg-white/20"
                  style={{ left: (depth - 1) * 14 + 6, top: 16 }}
                />
              </>
            )}
            <UnitRow
              unit={unit}
              hasChildren={hasChildren}
              units={units}
              selected={selectedUnitId === unit.unit_id}
              onSelect={() => onSelectUnit(selectedUnitId === unit.unit_id ? null : unit.unit_id)}
              onUpdate={(patch) => onUpdateUnit(unit.unit_id, patch)}
              onRemove={() => onRemoveUnit(unit.unit_id)}
              onLocate={() => onLocateUnit(unit)}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

const AVAILABILITY_ORDER: Availability[] = ['uncommitted', 'committed', 'reserve']

function UnitRow({
  unit,
  hasChildren,
  units,
  selected,
  onSelect,
  onUpdate,
  onRemove,
  onLocate,
}: {
  unit: OrbatUnit
  hasChildren: boolean
  units: OrbatUnit[]
  selected: boolean
  onSelect: () => void
  onUpdate: (patch: Partial<OrbatUnit>) => void
  onRemove: () => void
  onLocate: () => void
}) {
  const free = unit.availability === 'uncommitted'
  const parents = validParents(units, unit)
  // Committing a unit spends its parts and the formation it belongs to, both.
  const spends = commitsWith(units, unit.unit_id).size - 1

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Edit ${unit.name}`}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault()
          onSelect()
        }
      }}
      className={`group rounded-lg border p-2 transition-colors ${
        selected
          ? 'border-(--accent-border) bg-(--accent-bg)'
          : 'border-transparent bg-white/3 hover:bg-white/5'
      }`}
    >
      <div className="flex items-center gap-1.5">
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${free ? 'bg-(--friendly)' : 'bg-white/25'}`}
        />
        <input
          value={unit.name}
          maxLength={80}
          aria-label={`Name for ${unit.name}`}
          onChange={(event) => onUpdate({ name: event.target.value })}
          onClick={(event) => event.stopPropagation()}
          className="min-w-0 flex-1 border-b border-transparent bg-transparent text-xs text-(--text-h) hover:border-(--border) focus:border-(--accent) focus:outline-none"
        />
        <button
          type="button"
          title="Locate"
          onClick={(event) => {
            event.stopPropagation()
            onLocate()
          }}
          className="text-(--text-dim) opacity-0 hover:text-(--text-h) group-hover:opacity-100"
        >
          <Crosshair className="h-3 w-3" />
        </button>
        <button
          type="button"
          title={`Remove ${unit.name}`}
          onClick={(event) => {
            event.stopPropagation()
            onRemove()
          }}
          className="text-(--text-dim) opacity-0 hover:text-(--hostile) group-hover:opacity-100"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>

      <div className="mt-1 flex items-center gap-1.5 text-[10px] text-(--text-dim)">
        <span>{ECHELON_LABEL[unit.echelon]}</span>
        {hasChildren && <span>· Commands</span>}
        <span>·</span>
        <span>{unit.strength} strong</span>
        <span>·</span>
        <span className={free ? 'text-(--friendly)' : ''}>
          {AVAILABILITY_LABEL[unit.availability]}
        </span>
      </div>

      {selected && (
        <div
          className="mt-2 flex flex-col gap-2 border-t border-(--border) pt-2"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex gap-2">
            <label className="min-w-0 flex-1 text-[10px] tracking-wide text-(--text-dim)">
              ECHELON
              <select
                value={unit.echelon}
                onChange={(event) => onUpdate({ echelon: event.target.value as Echelon })}
                className="mt-1 w-full rounded-md border border-(--border) bg-(--panel-bg-solid) px-2 py-1 text-[11px] text-(--text-h) focus:outline-none"
              >
                {ECHELON_ORDER.map((echelon) => (
                  <option key={echelon} value={echelon}>
                    {ECHELON_LABEL[echelon]}
                  </option>
                ))}
              </select>
            </label>
            <label className="w-20 text-[10px] tracking-wide text-(--text-dim)">
              STRENGTH
              <input
                type="number"
                min={1}
                value={unit.strength}
                onChange={(event) => onUpdate({ strength: Number(event.target.value) })}
                className="mt-1 w-full rounded-md border border-(--border) bg-(--panel-bg-solid) px-2 py-1 text-right text-[11px] text-(--text-h) focus:outline-none"
              />
            </label>
          </div>

          <label className="block text-[10px] tracking-wide text-(--text-dim)">
            UNDER COMMAND OF
            <select
              value={unit.parent_id ?? ''}
              onChange={(event) => onUpdate({ parent_id: event.target.value || null })}
              className="mt-1 w-full rounded-md border border-(--border) bg-(--panel-bg-solid) px-2 py-1 text-[11px] text-(--text-h) focus:outline-none"
            >
              <option value="">Independent — no parent</option>
              {parents.map((parent) => (
                <option key={parent.unit_id} value={parent.unit_id}>
                  {parent.name} ({ECHELON_LABEL[parent.echelon]})
                </option>
              ))}
            </select>
          </label>

          <div>
            <div className="text-[10px] tracking-wide text-(--text-dim)">AVAILABILITY</div>
            <div className="mt-1 flex items-center gap-1 rounded-lg bg-black/20 p-1">
              {AVAILABILITY_ORDER.map((availability) => (
                <button
                  key={availability}
                  type="button"
                  onClick={() => onUpdate({ availability })}
                  className={`flex-1 rounded-md px-1.5 py-1 text-[11px] transition-colors ${
                    unit.availability === availability
                      ? 'bg-white/10 text-(--text-h)'
                      : 'text-(--text-dim) hover:text-(--text)'
                  }`}
                >
                  {AVAILABILITY_LABEL[availability]}
                </button>
              ))}
            </div>
            <div className="mt-1 text-[10px] text-(--text-dim)">
              Only an uncommitted unit is offered as a block force.
              {spends > 0
                ? ` Committing this one also spends ${spends} other unit${spends === 1 ? '' : 's'} in the tree.`
                : ''}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
