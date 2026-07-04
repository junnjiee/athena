import { MapPin, MoveHorizontal, MoveVertical, Square, Info, Loader2, Zap } from 'lucide-react'
import { useBattleground } from '../../state/battleground'
import type { SelectionResult } from '../../types/selection'

interface Props {
  selection: SelectionResult | null
  onClear: () => void
  onGenerate: () => void
}

export function SelectionStatsPanel({ selection, onClear, onGenerate }: Props) {
  const phase = useBattleground((s) => s.phase)
  if (!selection) return null

  const { stats } = selection
  const generating = phase === 'generating'

  return (
    <div className="glass w-64 rounded-xl p-3">
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
      {phase !== 'ready' && (
        <button
          type="button"
          disabled={generating}
          onClick={onGenerate}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-md bg-(--accent) py-2 text-sm font-medium text-(--panel-bg-solid) transition-colors hover:bg-(--accent-hover) disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-(--text-dim)"
        >
          {generating ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
              Generating…
            </>
          ) : (
            <>
              <Zap className="h-4 w-4" strokeWidth={2} />
              Generate Battlefield
            </>
          )}
        </button>
      )}
      <button
        type="button"
        onClick={onClear}
        disabled={generating}
        className="mt-2 w-full rounded-md border border-(--border) py-1.5 text-sm text-(--text) transition-colors hover:border-(--border-strong) hover:text-(--text-h) disabled:cursor-not-allowed disabled:opacity-50"
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
