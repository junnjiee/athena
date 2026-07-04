import { useEffect, useRef, useState } from 'react'
import * as Cesium from 'cesium'
import { Search, Loader2 } from 'lucide-react'

interface Props {
  getViewer: () => Cesium.Viewer | undefined
}

type RequestState =
  | { kind: 'loading' }
  | { kind: 'results'; results: Cesium.GeocoderService.Result[] }
  | { kind: 'empty' }
  | { kind: 'error' }

export function GroundSearchPanel({ getViewer }: Props) {
  const [query, setQuery] = useState('')
  const [requestState, setRequestState] = useState<RequestState | null>(null)
  const requestIdRef = useRef(0)

  const trimmed = query.trim()
  const tooShort = trimmed.length < 3
  // Derived at render time rather than reset synchronously inside the effect below --
  // whenever the query is too short, the panel shows idle regardless of whatever
  // requestState is left over from a longer query the user just backspaced out of.
  const displayState = tooShort ? null : requestState

  useEffect(() => {
    if (tooShort) return
    const viewer = getViewer()
    if (!viewer) return

    const requestId = ++requestIdRef.current
    const timer = setTimeout(() => {
      setRequestState({ kind: 'loading' })
      const geocoder = new Cesium.IonGeocoderService({ scene: viewer.scene })
      geocoder
        .geocode(trimmed)
        .then((results) => {
          if (requestIdRef.current !== requestId) return
          setRequestState(results.length > 0 ? { kind: 'results', results } : { kind: 'empty' })
        })
        .catch(() => {
          if (requestIdRef.current !== requestId) return
          setRequestState({ kind: 'error' })
        })
    }, 300)

    return () => clearTimeout(timer)
  }, [trimmed, tooShort, getViewer])

  function handleSelect(result: Cesium.GeocoderService.Result) {
    const viewer = getViewer()
    if (!viewer) return
    viewer.camera.flyTo({ destination: result.destination })
    setQuery(result.displayName)
    setRequestState(null)
  }

  return (
    <div className="glass w-64 rounded-xl p-3">
      <div className="mb-2 flex items-center gap-1.5 text-xs tracking-wide text-(--text-dim)">
        <Search className="h-3 w-3" />
        SEARCH LOCATION
      </div>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search a place or address…"
        className="w-full border-b border-(--border) bg-transparent py-1 text-sm text-(--text-h) outline-none focus:border-(--accent)"
      />
      {displayState?.kind === 'loading' && (
        <div className="mt-2 flex items-center gap-2 text-xs text-(--text-dim)">
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
          Searching…
        </div>
      )}
      {displayState?.kind === 'empty' && <div className="mt-2 text-xs text-(--text-dim)">No results.</div>}
      {displayState?.kind === 'error' && <div className="mt-2 text-xs text-(--text-dim)">Search failed. Try again.</div>}
      {displayState?.kind === 'results' && (
        <ul className="mt-2 flex flex-col gap-1">
          {displayState.results.map((result, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => handleSelect(result)}
                className="w-full truncate rounded-md px-2 py-1 text-left text-sm text-(--text) transition-colors hover:bg-white/5 hover:text-(--text-h)"
              >
                {result.displayName}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
