import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileJson, Upload, X } from 'lucide-react'
import { useBattleground } from '../../state/battleground'
import { importReplay } from '../../lib/api'
import type { ReplayLog } from '../../types/replayLog'

interface Props {
  open: boolean
  onClose: () => void
}

/** Cheap structural check before ever hitting the network, so a bad paste
 *  fails fast with a readable message instead of a raw 400 body. The server's
 *  zod schema is the real gate; this only screens out obviously-wrong shapes
 *  (most commonly the stale schema_version 2 mock format). */
function isReplayShaped(value: unknown): value is ReplayLog {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return v.schema_version === 3 && typeof v.battlefield === 'object' && v.battlefield !== null && Array.isArray(v.steps)
}

export function ImportReplayModal({ open, onClose }: Props) {
  const meta = useBattleground((s) => s.meta)
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [raw, setRaw] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  async function handleFile(file: File) {
    setRaw(await file.text())
  }

  async function handleImport() {
    if (!meta) return
    setError(null)

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      setError('Not valid JSON.')
      return
    }
    if (!isReplayShaped(parsed)) {
      setError(
        'Not a schema_version 3 replay log — needs schema_version, battlefield, and steps. ' +
          '(An older schema_version 2 log — separate cover/concealment arrays — is not supported.)',
      )
      return
    }

    setBusy(true)
    try {
      await importReplay({ battlegroundId: meta.id, name: name.trim() || 'Untitled Run', replay: parsed })
      onClose()
      navigate('/simulations')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'failed to import replay')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="glass-deep flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium text-(--text-h)">Import Replay</div>
            <div className="text-xs text-(--text-dim)">
              Paste or upload a schema_version 3 replay log produced by the simulation engine.
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Close"
            className="rounded-md p-1.5 text-(--text-dim) transition-colors hover:text-(--text-h)"
          >
            <X className="h-4 w-4" strokeWidth={1.75} />
          </button>
        </div>

        {!meta ? (
          <div className="text-sm text-(--text-dim)">
            Generate or load a battleground first — a replay imports against the ground it was run on.
          </div>
        ) : (
          <>
            <div className="mb-3 text-xs text-(--text-dim)">
              Importing against <span className="text-(--text-h)">{meta.name}</span>
            </div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Run name"
              aria-label="Run name"
              className="mb-3 rounded-lg border border-(--border) bg-transparent px-3 py-2 text-sm text-(--text-h) placeholder:text-(--text-dim) focus:border-(--accent) focus:outline-none"
            />
            <label className="mb-3 flex w-fit cursor-pointer items-center gap-2 rounded-lg border border-(--border) px-3 py-1.5 text-xs text-(--text) transition-colors hover:border-(--border-strong) hover:text-(--text-h)">
              <Upload className="h-3.5 w-3.5" strokeWidth={1.75} />
              Upload .json
              <input
                type="file"
                accept="application/json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void handleFile(file)
                }}
              />
            </label>
            <textarea
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder='{"schema_version": 3, "battlefield": {...}, "steps": [...]}'
              aria-label="Replay JSON"
              className="min-h-48 flex-1 resize-none rounded-lg bg-black/20 p-3 font-mono text-xs text-(--text) focus:outline-none"
            />
            {error && <div className="mt-2 text-xs text-(--hostile)">{error}</div>}
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                disabled={busy || raw.trim() === ''}
                onClick={() => void handleImport()}
                className="flex items-center gap-2 rounded-xl bg-(--accent) px-5 py-2.5 text-sm font-medium text-(--panel-bg-solid) transition-colors hover:bg-(--accent-hover) disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-(--text-dim)"
              >
                <FileJson className="h-4 w-4" strokeWidth={1.75} />
                {busy ? 'Importing…' : 'Import Replay'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
