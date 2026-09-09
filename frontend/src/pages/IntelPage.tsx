import { useMemo, useState } from 'react'
import { Eye, Layers, Mountain, Radar, Satellite, TriangleAlert } from 'lucide-react'
import { Sidebar } from '../components/layout/Sidebar'
import { useBattleground } from '../state/battleground'
import { usePlan } from '../state/plan'
import { buildTerrainBrief, computeViewshed } from '../lib/intel'
import { TERRAIN_CLASS } from '../types/terrain'
import { useRailOffset } from '../state/shell'

/** Ranges a commander would actually ask about, metres. */
const VIEWSHED_RANGES = [200, 400, 800] as const

function Card({
  title,
  icon: Icon,
  children,
}: {
  title: string
  icon: typeof Radar
  children: React.ReactNode
}) {
  return (
    <section className="glass flex flex-col gap-3 rounded-xl p-4">
      <div className="flex items-center gap-2 text-xs tracking-wide text-(--text-dim)">
        <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
        {title}
      </div>
      {children}
    </section>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="text-xs text-(--text-dim)">{label}</span>
      <span className="text-sm text-(--text-h)">{value}</span>
    </div>
  )
}

export function IntelPage() {
  const railOffset = useRailOffset()
  const grid = useBattleground((s) => s.grid)
  const meta = useBattleground((s) => s.meta)
  const units = usePlan((s) => s.units)
  const [observerId, setObserverId] = useState<string | null>(null)
  const [range, setRange] = useState<number>(400)

  const brief = useMemo(() => (grid ? buildTerrainBrief(grid) : null), [grid])

  const observer = units.find((u) => u.id === observerId) ?? null
  const viewshed = useMemo(
    () => (grid && observer ? computeViewshed(grid, observer.position, range) : null),
    [grid, observer, range],
  )

  if (!grid || !meta || !brief) {
    return (
      <div className="relative h-screen w-screen overflow-hidden bg-(--bg) text-(--text)">
        <Sidebar />
        <div className={`absolute top-4 right-4 bottom-4 ${railOffset}`}>
          <div className="glass-deep flex h-full flex-col rounded-2xl p-6">
            <div className="mb-4 flex items-center gap-2 text-sm tracking-wide text-(--text-dim)">
              <Radar className="h-4 w-4" strokeWidth={1.75} />
              INTEL
            </div>
            <p className="text-sm text-(--text-dim)">
              No battlefield generated. Select ground on the Battleground page and generate it —
              intel is derived from the simulation grid, so there's nothing to report until then.
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-(--bg) text-(--text)">
      <Sidebar />
      <div className={`absolute top-4 right-4 bottom-4 ${railOffset}`}>
        <div className="glass-deep flex h-full flex-col rounded-2xl p-6">
          <div className="mb-1 flex items-center gap-2 text-sm tracking-wide text-(--text-dim)">
            <Radar className="h-4 w-4" strokeWidth={1.75} />
            INTEL
          </div>
          <p className="mb-5 text-xs text-(--text-dim)">
            {meta.name} · {brief.areaKm2} km² · {grid.width}×{grid.height} cells at{' '}
            {grid.cellMeters} m
          </p>

          <div className="grid max-w-4xl grid-cols-1 gap-4 overflow-y-auto pr-2 lg:grid-cols-2">
            <Card title="GROUND ASSESSMENT" icon={TriangleAlert}>
              {brief.observations.length === 0 ? (
                <p className="text-xs text-(--text-dim)">Unremarkable ground — nothing stands out.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {brief.observations.map((line) => (
                    <li key={line} className="text-xs leading-relaxed text-(--text)">
                      {line}
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="RELIEF & GOING" icon={Mountain}>
              <Stat
                label="Elevation"
                value={`${brief.elevation.min}–${brief.elevation.max} m (${brief.elevation.relief} m relief)`}
              />
              <Stat label="Mean slope" value={`${brief.meanSlopeDeg}°`} />
              <Stat label="Vehicle going" value={`${brief.vehicleGoingPercent}% trafficable`} />
              <Stat label="Water" value={`${brief.waterPercent}%`} />
            </Card>

            <Card title="COVER & EXPOSURE" icon={Eye}>
              <Stat label="Mean cover" value={`${brief.meanCover}/100`} />
              <Stat label="Mean concealment" value={`${brief.meanConcealment}/100`} />
              <Stat label="Mean exposure" value={`${brief.meanExposure}/100`} />
              <p className="text-[11px] leading-relaxed text-(--text-dim)">
                Cover stops rounds; concealment only hides. Exposure is how visible a unit standing
                on a cell is to the rest of the field.
              </p>
            </Card>

            <Card title="LAND COVER" icon={Layers}>
              <div className="flex flex-col gap-1.5">
                {brief.composition.slice(0, 6).map((share) => (
                  <div key={share.cls} className="flex items-center gap-2">
                    <span className="w-28 shrink-0 text-xs text-(--text-dim)">{share.name}</span>
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">
                      <div
                        className={`h-full rounded-full ${
                          share.cls === TERRAIN_CLASS.WATER ? 'bg-sky-500/70' : 'bg-(--accent)/70'
                        }`}
                        style={{ width: `${share.percent}%` }}
                      />
                    </div>
                    <span className="w-10 shrink-0 text-right text-xs text-(--text-h)">
                      {share.percent}%
                    </span>
                  </div>
                ))}
              </div>
            </Card>

            <Card title="LINE OF SIGHT" icon={Satellite}>
              {units.length === 0 ? (
                <p className="text-xs text-(--text-dim)">
                  Place a unit on the battleground to compute what it can see from where it stands.
                </p>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={observerId ?? ''}
                      onChange={(e) => setObserverId(e.target.value || null)}
                      aria-label="Observer"
                      className="rounded-md border border-(--border) bg-black/20 px-2 py-1 text-xs text-(--text-h) focus:outline-none"
                    >
                      <option value="" className="bg-(--panel-bg-solid)">
                        Select observer…
                      </option>
                      {units.map((u) => (
                        <option key={u.id} value={u.id} className="bg-(--panel-bg-solid)">
                          {u.name} ({u.side})
                        </option>
                      ))}
                    </select>

                    <div className="flex items-center gap-1 rounded-lg bg-black/20 p-1">
                      {VIEWSHED_RANGES.map((r) => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => setRange(r)}
                          className={`rounded-md px-2 py-0.5 text-[11px] transition-colors ${
                            range === r
                              ? 'bg-white/10 text-(--text-h)'
                              : 'text-(--text-dim) hover:text-(--text)'
                          }`}
                        >
                          {r} m
                        </button>
                      ))}
                    </div>
                  </div>

                  {viewshed && viewshed.origin && (
                    <>
                      <Stat
                        label={`Visible within ${viewshed.rangeMeters} m`}
                        value={`${viewshed.coveragePercent}%`}
                      />
                      <Stat label="Cells observed" value={viewshed.visibleCells.toLocaleString()} />
                      <p className="text-[11px] leading-relaxed text-(--text-dim)">
                        Bare-earth line of sight — terrain only. Canopy and buildings are not
                        modelled here; that is what the concealment channel measures.
                      </p>
                    </>
                  )}

                  {viewshed && !viewshed.origin && (
                    <p className="text-xs text-(--text-dim)">
                      That unit sits outside the generated battlefield.
                    </p>
                  )}
                </>
              )}
            </Card>

            <Card title="SOURCES" icon={Satellite}>
              <Stat label="Generated" value={new Date(meta.generatedAt).toLocaleString()} />
              <Stat label="Roads / buildings" value={`${meta.featureCounts.roads} / ${meta.featureCounts.buildings}`} />
              <Stat label="Landcover areas" value={String(meta.featureCounts.areas)} />
              <Stat
                label="Segmentation"
                value={
                  meta.segmentation
                    ? `${meta.segmentation.backend}, ${meta.segmentation.coveragePct}% coverage`
                    : 'skipped'
                }
              />
              <p className="text-[11px] leading-relaxed text-(--text-dim)">
                Elevation from AWS Terrain Tiles; features from OpenStreetMap; land cover from ESA
                WorldCover fused with live imagery segmentation.
              </p>
            </Card>
          </div>
        </div>
      </div>
    </div>
  )
}
