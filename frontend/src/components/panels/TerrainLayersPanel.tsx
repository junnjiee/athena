import {
  Satellite as SatelliteIcon,
  Mountain,
  Building2,
  Route,
  Trees,
  Waves,
  Eye,
  EyeOff,
} from 'lucide-react'
import { useBattleground, type BattlefieldLayerToggles } from '../../state/battleground'

interface Props {
  satelliteVisible: boolean
  onToggleSatellite: () => void
  elevationExaggerated: boolean
  onToggleElevation: () => void
  /** RECON mode pins verticalExaggeration to 1.0 (it distorts the photoreal
   *  mesh) -- lock the toggle while active. */
  photoActive?: boolean
}

const BATTLEFIELD_LAYERS: { key: keyof BattlefieldLayerToggles; label: string; icon: typeof Mountain }[] = [
  { key: 'buildings', label: 'Buildings', icon: Building2 },
  { key: 'roads', label: 'Roads', icon: Route },
  { key: 'trees', label: 'Vegetation', icon: Trees },
  { key: 'water', label: 'Water', icon: Waves },
]

export function TerrainLayersPanel({
  satelliteVisible,
  onToggleSatellite,
  elevationExaggerated,
  onToggleElevation,
  photoActive = false,
}: Props) {
  const phase = useBattleground((s) => s.phase)
  const layers = useBattleground((s) => s.layers)
  const toggleLayer = useBattleground((s) => s.toggleLayer)
  const battlefieldReady = phase === 'ready'

  return (
    <div className="glass w-44 rounded-xl p-3">
      <div className="mb-2 text-xs tracking-wide text-(--text-dim)">TERRAIN LAYERS</div>
      <div className="flex flex-col">
        <LayerRow
          label="Satellite"
          Icon={SatelliteIcon}
          visible={satelliteVisible}
          onToggle={onToggleSatellite}
        />
        <LayerRow
          label="Terrain Exaggeration"
          Icon={Mountain}
          visible={elevationExaggerated && !photoActive}
          disabled={photoActive}
          onToggle={onToggleElevation}
        />
        {BATTLEFIELD_LAYERS.map(({ key, label, icon }) => (
          <LayerRow
            key={key}
            label={label}
            Icon={icon}
            visible={battlefieldReady && layers[key]}
            disabled={!battlefieldReady}
            onToggle={() => toggleLayer(key)}
          />
        ))}
      </div>
    </div>
  )
}

interface RowProps {
  label: string
  Icon: typeof Mountain
  visible: boolean
  disabled?: boolean
  onToggle: () => void
}

function LayerRow({ label, Icon, visible, disabled, onToggle }: RowProps) {
  return (
    <div
      className={`flex items-center justify-between rounded-md px-1.5 py-1.5 text-sm ${
        disabled ? 'opacity-40' : 'hover:bg-white/5'
      }`}
    >
      <div className={`flex items-center gap-2 ${visible ? 'text-(--text-h)' : 'text-(--text-dim)'}`}>
        <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
        {label}
      </div>
      <button
        type="button"
        disabled={disabled}
        onClick={onToggle}
        className="text-(--text-dim) hover:text-(--text-h) disabled:cursor-not-allowed"
      >
        {visible ? <Eye className="h-3.5 w-3.5" strokeWidth={1.75} /> : <EyeOff className="h-3.5 w-3.5" strokeWidth={1.75} />}
      </button>
    </div>
  )
}
