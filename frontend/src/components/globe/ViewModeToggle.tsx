export type ViewMode = 'globe' | 'topo' | 'photo'

interface Props {
  mode: ViewMode
  onChange: (mode: ViewMode) => void
  disabled: boolean
  /** whether a photoreal tile source is configured (Google key or ion token) */
  photoAvailable: boolean
}

const MODES: { mode: ViewMode; label: string; title: string }[] = [
  { mode: 'globe', label: 'Globe', title: 'Globe view' },
  { mode: 'topo', label: 'Topo', title: 'Topo map view' },
  { mode: 'photo', label: 'Recon', title: 'Photorealistic recon view' },
]

/** Switches between the 3D Cesium scene, the stylized 2D topo-map review view,
 *  and the photorealistic RECON view (Google 3D Tiles + splat hero assets in the
 *  same Cesium scene). Deliberately separate from MapControls' own 2D/3D
 *  scene-mode toggle -- that one is Cesium's own orthographic-vs-perspective
 *  camera projection on the same 3D scene. */
export function ViewModeToggle({ mode, onChange, disabled, photoAvailable }: Props) {
  return (
    <div className={`glass flex h-11 overflow-hidden rounded-xl ${disabled ? 'opacity-40' : ''}`}>
      {MODES.map((entry, i) => {
        const photoLocked = entry.mode === 'photo' && !photoAvailable
        return (
          <div key={entry.mode} className="flex h-full">
            {i > 0 && <div className="h-full w-px bg-(--border)" />}
            <button
              type="button"
              disabled={disabled || photoLocked}
              onClick={() => onChange(entry.mode)}
              title={
                photoLocked
                  ? 'Set VITE_GOOGLE_MAPS_KEY (or a real VITE_CESIUM_ION_TOKEN) to enable photorealistic recon'
                  : entry.title
              }
              className={`flex h-full items-center justify-center px-3 text-sm transition-colors disabled:cursor-not-allowed ${
                photoLocked
                  ? 'text-(--text-dim) opacity-50'
                  : mode === entry.mode
                    ? 'bg-white/10 text-(--text-h)'
                    : 'text-(--text) hover:text-(--text-h)'
              }`}
            >
              {entry.label}
            </button>
          </div>
        )
      })}
    </div>
  )
}
