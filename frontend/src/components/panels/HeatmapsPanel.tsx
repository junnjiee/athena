import { Shield, EyeOff, Footprints, Eye, Car, Crosshair, TrendingUp, Mountain, Layers, Map, Ban, Radar } from 'lucide-react'
import { contourLegendLabel, legendGradient } from '../../lib/grid'
import { useBattleground } from '../../state/battleground'
import type { HeatmapMetric } from '../../types/terrain'

const METRICS: { id: HeatmapMetric; label: string; icon: typeof Shield; low?: string; high?: string }[] = [
  { id: 'none', label: 'None', icon: Ban },
  { id: 'cover', label: 'Cover', icon: Shield, low: 'Poor', high: 'Excellent' },
  { id: 'concealment', label: 'Concealment', icon: EyeOff, low: 'Exposed', high: 'Hidden' },
  { id: 'movement', label: 'Movement', icon: Footprints, low: 'Fast', high: 'Slow' },
  { id: 'visibility', label: 'Exposure', icon: Eye, low: 'Safe', high: 'Seen' },
  { id: 'enemyVisibility', label: 'Enemy LOS', icon: Radar, low: 'Unseen', high: 'Kill zone' },
  { id: 'vehicle', label: 'Vehicle Mobility', icon: Car, low: 'No-go', high: 'Go' },
  { id: 'ambush', label: 'Ambush Potential', icon: Crosshair, low: '', high: 'Prime' },
  { id: 'slope', label: 'Slope', icon: TrendingUp, low: 'Flat', high: 'Steep' },
  { id: 'elevation', label: 'Elevation', icon: Mountain, low: 'Low', high: 'High' },
  { id: 'contours', label: 'Contours', icon: Layers },
  { id: 'landcover', label: 'Land Cover', icon: Map },
]

/** Right-side heatmap selector — one tactical layer draped at a time. */
export function HeatmapsPanel() {
  const phase = useBattleground((s) => s.phase)
  const heatmap = useBattleground((s) => s.heatmap)
  const setHeatmap = useBattleground((s) => s.setHeatmap)
  const grid = useBattleground((s) => s.grid)
  const disabled = phase !== 'ready'

  return (
    <div className="glass w-52 rounded-xl p-3">
      <div className="mb-2 text-xs tracking-wide text-(--text-dim)">MILITARY HEATMAPS</div>
      {disabled && (
        <div className="mb-2 text-xs text-(--text-dim)">Generate a battlefield to unlock analysis</div>
      )}
      <div className="flex flex-col">
        {METRICS.map(({ id, label, icon: Icon, low, high }) => {
          const active = heatmap === id
          return (
            <button
              key={id}
              type="button"
              disabled={disabled}
              onClick={() => setHeatmap(id)}
              className={`rounded-md px-1.5 py-1.5 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                active ? 'bg-white/10 text-(--text-h)' : 'text-(--text) hover:bg-white/5 hover:text-(--text-h)'
              }`}
            >
              <div className="flex items-center gap-2">
                <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                <span className="flex-1">{label}</span>
                {active && <span className="h-1.5 w-1.5 rounded-full bg-(--accent)" />}
              </div>
              {active && id === 'contours' && grid && (
                <div className="mt-1.5 px-0.5 text-[10px] text-(--text-dim)">{contourLegendLabel(grid)}</div>
              )}
              {active && id === 'enemyVisibility' && !grid?.danger && (
                <div className="mt-1.5 px-0.5 text-[10px] text-(--text-dim)">
                  Place red-force units to compute enemy sightlines
                </div>
              )}
              {active && id !== 'none' && id !== 'landcover' && id !== 'contours' && (
                <div className="mt-1.5 px-0.5">
                  <div className="h-1.5 rounded-full" style={{ background: legendGradient(id) }} />
                  <div className="mt-0.5 flex justify-between text-[10px] text-(--text-dim)">
                    <span>{low}</span>
                    <span>{high}</span>
                  </div>
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
