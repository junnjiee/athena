import { Crosshair, Route as RouteIcon, ScanEye, Star, Trash2, Users } from 'lucide-react'
import { useBattleground } from '../../state/battleground'
import type { LonLat, PlacedObjective, PlacedRoute, PlacedUnit } from '../../types/entities'

interface Props {
  units: PlacedUnit[]
  objectives: PlacedObjective[]
  routes: PlacedRoute[]
  onLocate: (positions: LonLat[]) => void
  onDeleteUnit: (id: string) => void
  onDeleteObjective: (id: string) => void
  onDeleteRoute: (id: string) => void
}

export function PlanRosterPanel({
  units,
  objectives,
  routes,
  onLocate,
  onDeleteUnit,
  onDeleteObjective,
  onDeleteRoute,
}: Props) {
  const phase = useBattleground((s) => s.phase)
  const viewshed = useBattleground((s) => s.viewshed)
  const requestViewshed = useBattleground((s) => s.requestViewshed)
  const clearViewshed = useBattleground((s) => s.clearViewshed)

  if (units.length === 0 && objectives.length === 0 && routes.length === 0) return null

  return (
    <div className="glass w-60 rounded-xl p-3">
      <div className="mb-2 text-xs tracking-wide text-(--text-dim)">UNITS & OBJECTIVES</div>
      <div className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
        {units.map((unit) => {
          const viewshedActive = viewshed?.unitId === unit.id
          return (
            <RosterRow
              key={unit.id}
              icon={<Users className={`h-3.5 w-3.5 ${unit.side === 'blue' ? 'text-(--friendly)' : 'text-(--hostile)'}`} strokeWidth={1.75} />}
              label={unit.side === 'blue' ? `${unit.name} · ${unit.typeLabel}` : `${unit.name} (threat)`}
              onLocate={() => onLocate([unit.position])}
              onDelete={() => onDeleteUnit(unit.id)}
              extra={
                unit.side === 'blue' && phase === 'ready' ? (
                  <button
                    type="button"
                    title={viewshedActive ? 'Hide viewshed' : 'Show what this unit can see'}
                    onClick={() =>
                      viewshedActive ? clearViewshed() : requestViewshed(unit.id, unit.position)
                    }
                    className={viewshedActive ? 'text-sky-400' : 'text-(--text-dim) hover:text-(--text-h)'}
                  >
                    <ScanEye className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </button>
                ) : undefined
              }
            />
          )
        })}
        {objectives.map((objective) => (
          <RosterRow
            key={objective.id}
            icon={<Star className="h-3.5 w-3.5 text-(--accent)" strokeWidth={1.75} />}
            label={objective.name}
            onLocate={() => onLocate([objective.position])}
            onDelete={() => onDeleteObjective(objective.id)}
          />
        ))}
        {routes.map((route) => {
          const start = units.find((u) => u.id === route.startUnitId)
          const end =
            route.endRef?.kind === 'unit'
              ? units.find((u) => u.id === route.endRef!.id)
              : route.endRef?.kind === 'objective'
                ? objectives.find((o) => o.id === route.endRef!.id)
                : null
          const label = `${start?.name ?? 'Route'} → ${end?.name ?? '…'}`
          return (
            <RosterRow
              key={route.id}
              icon={
                <RouteIcon
                  className={`h-3.5 w-3.5 ${route.side === 'blue' ? 'text-(--friendly)' : 'text-(--hostile)'}`}
                  strokeWidth={1.75}
                />
              }
              label={label}
              onLocate={() => onLocate(route.points)}
              onDelete={() => onDeleteRoute(route.id)}
            />
          )
        })}
      </div>
    </div>
  )
}

interface RowProps {
  icon: React.ReactNode
  label: string
  onLocate: () => void
  onDelete: () => void
  /** optional per-row action rendered before locate (e.g. the viewshed toggle) */
  extra?: React.ReactNode
}

function RosterRow({ icon, label, onLocate, onDelete, extra }: RowProps) {
  return (
    <div className="group flex items-center justify-between gap-2 rounded-md px-1.5 py-1.5 text-sm hover:bg-white/5">
      <div className="flex min-w-0 items-center gap-2 text-(--text-h)">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {extra}
        <button type="button" title="Locate on map" onClick={onLocate} className="text-(--text-dim) hover:text-(--text-h)">
          <Crosshair className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
        <button type="button" title="Delete" onClick={onDelete} className="text-(--text-dim) hover:text-(--hostile)">
          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
      </div>
    </div>
  )
}
