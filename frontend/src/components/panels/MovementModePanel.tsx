import { PersonStanding, Footprints, Rabbit, Wind, Backpack } from 'lucide-react'
import {
  LOAD_PRESETS,
  MOVEMENT_ORDER,
  MOVEMENT_PROFILES,
  loadoutFromPreset,
  type LoadPreset,
  type MovementLoadout,
  type MovementType,
} from '../../types/movement'

interface Props {
  movementType: MovementType
  onMovementTypeChange: (type: MovementType) => void
  loadout: MovementLoadout
  onLoadoutChange: (loadout: MovementLoadout) => void
  /** whether the route tool is currently armed (highlights the panel) */
  active: boolean
}

const GAIT_ICON: Record<MovementType, typeof Footprints> = {
  prowl: PersonStanding,
  patrol: Footprints,
  charge: Rabbit,
}

const LOAD_ORDER: Exclude<LoadPreset, 'custom'>[] = ['light', 'fighting', 'approach']

/** Gait + load selector for route drawing. The chosen gait is stamped on the next
 *  route you draw and styles its line; the loadout is carried for the future agent
 *  API's physiology. */
export function MovementModePanel({ movementType, onMovementTypeChange, loadout, onLoadoutChange, active }: Props) {
  const profile = MOVEMENT_PROFILES[movementType]

  return (
    <div className={`glass w-56 rounded-xl p-3 ${active ? 'ring-1 ring-(--accent-border)' : ''}`}>
      <div className="mb-2 flex items-center gap-1.5 text-xs tracking-wide text-(--text-dim)">
        <Wind className="h-3 w-3" />
        MOVEMENT ORDER
      </div>

      <div className="grid grid-cols-3 gap-1">
        {MOVEMENT_ORDER.map((type) => {
          const Icon = GAIT_ICON[type]
          const selected = type === movementType
          return (
            <button
              key={type}
              type="button"
              title={MOVEMENT_PROFILES[type].blurb}
              onClick={() => onMovementTypeChange(type)}
              className={`flex flex-col items-center gap-1 rounded-md border px-1 py-1.5 transition-colors ${
                selected
                  ? 'border-(--accent-border) bg-(--accent-bg) text-(--accent)'
                  : 'border-(--border) text-(--text-dim) hover:text-(--text-h)'
              }`}
            >
              <Icon className="h-4 w-4" strokeWidth={1.75} />
              <span className="text-[9px] leading-none">{MOVEMENT_PROFILES[type].label}</span>
            </button>
          )
        })}
      </div>

      <p className="mt-2 text-[11px] leading-snug text-(--text-dim)">{profile.blurb}</p>

      <div className="mt-2 grid grid-cols-3 gap-2 text-center text-[10px]">
        <Stat label="Speed" value={`${profile.baseSpeedMs.toFixed(1)} m/s`} />
        <Stat label="Stealth" value={`${Math.round(profile.stealth * 100)}%`} />
        <Stat label="Noise" value={`${Math.round(profile.noise * 100)}%`} />
      </div>

      <div className="mt-3 mb-1.5 flex items-center gap-1.5 text-xs tracking-wide text-(--text-dim)">
        <Backpack className="h-3 w-3" />
        LOAD · {loadout.loadMassKg} kg
      </div>
      <div className="flex items-center gap-1 rounded-md border border-(--border) p-0.5">
        {LOAD_ORDER.map((preset) => {
          const selected = loadout.preset === preset
          return (
            <button
              key={preset}
              type="button"
              title={`${LOAD_PRESETS[preset].label} — ${LOAD_PRESETS[preset].loadMassKg} kg`}
              onClick={() => onLoadoutChange(loadoutFromPreset(preset))}
              className={`flex-1 rounded px-2 py-1 text-xs transition-colors ${
                selected ? 'bg-white/10 text-(--text-h)' : 'text-(--text-dim) hover:text-(--text-h)'
              }`}
            >
              {LOAD_PRESETS[preset].label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-white/5 py-1">
      <div className="text-(--text-h)">{value}</div>
      <div className="text-(--text-dim)">{label}</div>
    </div>
  )
}
