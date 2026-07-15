import { Mountain, TrendingUp, Shield, Eye, Leaf, Footprints, Info, Crosshair } from 'lucide-react'
import { useBattleground } from '../../state/battleground'
import { toGridRef } from '../../lib/coords'

function grade(value: number, bands: [number, string][], fallback: string): string {
  for (const [min, label] of bands) {
    if (value >= min) return label
  }
  return fallback
}

/** Bottom-left TERRAIN INFO card (mirrors the reference design), fed by the
 *  military grid cell under the cursor. */
export function TerrainInfoPanel() {
  const phase = useBattleground((s) => s.phase)
  const cell = useBattleground((s) => s.hoverCell)

  if (phase !== 'ready') return null

  return (
    <div className="glass w-56 rounded-xl p-3">
      <div className="mb-2 flex items-center justify-between text-xs tracking-wide text-(--text-dim)">
        <span>TERRAIN INFO</span>
        <Info className="h-3 w-3" />
      </div>
      {cell ? (
        <dl className="flex flex-col gap-1.5">
          <Row icon={Crosshair} label="Grid Ref" value={toGridRef(cell.longitude, cell.latitude)} />
          <Row icon={Mountain} label="Elevation" value={`${cell.elevation.toFixed(0)} m`} />
          <Row icon={TrendingUp} label="Slope" value={`${cell.slopeDeg}°`} />
          <Row
            icon={Shield}
            label="Cover"
            value={grade(cell.cover, [[70, 'High'], [40, 'Medium']], 'Low')}
          />
          <Row
            icon={Eye}
            label="Visibility"
            value={grade(cell.visibility, [[70, 'High'], [40, 'Medium']], 'Low')}
          />
          <Row icon={Leaf} label="Vegetation" value={cell.clsName} />
          <Row
            icon={Footprints}
            label="Mobility"
            value={
              cell.moveCostFactor >= 4
                ? 'Blocked'
                : cell.moveCostFactor >= 2
                  ? 'Slowed'
                  : cell.moveCostFactor > 1.2
                    ? 'Reduced'
                    : 'Normal'
            }
          />
        </dl>
      ) : (
        <div className="py-2 text-xs text-(--text-dim)">Hover the battlefield for cell analysis</div>
      )}
    </div>
  )
}

function Row({ icon: Icon, label, value }: { icon: typeof Mountain; label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <div className="flex items-center gap-2 text-(--text-dim)">
        <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
        {label}
      </div>
      <span className="text-(--text-h)">{value}</span>
    </div>
  )
}
