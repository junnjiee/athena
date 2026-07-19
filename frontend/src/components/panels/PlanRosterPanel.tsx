import { useState } from 'react'
import { AlertTriangle, Crosshair, Route as RouteIcon, ShieldAlert, Star, Trash2, TrendingUp, Turtle, Users, Waves } from 'lucide-react'
import { useBattleground } from '../../state/battleground'
import { estimateMovement } from '../../lib/movement'
import { MOVEMENT_PROFILES } from '../../types/movement'
import type { GridData, Weather } from '../../types/terrain'
import type { LonLat, PlacedObjective, PlacedRoute, PlacedUnit } from '../../types/entities'
import type { PlanWarning, WarningKind } from '../../lib/validate'

interface Props {
  units: PlacedUnit[]
  objectives: PlacedObjective[]
  routes: PlacedRoute[]
  onLocate: (positions: LonLat[]) => void
  onDeleteUnit: (id: string) => void
  onDeleteObjective: (id: string) => void
  onDeleteRoute: (id: string) => void
}

type PanelTab = 'roster' | 'validation'

const KIND_ICON: Record<WarningKind, typeof AlertTriangle> = {
  steep: TrendingUp,
  water: Waves,
  exposed: ShieldAlert,
  slow: Turtle,
}

/** Compact "gait · time · fatigue" line under each route row. */
function routeEstimateLabel(route: PlacedRoute, grid: GridData | null, weather: Weather | null): string {
  const est = estimateMovement(route.points, route.movementType, route.loadout, grid, weather)
  const time = est.durationMin >= 1 ? `${Math.round(est.durationMin)} min` : `${Math.round(est.durationMin * 60)} s`
  return `${MOVEMENT_PROFILES[route.movementType].label} · ${time} · fatigue ${est.fatigueIndex}`
}

/** Combines the plan roster and its validation findings into one tabbed panel
 *  (previously two separately-stacked panels in different screen columns) --
 *  only one tab's content is ever visible at a time, so the panel's height
 *  stays naturally bounded by whichever list is showing, instead of both
 *  lists' heights stacking up and risking a collision with a neighboring
 *  column. */
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
  const analysis = useBattleground((s) => s.planAnalysis)
  const [activeTab, setActiveTab] = useState<PanelTab>('roster')

  const warningCount = analysis?.warnings.length ?? 0
  const hasRoster = units.length > 0 || objectives.length > 0 || routes.length > 0
  if (!hasRoster && warningCount === 0) return null

  return (
    <div className="glass w-60 rounded-xl p-3">
      <div className="mb-2 flex gap-1 text-xs tracking-wide">
        <TabButton label="Units & Objectives" active={activeTab === 'roster'} onClick={() => setActiveTab('roster')} />
        <TabButton
          label="Validation"
          active={activeTab === 'validation'}
          onClick={() => setActiveTab('validation')}
          badge={warningCount > 0 ? warningCount : undefined}
        />
      </div>

      {activeTab === 'roster' ? (
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
          {!hasRoster && <div className="px-1.5 py-2 text-xs text-(--text-dim)">Nothing placed yet.</div>}
        </div>
      ) : (
        <div className="flex max-h-64 flex-col gap-1 overflow-y-auto pr-1">
          {warningCount === 0 ? (
            <div className="px-1.5 py-2 text-xs text-(--text-dim)">No issues found.</div>
          ) : (
            analysis!.warnings.map((warning) => <WarningRow key={warning.id} warning={warning} onLocate={onLocate} />)
          )}
        </div>
      )}
    </div>
  )
}

function TabButton({
  label,
  active,
  onClick,
  badge,
}: {
  label: string
  active: boolean
  onClick: () => void
  badge?: number
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-1 items-center justify-center gap-1 rounded-md px-1.5 py-1 transition-colors ${
        active ? 'bg-white/10 text-(--text-h)' : 'text-(--text-dim) hover:text-(--text-h)'
      }`}
    >
      {label}
      {badge != null && (
        <span className="rounded-full bg-(--hostile) px-1.5 text-[10px] text-white">{badge}</span>
      )}
    </button>
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

function WarningRow({ warning, onLocate }: { warning: PlanWarning; onLocate: Props['onLocate'] }) {
  const Icon = KIND_ICON[warning.kind]
  const color = warning.severity === 'critical' ? 'text-(--hostile)' : 'text-amber-400'
  return (
    <button
      type="button"
      onClick={() => onLocate([warning.position])}
      className="flex items-start gap-2 rounded-md px-1.5 py-1.5 text-left text-xs text-(--text) transition-colors hover:bg-white/5 hover:text-(--text-h)"
    >
      <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${color}`} strokeWidth={1.75} />
      <span>{warning.message}</span>
    </button>
  )
}
