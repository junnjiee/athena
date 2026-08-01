import { AlertTriangle } from 'lucide-react'
import { useBattleground } from '../../state/battleground'

/** Public Overpass mirrors are rate-limited and occasionally reject every
 *  request for a generation (see server/src/services/osm.ts's retry logic) --
 *  when that happens the pipeline degrades to satellite-only classification
 *  instead of failing outright (buildings/roads can no longer carve up the
 *  WorldCover/segmentation read, so land cover -- especially forest -- comes
 *  out far less accurate than usual). meta.featureCounts already carries this
 *  signal; it just wasn't shown anywhere before. */
export function DataQualityWarning() {
  const meta = useBattleground((s) => s.meta)
  if (!meta) return null
  if (meta.featureCounts.roads > 0 || meta.featureCounts.buildings > 0) return null

  return (
    <div className="glass w-56 rounded-xl border border-(--hostile)/40 bg-(--hostile)/10 p-3">
      <div className="flex items-start gap-2 text-xs text-(--text-h)">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-(--hostile)" strokeWidth={1.75} />
        <span>
          Map data unavailable for this area — classification relies on satellite land cover only and may be
          less accurate. Try regenerating.
        </span>
      </div>
    </div>
  )
}
