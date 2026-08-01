import { Scan, ScanEye } from 'lucide-react'
import { usePhoto } from '../../state/photo'

/** RECON-mode occlusion switch: by default the photoreal buildings really hide
 *  units and route markers (depth-tested); X-ray restores the always-on-top
 *  planning view. */
export function XRayToggle() {
  const xray = usePhoto((s) => s.xray)
  const setXray = usePhoto((s) => s.setXray)

  return (
    <button
      type="button"
      onClick={() => setXray(!xray)}
      title={xray ? 'X-ray on — markers visible through buildings' : 'X-ray off — buildings occlude markers'}
      className={`glass flex h-11 items-center gap-2 rounded-xl px-3 text-sm transition-colors ${
        xray ? 'text-(--accent)' : 'text-(--text) hover:text-(--text-h)'
      }`}
    >
      {xray ? <ScanEye className="h-4 w-4" strokeWidth={1.75} /> : <Scan className="h-4 w-4" strokeWidth={1.75} />}
      X-ray
    </button>
  )
}
