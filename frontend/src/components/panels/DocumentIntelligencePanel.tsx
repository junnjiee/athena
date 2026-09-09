import { useRef, useState } from 'react'
import { Check, FileUp, Loader2, MapPin, X } from 'lucide-react'
import {
  extractDocumentIntelligence,
  resolveNamedPlace,
  type PlaceLookupResult,
} from '../../lib/api'
import type { ReserveProposal } from '../../types/documentIntelligence'
import type { BBoxDeg } from '../../types/terrain'

interface LocatedProposal {
  proposal: ReserveProposal
  place: PlaceLookupResult | null
}

export function DocumentIntelligencePanel({
  bbox,
  onAccept,
}: {
  bbox: BBoxDeg
  onAccept: (proposal: ReserveProposal, place: PlaceLookupResult) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [files, setFiles] = useState<File[]>([])
  const [results, setResults] = useState<LocatedProposal[]>([])
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function analyse() {
    if (files.length === 0 || running) return
    setRunning(true)
    setError(null)
    try {
      const intelligence = await extractDocumentIntelligence(files)
      const located = await Promise.all(intelligence.proposals.map(async (proposal) => ({
        proposal,
        place: await resolveNamedPlace(proposal.locality, bbox).catch(() => null),
      })))
      setResults(located)
      if (intelligence.rejected.length > 0) {
        setError(`${intelligence.rejected.length} claim${intelligence.rejected.length === 1 ? '' : 's'} rejected for unknown sources.`)
      }
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : 'Documents could not be analysed')
    } finally {
      setRunning(false)
    }
  }

  function accept(index: number) {
    const result = results[index]
    if (!result?.place) return
    onAccept(result.proposal, result.place)
    setResults((current) => current.filter((_, candidate) => candidate !== index))
  }

  return (
    <div className="mb-2 rounded-lg border border-(--border) bg-black/10 p-2">
      <div className="flex items-center justify-between text-[10px] tracking-wide text-(--text-dim)">
        <span>DOCUMENT INTELLIGENCE</span>
        <button
          type="button"
          title="Choose documents"
          aria-label="Choose documents"
          onClick={() => inputRef.current?.click()}
          className="hover:text-(--text-h)"
        >
          <FileUp className="h-3.5 w-3.5" />
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".pdf,.docx,.md,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
        className="hidden"
        onChange={(event) => {
          setFiles(Array.from(event.target.files ?? []).slice(0, 20))
          setResults([])
          setError(null)
        }}
      />
      <button
        type="button"
        disabled={running}
        onClick={() => files.length === 0 ? inputRef.current?.click() : void analyse()}
        className="mt-1.5 flex w-full items-center justify-center gap-1 rounded bg-white/7 px-2 py-1.5 text-[11px] text-(--text) hover:bg-white/10 disabled:opacity-40"
      >
        {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileUp className="h-3 w-3" />}
        {running ? 'Extracting…' : files.length ? `Analyse ${files.length} document${files.length === 1 ? '' : 's'}` : 'Choose documents'}
      </button>
      <div className="mt-1 text-[9px] leading-tight text-amber-300/90">
        Extracted plain text is sent to the configured model provider. Do not upload material that may not leave this machine.
      </div>
      {files.length > 0 && <div className="mt-1 truncate text-[9px] text-(--text-dim)">{files.map((file) => file.name).join(' · ')}</div>}
      {error && <div className="mt-1 text-[9px] text-amber-300">{error}</div>}
      <div className="mt-1.5 space-y-1">
        {results.map(({ proposal, place }, index) => (
          <div key={`${proposal.name}:${proposal.locality}`} className="rounded border border-(--border) p-1.5">
            <div className="flex items-center gap-1 text-[10px] text-(--text-h)">
              <span className="min-w-0 flex-1 truncate">{proposal.name} · IVO {proposal.locality}</span>
              <span className={proposal.intelligence_status === 'confirmed' ? 'text-(--hostile)' : 'text-pink-300'}>
                {proposal.intelligence_status.toUpperCase()}
              </span>
              <button type="button" title="Dismiss proposal" onClick={() => setResults((current) => current.filter((_, candidate) => candidate !== index))}>
                <X className="h-3 w-3 text-(--text-dim)" />
              </button>
            </div>
            <div className="mt-0.5 text-[9px] text-(--text-dim)">
              {proposal.source_document_ids.length} independent source{proposal.source_document_ids.length === 1 ? '' : 's'}
            </div>
            <div className="mt-1 max-h-20 space-y-0.5 overflow-y-auto border-l border-(--border) pl-1.5 text-[9px] text-(--text-dim)">
              {proposal.claims.map((claim, claimIndex) => (
                <div key={`${claim.source_document_id}:${claimIndex}`}>
                  <span className="text-(--text)" title={claim.source_document_id}>
                    {claim.source_document_name ?? claim.source_document_id}
                  </span>: “{claim.evidence}”
                </div>
              ))}
            </div>
            {proposal.claims.length > 1 && (
              <div className="mt-1 text-[9px] text-(--text-dim)">Only facts on which sources agree populate the mark.</div>
            )}
            <button
              type="button"
              disabled={!place}
              title={place ? `Place at ${place.name}` : 'Locality was not resolved inside this AO'}
              onClick={() => accept(index)}
              className="mt-1 flex items-center gap-1 text-[9px] text-(--accent) disabled:text-(--text-dim)"
            >
              {place ? <Check className="h-3 w-3" /> : <MapPin className="h-3 w-3" />}
              {place ? `Accept at ${place.name}` : 'Locality unresolved · place manually'}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
