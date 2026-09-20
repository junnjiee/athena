import { useMemo, useState } from 'react'
import { MousePointerClick, Plus, Search } from 'lucide-react'
import { formatRoadCode } from '../../lib/roadCodes'
import { ROAD_THEMES, nextRoadName } from '../../lib/roadNames'
import { roadIdentities, type RoadIdentity } from '../../lib/roads'
import type { OperationalAreaMeta, RoadGraph, RoadTheme } from '../../types/routeStudy'

const SEARCH_RESULTS = 6

interface Props {
  area: OperationalAreaMeta
  graph: RoadGraph
  saving: boolean
  error: string | null
  onSetTheme: (theme: RoadTheme) => void
  drawingRoad: boolean
  canMutateGraph: boolean
  onBeginAdd: () => void
  /** Search results select on the map; the card there does the editing. */
  onPick: (road: RoadIdentity) => void
}

/** The road register, reduced to what the map cannot do: choose the call-sign
 *  theme, start drawing a road, and find a road by name when it is off screen.
 *  Everything per road -- naming, coding, breaking, destroying -- happens on the
 *  road itself, by clicking it. */
export function RoadEditorPanel({
  area,
  graph,
  saving,
  error,
  onSetTheme,
  drawingRoad,
  canMutateGraph,
  onBeginAdd,
  onPick,
}: Props) {
  const [query, setQuery] = useState('')
  const roads = useMemo(() => roadIdentities(graph), [graph])
  const coded = Object.keys(area.roadEdits).length
  const destroyed = roads.filter((road) => road.partiallyDestroyed).length
  const added = roads.filter((road) => road.wayId < 0).length
  const nextName = nextRoadName(area.roadTheme, Object.values(area.roadEdits).map((edit) => edit.name))
  const needle = query.trim().toLowerCase()
  const matches = needle
    ? roads.filter((road) => {
        const edit = area.roadEdits[road.id]
        return [road.id, road.osmName, edit?.name, edit && formatRoadCode(edit), road.roadClass]
          .some((value) => value?.toLowerCase().includes(needle))
      }).slice(0, SEARCH_RESULTS)
    : []

  return (
    <div className="glass flex flex-col rounded-xl p-3">
      <div className="flex items-center justify-between text-xs tracking-wide text-(--text-dim)">
        <span>ROAD GRAPH</span>
        <button
          type="button"
          disabled={saving || !canMutateGraph || !nextName}
          onClick={onBeginAdd}
          className={`flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] ${drawingRoad ? 'bg-(--accent) text-(--panel-bg-solid)' : 'border border-(--accent-border) text-(--accent)'} disabled:opacity-40`}
        >
          <Plus className="h-3 w-3" /> Add road
        </button>
      </div>

      <div className="mt-2 flex items-start gap-1.5 rounded-md border border-(--border) bg-black/10 px-2 py-1.5 text-[10px] leading-relaxed text-(--text)">
        <MousePointerClick className="mt-0.5 h-3.5 w-3.5 shrink-0 text-(--accent)" />
        <span>
          Click any road on the map to name it, code it, break a stretch, or mark it destroyed.
          {drawingRoad ? ' Drawing: click two endpoints near existing junctions. Esc cancels.' : ''}
        </span>
      </div>

      <div className="mt-2 flex justify-between text-[10px] text-(--text-dim)">
        <span>{roads.length.toLocaleString()} roads</span>
        <span>{coded} coded</span>
        <span className={destroyed ? 'text-red-300' : ''}>{destroyed} destroyed</span>
        <span>{added} added</span>
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
        <span className="mt-0.5 block normal-case">{nextName ? `Next call sign: ${nextName}` : 'Theme exhausted'}</span>
      </label>

      <div className="relative mt-2">
        <Search className="pointer-events-none absolute top-2 left-2 h-3.5 w-3.5 text-(--text-dim)" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find a road by name, call sign, or class"
          aria-label="Find a road"
          className="w-full rounded-md border border-(--border) bg-black/15 py-1.5 pr-2 pl-7 text-xs text-(--text-h) placeholder:text-(--text-dim) focus:border-(--accent) focus:outline-none"
        />
      </div>
      {needle && (
        <div className="mt-1 space-y-0.5">
          {matches.map((road) => {
            const edit = area.roadEdits[road.id]
            return (
              <button
                key={road.id}
                type="button"
                onClick={() => { onPick(road); setQuery('') }}
                className="flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-xs hover:bg-white/6"
              >
                <span className={`truncate ${edit ? 'font-mono' : ''} text-(--text-h)`}>
                  {edit ? formatRoadCode(edit) : road.osmName ?? `OSM way ${road.id}`}
                </span>
                <span className="ml-2 shrink-0 text-[10px] text-(--text-dim)">
                  {road.partiallyDestroyed ? 'DESTROYED · ' : ''}{road.roadClass.replace('_', ' ')}
                </span>
              </button>
            )
          })}
          {matches.length === 0 && <div className="px-2 py-1 text-xs text-(--text-dim)">No roads match.</div>}
        </div>
      )}

      {error && <div className="mt-2 text-xs text-(--hostile)">{error}</div>}
    </div>
  )
}
