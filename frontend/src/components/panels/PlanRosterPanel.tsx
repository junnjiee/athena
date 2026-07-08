import { Crosshair, Route as RouteIcon, Star, Trash2, Users } from 'lucide-react'
import { useBattleground } from '../../state/battleground'
import { estimateMovement } from '../../lib/movement'
import { MOVEMENT_PROFILES } from '../../types/movement'
import type { GridData, Weather } from '../../types/terrain'
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

/** Compact "gait · time · fatigue" line under each route row. */
function routeEstimateLabel(route: PlacedRoute, grid: GridData | null, weather: Weather | null): string {
  const est = estimateMovement(route.points, route.movementType, route.loadout, grid, weather)
  const time = est.durationMin >= 1 ? `${Math.round(est.durationMin)} min` : `${Math.round(est.durationMin * 60)} s`
  return `${MOVEMENT_PROFILES[route.movementType].label} · ${time} · fatigue ${est.fatigueIndex}`
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
  const grid = useBattleground((s) => s.grid)
  const weather = useBattleground((s) => s.meta?.weather ?? null)

  if (units.length === 0 && objectives.length === 0 && routes.length === 0) return null

  return (
    <div className="glass w-60 rounded-xl p-3">
      <div className="mb-2 text-xs tracking-wide text-(--text-dim)">UNITS & OBJECTIVES</div>
      <div className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
        {units.map((unit) => (
          <RosterRow
            key={unit.id}
            icon={<Users className={`h-3.5 w-3.5 ${unit.side === 'blue' ? 'text-(--friendly)' : 'text-(--hostile)'}`} strokeWidth={1.75} />}
            label={unit.side === 'blue' ? `${unit.name} · ${unit.typeLabel}` : `${unit.name} (threat)`}
            onLocate={() => onLocate([unit.position])}
            onDelete={() => onDeleteUnit(unit.id)}
          />
        ))}
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
              subtitle={routeEstimateLabel(route, grid, weather)}
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
  subtitle?: string
  onLocate: () => void
  onDelete: () => void
}

function RosterRow({ icon, label, subtitle, onLocate, onDelete }: RowProps) {
  return (
    <div className="group flex items-center justify-between gap-2 rounded-md px-1.5 py-1.5 text-sm hover:bg-white/5">
      <div className="flex min-w-0 items-center gap-2 text-(--text-h)">
        {icon}
        <div className="min-w-0">
          <div className="truncate">{label}</div>
          {subtitle && <div className="truncate text-[10px] text-(--text-dim)">{subtitle}</div>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
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
