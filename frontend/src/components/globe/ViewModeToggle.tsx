export type ViewMode = 'globe' | 'topo'

interface Props {
  mode: ViewMode
  onChange: (mode: ViewMode) => void
  disabled: boolean
}

/** Switches between the 3D Cesium scene and the stylized 2D topo-map review view.
 *  Deliberately separate from MapControls' own 2D/3D scene-mode toggle -- that one
 *  is Cesium's own orthographic-vs-perspective camera projection on the same 3D
 *  scene, unrelated to this Cesium-independent alternate rendering surface. */
export function ViewModeToggle({ mode, onChange, disabled }: Props) {
  return (
    <div className={`glass flex h-11 overflow-hidden rounded-xl ${disabled ? 'opacity-40' : ''}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange('globe')}
        title="Globe view"
        className={`flex h-full items-center justify-center px-3 text-sm transition-colors disabled:cursor-not-allowed ${
          mode === 'globe' ? 'bg-white/10 text-(--text-h)' : 'text-(--text) hover:text-(--text-h)'
        }`}
      >
        Globe
      </button>
      <div className="h-full w-px bg-(--border)" />
      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange('topo')}
        title="Topo map view"
        className={`flex h-full items-center justify-center px-3 text-sm transition-colors disabled:cursor-not-allowed ${
          mode === 'topo' ? 'bg-white/10 text-(--text-h)' : 'text-(--text) hover:text-(--text-h)'
        }`}
      >
        Topo
      </button>
    </div>
  )
}
