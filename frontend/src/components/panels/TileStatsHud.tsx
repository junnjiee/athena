import { Gauge } from 'lucide-react'
import { usePhoto } from '../../state/photo'
import { photoSource } from '../../lib/photoTiles'
import { QUALITY_TIERS } from '../../lib/frameGovernor'

/** Dev/demo HUD proving the RECON-mode latency story: tile stream state,
 *  time-to-first-photon on the mode toggle, current sharpening stage, and the
 *  measured DEM-vs-mesh vertical disagreement. Enabled with `?hud=1`. */
export function TileStatsHud() {
  const active = usePhoto((s) => s.active)
  const warming = usePhoto((s) => s.warming)
  const ready = usePhoto((s) => s.ready)
  const toggleMs = usePhoto((s) => s.toggleMs)
  const meshOffsetM = usePhoto((s) => s.meshOffsetM)
  const stats = usePhoto((s) => s.stats)
  const splatCount = usePhoto((s) => s.splatCount)
  const tier = usePhoto((s) => s.tier)

  if (!active) return null

  const source = photoSource()
  const stream = warming ? 'warming' : ready ? 'ready' : 'streaming'

  return (
    <div className="glass w-56 rounded-xl p-3 text-xs">
      <div className="mb-2 flex items-center gap-1.5 tracking-wide text-(--text-dim)">
        <Gauge className="h-3 w-3" />
        RECON STREAM
      </div>
      <dl className="flex flex-col gap-1">
        <Row label="Source" value={source === 'google' ? 'Google CDN' : source === 'ion' ? 'ion proxy' : '—'} />
        <Row label="Stream" value={stream} />
        <Row label="First photon" value={toggleMs === null ? '…' : toggleMs === 0 ? 'warm (0 ms)' : `${toggleMs} ms`} />
        {stats && <Row label="Tiles" value={`${stats.loaded} loaded · ${stats.pending} pending`} />}
        <Row
          label="Quality"
          value={`T${tier} · SSE ${QUALITY_TIERS[tier].sse} · ${Math.round(QUALITY_TIERS[tier].resolutionScale * 100)}%`}
        />
        {stats && <Row label="Detail (SSE)" value={stats.sse <= 16 ? `sharp (${stats.sse})` : `coarse (${stats.sse})`} />}
        <Row label="Mesh vs DEM" value={meshOffsetM === null ? '…' : `${meshOffsetM >= 0 ? '+' : ''}${meshOffsetM.toFixed(1)} m`} />
        <Row label="Hero splats" value={String(splatCount)} />
      </dl>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-(--text-dim)">{label}</span>
      <span className="text-(--text-h)">{value}</span>
    </div>
  )
}
