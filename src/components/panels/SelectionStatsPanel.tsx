import type { SelectionResult } from '../../types/selection'

interface Props {
  selection: SelectionResult | null
  onClear: () => void
}

export function SelectionStatsPanel({ selection, onClear }: Props) {
  if (!selection) return null

  const { stats } = selection

  return (
    <div className="absolute top-16 right-4 z-10 w-64 rounded-md border border-(--border) bg-(--bg) p-4 text-sm text-(--text) shadow-(--shadow)">
      <h2 className="mb-2 text-base font-medium text-(--text-h)">Selected Ground</h2>
      <dl className="space-y-1">
        <div className="flex justify-between">
          <dt>Center</dt>
          <dd>
            {stats.centerLatitude.toFixed(5)}, {stats.centerLongitude.toFixed(5)}
          </dd>
        </div>
        <div className="flex justify-between">
          <dt>Width</dt>
          <dd>{stats.widthMeters.toFixed(0)} m</dd>
        </div>
        <div className="flex justify-between">
          <dt>Height</dt>
          <dd>{stats.heightMeters.toFixed(0)} m</dd>
        </div>
        <div className="flex justify-between">
          <dt>Area</dt>
          <dd>{stats.areaKm2.toFixed(2)} km²</dd>
        </div>
      </dl>
      <button
        type="button"
        onClick={onClear}
        className="mt-3 w-full rounded-md border border-(--border) py-1.5 text-(--text-h) transition-colors hover:bg-(--accent-bg)"
      >
        Clear selection
      </button>
    </div>
  )
}
