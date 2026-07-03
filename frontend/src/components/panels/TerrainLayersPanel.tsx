import { useState } from 'react'
import {
  Satellite as SatelliteIcon,
  Mountain,
  TrendingUp,
  Shield,
  Leaf,
  Building2,
  Route,
  ScanEye,
  Eye,
  EyeOff,
} from 'lucide-react'

interface Props {
  satelliteVisible: boolean
  onToggleSatellite: () => void
  elevationExaggerated: boolean
  onToggleElevation: () => void
}

const STUB_LAYERS = [
  { label: 'Slope', icon: TrendingUp, defaultVisible: false },
  { label: 'Cover', icon: Shield, defaultVisible: false },
  { label: 'Vegetation', icon: Leaf, defaultVisible: false },
  { label: 'Buildings', icon: Building2, defaultVisible: false },
  { label: 'Roads', icon: Route, defaultVisible: false },
  { label: 'LOS', icon: ScanEye, defaultVisible: false },
]

export function TerrainLayersPanel({
  satelliteVisible,
  onToggleSatellite,
  elevationExaggerated,
  onToggleElevation,
}: Props) {
  const [stubVisibility, setStubVisibility] = useState(() =>
    Object.fromEntries(STUB_LAYERS.map((l) => [l.label, l.defaultVisible])),
  )

  return (
    <div className="w-44 rounded-lg border border-(--border) bg-(--panel-bg) p-3 backdrop-blur-md shadow-(--shadow)">
      <div className="mb-2 text-xs tracking-wide text-(--text-dim)">TERRAIN LAYERS</div>
      <div className="flex flex-col">
        <LayerRow
          label="Satellite"
          Icon={SatelliteIcon}
          visible={satelliteVisible}
          onToggle={onToggleSatellite}
        />
        <LayerRow
          label="Elevation"
          Icon={Mountain}
          visible={elevationExaggerated}
          onToggle={onToggleElevation}
        />
        {STUB_LAYERS.map(({ label, icon }) => (
          <LayerRow
            key={label}
            label={label}
            Icon={icon}
            visible={stubVisibility[label]}
            onToggle={() => setStubVisibility((s) => ({ ...s, [label]: !s[label] }))}
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
  onToggle: () => void
}

function LayerRow({ label, Icon, visible, onToggle }: RowProps) {
  return (
    <div className="flex items-center justify-between rounded-md px-1.5 py-1.5 text-sm hover:bg-white/5">
      <div className={`flex items-center gap-2 ${visible ? 'text-(--text-h)' : 'text-(--text-dim)'}`}>
        <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />
        {label}
      </div>
      <button type="button" onClick={onToggle} className="text-(--text-dim) hover:text-(--text-h)">
        {visible ? <Eye className="h-3.5 w-3.5" strokeWidth={1.75} /> : <EyeOff className="h-3.5 w-3.5" strokeWidth={1.75} />}
      </button>
    </div>
  )
}
