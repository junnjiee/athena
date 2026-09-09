import { useMemo, useState } from 'react'
import { Crosshair, Loader2, RotateCcw, Search, ShieldOff, Undo2 } from 'lucide-react'
import { formatRoadCode, parseRoadCode, prefillRoadClassification } from '../../lib/roadCodes'
import { ROAD_THEMES, nextRoadName } from '../../lib/roadNames'
import { roadIdentities, type RoadIdentity } from '../../lib/roads'
import type {
  OperationalAreaMeta,
  RoadEdit,
  RoadGraph,
  RoadTheme,
} from '../../types/routeStudy'

const VISIBLE_ROADS = 60

interface Props {
  area: OperationalAreaMeta
  graph: RoadGraph
  saving: boolean
  error: string | null
  onSetTheme: (theme: RoadTheme) => void
  onEditRoad: (roadId: string, edit: RoadEdit | null) => void
  onSetDestroyed: (road: RoadIdentity, destroyed: boolean) => void
  onLocate: (road: RoadIdentity) => void
}

export function RoadEditorPanel({
  area,
  graph,
  saving,
  error,
  onSetTheme,
  onEditRoad,
  onSetDestroyed,
  onLocate,
}: Props) {
  const [query, setQuery] = useState('')
  const roads = useMemo(() => roadIdentities(graph), [graph])
  const usedNames = Object.values(area.roadEdits).map((edit) => edit.name)
  const nextName = nextRoadName(area.roadTheme, usedNames)
  const needle = query.trim().toLowerCase()
  const matches = roads.filter((road) => {
    const edit = area.roadEdits[road.id]
    return !needle || [road.id, road.osmName, edit?.name, road.roadClass, road.lanes]
      .some((value) => value?.toLowerCase().includes(needle))
  })
  const visible = matches.slice(0, VISIBLE_ROADS)

  function assign(road: RoadIdentity) {
    if (!nextName) return
    onEditRoad(road.id, {
      name: nextName,
      ...prefillRoadClassification(road),
    })
  }

  return (
    <div className="glass flex h-full min-h-0 flex-col rounded-xl p-3">
      <div className="flex items-center justify-between text-xs tracking-wide text-(--text-dim)">
        <span>ROAD REGISTER</span>
        <span>{roads.length.toLocaleString()} roads</span>
      </div>

      <label className="mt-2 block text-[10px] tracking-wide text-(--text-dim)">
        CALL-SIGN THEME
        <select
          value={area.roadTheme}
          disabled={saving}
          onChange={(event) => onSetTheme(event.target.value as RoadTheme)}
          className="mt-1 w-full rounded-md border border-(--border) bg-(--panel-bg-solid) px-2 py-1.5 text-xs text-(--text-h) focus:border-(--accent) focus:outline-none"
        >
          {Object.entries(ROAD_THEMES).map(([id, theme]) => (
            <option key={id} value={id}>{theme.label}</option>
          ))}
        </select>
      </label>

      <div className="relative mt-2">
        <Search className="pointer-events-none absolute top-2 left-2 h-3.5 w-3.5 text-(--text-dim)" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search OSM name, call sign, class, or way id"
          aria-label="Search roads"
          className="w-full rounded-md border border-(--border) bg-black/15 py-1.5 pr-2 pl-7 text-xs text-(--text-h) placeholder:text-(--text-dim) focus:border-(--accent) focus:outline-none"
        />
      </div>

      <div className="mt-2 flex items-center justify-between text-[10px] text-(--text-dim)">
        <span>{Object.keys(area.roadEdits).length} coded</span>
        <span>{nextName ? `Next: ${nextName}` : 'Theme exhausted'}</span>
      </div>

      {error && <div className="mt-2 text-xs text-(--hostile)">{error}</div>}

      <div className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
        {visible.map((road) => {
          const edit = area.roadEdits[road.id]
          return edit ? (
            <RoadCodeRow
              key={road.id}
              road={road}
              edit={edit}
              saving={saving}
              onSave={(next) => onEditRoad(road.id, next)}
              onReset={() => onEditRoad(road.id, null)}
              onLocate={() => onLocate(road)}
              onSetDestroyed={() => onSetDestroyed(road, !road.destroyed)}
            />
          ) : (
            <div
              key={road.id}
              className={`rounded-md border px-2 py-1.5 ${road.destroyed ? 'border-red-400/30 bg-red-950/20' : 'border-white/5 bg-black/10'}`}
            >
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs text-(--text-h)">
                    {road.osmName ?? `OSM way ${road.id}`}
                  </div>
                  <div className="text-[10px] text-(--text-dim)">
                    {road.destroyed ? 'DESTROYED · ' : ''}
                    {road.roadClass.replace('_', ' ')}
                    {road.lanes ? ` · ${road.lanes} lanes` : ''}
                  </div>
                </div>
                <button
                  type="button"
                  title="Locate road"
                  onClick={() => onLocate(road)}
                  className="p-1 text-(--text-dim) hover:text-(--text-h)"
                >
                  <Crosshair className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  disabled={saving}
                  title={road.destroyed ? 'Restore road' : 'Mark road destroyed'}
                  aria-label={`${road.destroyed ? 'Restore' : 'Destroy'} ${road.osmName ?? `way ${road.id}`}`}
                  onClick={() => onSetDestroyed(road, !road.destroyed)}
                  className={`p-1 ${road.destroyed ? 'text-red-300 hover:text-white' : 'text-(--text-dim) hover:text-red-300'}`}
                >
                  {road.destroyed
                    ? <Undo2 className="h-3.5 w-3.5" />
                    : <ShieldOff className="h-3.5 w-3.5" />}
                </button>
                <button
                  type="button"
                  disabled={saving || !nextName}
                  onClick={() => assign(road)}
                  className="rounded-md border border-(--accent-border) bg-(--accent-bg) px-2 py-1 text-[10px] text-(--accent) disabled:opacity-40"
                >
                  {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : `Assign ${nextName ?? 'name'}`}
                </button>
              </div>
            </div>
          )
        })}
        {visible.length === 0 && (
          <div className="px-1 py-2 text-xs text-(--text-dim)">No roads match this search.</div>
        )}
      </div>

      {matches.length > VISIBLE_ROADS && (
        <div className="mt-1 text-[10px] text-(--text-dim)">
          Showing the first {VISIBLE_ROADS}. Narrow the search to find another road.
        </div>
      )}
    </div>
  )
}

function RoadCodeRow({
  road,
  edit,
  saving,
  onSave,
  onReset,
  onLocate,
  onSetDestroyed,
}: {
  road: RoadIdentity
  edit: RoadEdit
  saving: boolean
  onSave: (edit: RoadEdit) => void
  onReset: () => void
  onLocate: () => void
  onSetDestroyed: () => void
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
    const next: RoadEdit = parsed
    setDraft(formatRoadCode(next))
    if (formatRoadCode(next) !== formatted) onSave(next)
  }

  return (
    <div
      className={`rounded-md border px-2 py-1.5 ${invalid ? 'border-(--hostile)' : road.destroyed ? 'border-red-400/30 bg-red-950/20' : 'border-white/5 bg-black/10'}`}
    >
      <div className="flex items-center gap-1">
        <input
          value={draft}
          disabled={saving}
          aria-label={`Road code for ${road.osmName ?? `way ${road.id}`}`}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
          }}
          className="min-w-0 flex-1 bg-transparent font-mono text-xs text-(--text-h) focus:outline-none"
        />
        <button type="button" title="Locate road" onClick={onLocate} className="p-1 text-(--text-dim) hover:text-(--text-h)">
          <Crosshair className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          disabled={saving}
          title={road.destroyed ? 'Restore road' : 'Mark road destroyed'}
          aria-label={`${road.destroyed ? 'Restore' : 'Destroy'} ${road.osmName ?? `way ${road.id}`}`}
          onClick={onSetDestroyed}
          className={`p-1 ${road.destroyed ? 'text-red-300 hover:text-white' : 'text-(--text-dim) hover:text-red-300'}`}
        >
          {road.destroyed
            ? <Undo2 className="h-3.5 w-3.5" />
            : <ShieldOff className="h-3.5 w-3.5" />}
        </button>
        <button type="button" title="Return to OSM prefill" disabled={saving} onClick={onReset} className="p-1 text-(--text-dim) hover:text-(--text-h)">
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className={`text-[10px] ${invalid ? 'text-(--hostile)' : 'text-(--text-dim)'}`}>
        {invalid
          ? 'Use NAME(2|4|6[//] X|Y|Z)'
          : `${road.destroyed ? 'DESTROYED · ' : ''}${road.osmName ?? `OSM way ${road.id}`} · ${road.roadClass.replace('_', ' ')}`}
      </div>
    </div>
  )
}
