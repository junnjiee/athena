import { useState } from 'react'
import { Loader2, RotateCcw, Scissors, ShieldOff, Trash2, Undo2, X } from 'lucide-react'
import { formatRoadCode, parseRoadCode, prefillRoadClassification } from '../../lib/roadCodes'
import type { RoadIdentity } from '../../lib/roads'
import type { RoadEdit } from '../../types/routeStudy'

interface Props {
  road: RoadIdentity
  edit: RoadEdit | undefined
  /** Next unused call sign in the AO's theme, or null when it is exhausted. */
  nextName: string | null
  saving: boolean
  error: string | null
  canMutateGraph: boolean
  breaking: boolean
  onEdit: (edit: RoadEdit | null) => void
  onSetDestroyed: (destroyed: boolean) => void
  onBeginBreak: () => void
  onRemove: () => void
  onClose: () => void
}

function formatLength(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`
}

/** The selected road, on the map rather than in a list. Everything the register
 *  row used to offer sits here, one road at a time, next to the ground it
 *  describes. Opens on a click on any road; closes on Esc, the X, or a click on
 *  empty ground. */
export function RoadCard({
  road,
  edit,
  nextName,
  saving,
  error,
  canMutateGraph,
  breaking,
  onEdit,
  onSetDestroyed,
  onBeginBreak,
  onRemove,
  onClose,
}: Props) {
  const added = road.wayId < 0
  const title = edit ? formatRoadCode(edit) : road.osmName ?? (added ? 'Operator-added road' : `Unnamed ${road.roadClass.replace('_', ' ')}`)
  const state = road.destroyed ? 'DESTROYED' : road.partiallyDestroyed ? 'PARTIALLY DESTROYED' : null

  return (
    <div
      className={`glass-deep pointer-events-auto w-80 rounded-xl border p-3 ${
        road.destroyed || road.partiallyDestroyed ? 'border-red-400/30' : 'border-(--accent-border)'
      }`}
      role="dialog"
      aria-label={`Road ${title}`}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] tracking-wide text-(--text-dim)">
            ROAD{added ? ' · OPERATOR-ADDED' : ''}{state ? ` · ${state}` : ''}
          </div>
          <div className={`truncate text-sm ${edit ? 'font-mono' : ''} text-(--text-h)`}>{title}</div>
          <div className="mt-0.5 truncate text-[10px] text-(--text-dim)">
            {edit && road.osmName ? `${road.osmName} · ` : ''}
            {road.roadClass.replace('_', ' ')}
            {road.lanes ? ` · ${road.lanes} lanes` : ''}
            {` · ${formatLength(road.lengthMeters)}`}
            {` · ${road.edgeIds.length} segment${road.edgeIds.length === 1 ? '' : 's'}`}
          </div>
        </div>
        <button type="button" title="Close (Esc)" onClick={onClose} className="-mr-1 -mt-1 p-1 text-(--text-dim) hover:text-(--text-h)">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mt-2">
        {edit ? (
          <CodeEditor key={formatRoadCode(edit)} edit={edit} disabled={saving || !canMutateGraph} onSave={onEdit} />
        ) : (
          <button
            type="button"
            disabled={saving || !nextName}
            onClick={() => onEdit({ name: nextName!, ...prefillRoadClassification(road) })}
            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-(--accent-border) bg-(--accent-bg) py-1.5 text-xs text-(--accent) disabled:opacity-40"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {nextName ? `Assign call sign ${nextName}` : 'Call-sign theme exhausted'}
          </button>
        )}
      </div>

      {breaking && (
        <div className="mt-2 rounded-md border border-red-400/30 bg-red-950/20 px-2 py-1.5 text-[10px] text-red-200">
          Click the two ends of the broken stretch on this road. Both must land on one segment. Esc cancels.
        </div>
      )}
      {!canMutateGraph && (
        <div className="mt-2 text-[10px] text-amber-200/80">Re-run this stale study before changing its road graph.</div>
      )}
      {error && <div className="mt-2 text-xs text-(--hostile)">{error}</div>}

      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <Action
          icon={<Scissors className="h-3.5 w-3.5" />}
          label={breaking ? 'Breaking…' : 'Break stretch'}
          active={breaking}
          disabled={saving || !canMutateGraph || road.destroyed}
          onClick={onBeginBreak}
          tone="danger"
        />
        <Action
          icon={road.destroyed ? <Undo2 className="h-3.5 w-3.5" /> : <ShieldOff className="h-3.5 w-3.5" />}
          label={road.destroyed ? 'Restore road' : 'Mark destroyed'}
          disabled={saving || !canMutateGraph}
          onClick={() => onSetDestroyed(!road.destroyed)}
          tone="danger"
        />
        {edit && (
          <Action
            icon={<RotateCcw className="h-3.5 w-3.5" />}
            label="Clear code"
            disabled={saving}
            onClick={() => onEdit(null)}
          />
        )}
        {added && (
          <Action
            icon={<Trash2 className="h-3.5 w-3.5" />}
            label="Remove road"
            disabled={saving || !canMutateGraph}
            onClick={onRemove}
            tone="danger"
          />
        )}
      </div>
      {!added && (
        <div className="mt-1.5 text-[9px] leading-relaxed text-(--text-dim)">
          Extracted roads are never deleted: a destroyed road keeps its name so its loss stays askable.
        </div>
      )}
    </div>
  )
}

function Action({
  icon,
  label,
  onClick,
  disabled,
  active = false,
  tone = 'neutral',
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled: boolean
  active?: boolean
  tone?: 'neutral' | 'danger'
}) {
  const palette = active
    ? 'border-red-400/50 bg-red-950/40 text-red-200'
    : tone === 'danger'
      ? 'border-(--border) text-(--text) hover:border-red-400/40 hover:text-red-200'
      : 'border-(--border) text-(--text) hover:text-(--text-h)'
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`flex items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${palette}`}
    >
      {icon}
      {label}
    </button>
  )
}

function CodeEditor({
  edit,
  disabled,
  onSave,
}: {
  edit: RoadEdit
  disabled: boolean
  onSave: (edit: RoadEdit) => void
}) {
  const formatted = formatRoadCode(edit)
  const [draft, setDraft] = useState(formatted)
  const [invalid, setInvalid] = useState(false)

  function commit() {
    const parsed = parseRoadCode(draft)
    if (!parsed) {
      setInvalid(true)
      return
    }
    setInvalid(false)
    setDraft(formatRoadCode(parsed))
    if (formatRoadCode(parsed) !== formatted) onSave(parsed)
  }

  return (
    <label className="block">
      <span className="text-[10px] tracking-wide text-(--text-dim)">CALL SIGN AND CODE</span>
      <input
        value={draft}
        disabled={disabled}
        aria-label="Road code"
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          // Esc closes the card from the page; inside the field it just reverts.
          if (event.key === 'Escape') {
            event.stopPropagation()
            setDraft(formatted)
            setInvalid(false)
            event.currentTarget.blur()
          }
        }}
        className={`mt-1 w-full rounded-md border bg-black/15 px-2 py-1.5 font-mono text-xs text-(--text-h) focus:outline-none ${
          invalid ? 'border-(--hostile)' : 'border-(--border) focus:border-(--accent)'
        }`}
      />
      <span className={`mt-0.5 block text-[9px] ${invalid ? 'text-(--hostile)' : 'text-(--text-dim)'}`}>
        {invalid ? 'Use NAME(2|4|6[//] X|Y|Z)' : 'NAME(width[//] type) · 2/4/6 · // dual · X all-weather heavy, Y limited, Z fair-weather'}
      </span>
    </label>
  )
}
