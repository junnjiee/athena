import { useState } from 'react'
import { AlertTriangle, Ban, Crosshair, Loader2, Route as RouteIcon } from 'lucide-react'
import {
  corridorColor,
  corridorLabel,
  corridorMinutes,
  isChokeBlocked,
  unreachableSummary,
} from '../../lib/corridors'
import { corridorDistance, formatRouteDistance } from '../../lib/routeStudy'
import { formatOperationalOffset, reserveCommencementMinutes, reserveTaskCompleteMinutes } from '../../lib/reserveTiming'
import type { Corridor, RouteStudy } from '../../types/routeStudy'

interface Props {
  study: RouteStudy
  running: boolean
  selectedCorridorId: string | null
  onSelect: (id: string) => void
  onLocate: (corridor: Corridor) => void
  onRename: (id: string, name: string) => Promise<void>
  onCategorise: (id: string, category: string) => Promise<void>
  onToggleChoke: (corridor: Corridor) => Promise<void>
}

export function CorridorEditorPanel({
  study,
  running,
  selectedCorridorId,
  onSelect,
  onLocate,
  onRename,
  onCategorise,
  onToggleChoke,
}: Props) {
  const unreachable = unreachableSummary(study.result, study.marks)
  return (
    <div className="glass flex max-h-full w-80 flex-col rounded-xl p-3">
      <div className="mb-2 flex items-center justify-between text-xs tracking-wide text-(--text-dim)">
        <span className="flex items-center gap-1.5">
          <RouteIcon className="h-3.5 w-3.5" strokeWidth={1.75} />
          CORRIDORS ({study.result.corridors.length})
        </span>
        {running && <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />}
      </div>

      <div className="flex min-h-0 flex-col gap-1.5 overflow-y-auto pr-1">
        {unreachable.length > 0 && (
          <div className="mb-1 rounded-lg border border-(--hostile)/30 bg-(--hostile)/10 p-2.5">
            <div className="mb-1 flex items-center gap-1.5 text-[11px] tracking-wide text-(--hostile)">
              <AlertTriangle className="h-3.5 w-3.5" /> NO ROUTE FOUND
            </div>
            {unreachable.map((line) => (
              <div key={line} className="text-xs text-(--text)">{line}</div>
            ))}
          </div>
        )}

        {study.result.corridors.length === 0 && unreachable.length === 0 && (
          <div className="px-1 py-2 text-xs text-(--text-dim)">No corridors were returned.</div>
        )}

        {study.result.corridors.map((corridor, index) => (
          <CorridorRow
            key={corridor.id}
            corridor={corridor}
            index={index}
            study={study}
            selected={selectedCorridorId === corridor.id}
            running={running}
            onSelect={onSelect}
            onLocate={onLocate}
            onRename={onRename}
            onCategorise={onCategorise}
            onToggleChoke={onToggleChoke}
          />
        ))}
      </div>
    </div>
  )
}

function CorridorRow({
  corridor,
  index,
  study,
  selected,
  running,
  onSelect,
  onLocate,
  onRename,
  onCategorise,
  onToggleChoke,
}: {
  corridor: Corridor
  index: number
  study: RouteStudy
  selected: boolean
  running: boolean
  onSelect: Props['onSelect']
  onLocate: Props['onLocate']
  onRename: Props['onRename']
  onCategorise: Props['onCategorise']
  onToggleChoke: Props['onToggleChoke']
}) {
  const serverName = corridorLabel(corridor, index, study.corridorEdits)
  const edit = study.corridorEdits[corridor.id]
  const serverCategory = edit?.category ?? ''
  const [name, setName] = useState(serverName)
  const [category, setCategory] = useState(serverCategory)
  const [lastServerName, setLastServerName] = useState(serverName)
  const [lastServerCategory, setLastServerCategory] = useState(serverCategory)

  if (serverName !== lastServerName) {
    setLastServerName(serverName)
    setName(serverName)
  }
  if (serverCategory !== lastServerCategory) {
    setLastServerCategory(serverCategory)
    setCategory(serverCategory)
  }

  const blocked = isChokeBlocked(corridor, study.edgeOverrides)
  const canBlock = corridor.choke_edge_ids.length > 0
  const timedReserves = [...new Set(corridor.routes.map((route) => route.reserve_id))].flatMap((reserveId) => {
    const reserve = study.marks.reserves.find((mark) => mark.id === reserveId)
    const routes = corridor.routes.filter((route) => route.reserve_id === reserveId)
    const fastestMovement = Math.min(...routes.map((route) => route.seconds))
    const commencement = reserveCommencementMinutes(reserve?.timing)
    const complete = reserveTaskCompleteMinutes(reserve?.timing, fastestMovement)
    return reserve && (commencement !== null || complete !== null)
      ? [{ reserve, commencement, complete }]
      : []
  })

  function commitName() {
    const trimmed = name.trim()
    if (trimmed !== serverName) void onRename(corridor.id, trimmed)
    if (trimmed === '') setName(serverName)
  }

  function commitCategory(next: string) {
    setCategory(next)
    if (next !== serverCategory) void onCategorise(corridor.id, next)
  }

  return (
    <div
      onClick={() => onSelect(corridor.id)}
      onKeyDown={(event) => {
        if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault()
          onSelect(corridor.id)
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`Edit ${serverName}`}
      className={`rounded-lg border p-2.5 transition-colors ${
        selected ? 'border-(--accent-border) bg-(--accent-bg)' : 'border-transparent bg-white/3 hover:bg-white/5'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: corridorColor(index) }} />
        <input
          value={name}
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
          onBlur={commitName}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') {
              setName(serverName)
              event.currentTarget.blur()
            }
          }}
          onClick={(event) => event.stopPropagation()}
          aria-label={`Name for corridor ${index + 1}`}
          className="min-w-0 flex-1 border-b border-transparent bg-transparent text-sm text-(--text-h) hover:border-(--border) focus:border-(--accent) focus:outline-none"
        />
        <button
          type="button"
          title="Locate corridor"
          onClick={(event) => {
            event.stopPropagation()
            onLocate(corridor)
          }}
          className="text-(--text-dim) hover:text-(--text-h)"
        >
          <Crosshair className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      </div>

      <div className="mt-1.5 flex items-center gap-2 text-[11px] text-(--text-dim)">
        <span>{corridor.routes.length} route{corridor.routes.length === 1 ? '' : 's'}</span>
        <span>·</span>
        <span>{formatRouteDistance(corridorDistance(corridor))}</span>
        <span>·</span>
        <span>{corridorMinutes(corridor)} min fastest</span>
      </div>

      {edit?.reattachment && (
        <div
          className="mt-1 text-[9px] tracking-wide text-(--accent)"
          title={`Carried from ${edit.reattachment.from_corridor_id}`}
        >
          REATTACHED {Math.round(edit.reattachment.overlap * 100)}% · REV {edit.reattachment.from_revision}→{edit.reattachment.to_revision}
        </div>
      )}

      {timedReserves.length > 0 && (
        <div className="mt-1 space-y-0.5 text-[10px] text-(--text-dim)">
          {timedReserves.map(({ reserve, commencement, complete }) => (
            <div key={reserve.id}>
              {reserve.name}: {commencement === null ? 'move time unknown' : `move ${formatOperationalOffset(commencement)}`}
              {' · '}
              {complete === null ? 'task time incomplete' : `task ${formatOperationalOffset(complete)}`}
            </div>
          ))}
        </div>
      )}

      {selected && (
        <div className="mt-2 border-t border-(--border) pt-2" onClick={(event) => event.stopPropagation()}>
          <label className="block text-[10px] tracking-wide text-(--text-dim)">
            CATEGORY
            <select
              value={category}
              onChange={(event) => commitCategory(event.target.value)}
              className="mt-1 w-full rounded-md border border-(--border) bg-(--panel-bg-solid) px-2 py-1.5 text-xs text-(--text-h) focus:outline-none"
            >
              <option value="">Uncategorised</option>
              <option value="primary">Primary</option>
              <option value="alternate">Alternate</option>
              <option value="contingency">Contingency</option>
            </select>
          </label>
          <button
            type="button"
            disabled={!canBlock || running}
            title={canBlock ? 'Toggle impassability on the common choke edges and re-run' : 'No edge is shared by every route'}
            onClick={() => void onToggleChoke(corridor)}
            className={`mt-2 flex w-full items-center justify-center gap-1.5 rounded-md border border-(--border) py-1.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              blocked ? 'border-(--hostile)/40 text-(--hostile)' : 'hover:border-(--border-strong) hover:text-(--text-h)'
            }`}
          >
            {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />}
            {blocked ? 'Restore choke point' : canBlock ? 'Mark choke impassable' : 'No common choke point'}
          </button>
        </div>
      )}
    </div>
  )
}
