import { MapPin, MoveHorizontal, MoveVertical, Square, Info } from 'lucide-react'
import type { SelectionResult } from '../../types/selection'

interface Props {
  selection: SelectionResult | null
  onClear: () => void
}

export function SelectionStatsPanel({ selection, onClear }: Props) {
  if (!selection) return null

  const { stats } = selection

  return (
    <div className="w-64 rounded-lg border border-(--border) bg-(--panel-bg) p-3 backdrop-blur-md shadow-(--shadow)">
      <div className="mb-2 flex items-center gap-1.5 text-xs tracking-wide text-(--text-dim)">
        <Info className="h-3 w-3" />
        GROUND SELECTION
      </div>
      <dl className="flex flex-col gap-1.5">
        <Row icon={MapPin} label="Center" value={`${stats.centerLatitude.toFixed(4)}°, ${stats.centerLongitude.toFixed(4)}°`} />
        <Row icon={MoveHorizontal} label="Width" value={`${stats.widthMeters.toFixed(0)} m`} />
        <Row icon={MoveVertical} label="Height" value={`${stats.heightMeters.toFixed(0)} m`} />
        <Row icon={Square} label="Area" value={`${stats.areaKm2.toFixed(2)} km²`} />
      </dl>
      <button
        type="button"
        onClick={onClear}
        className="mt-3 w-full rounded-md border border-(--border) py-1.5 text-sm text-(--text) transition-colors hover:border-(--border-strong) hover:text-(--text-h)"
      >
        Clear selection
      </button>
    </div>
  )
}

function Row({ icon: Icon, label, value }: { icon: typeof MapPin; label: string; value: string }) {
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
