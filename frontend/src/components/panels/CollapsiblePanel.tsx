import { useCallback, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

/**
 * Collapses a floating panel to a one-line pill.
 *
 * The battleground screen stacks several always-on panels over the map, and the
 * map is the thing being looked at. Rather than restructure each panel, this
 * swaps between the panel as it is and a compact header, so a panel keeps its
 * own chrome when open and costs one line when shut.
 *
 * The choice is remembered per panel: an operator who closes the terrain layers
 * should not have to close them again on the next battleground.
 */

interface Props {
  /** Stable key for the remembered open/closed state. */
  id: string
  title: string
  icon: React.ReactNode
  defaultOpen?: boolean
  /** Matches the wrapped panel's own width so the pill lines up with it. */
  width?: string
  children: React.ReactNode
}

const STORAGE_PREFIX = 'athena.panel.'

function readStored(id: string, fallback: boolean): boolean {
  try {
    const stored = localStorage.getItem(STORAGE_PREFIX + id)
    return stored === null ? fallback : stored === 'open'
  } catch {
    // Private browsing and similar. A panel that cannot remember its state is
    // not worth failing a render over.
    return fallback
  }
}

export function CollapsiblePanel({
  id,
  title,
  icon,
  defaultOpen = true,
  width = 'w-60',
  children,
}: Props) {
  // Read once, lazily. There is no server render to disagree with, so the first
  // paint can be the remembered state rather than a flash of the default.
  const [open, setOpen] = useState(() => readStored(id, defaultOpen))

  const toggle = useCallback(() => {
    setOpen((current) => {
      const next = !current
      try {
        localStorage.setItem(STORAGE_PREFIX + id, next ? 'open' : 'closed')
      } catch {
        // Not remembering is fine; not toggling is not.
      }
      return next
    })
  }, [id])

  if (open) {
    return (
      <div className="relative">
        <button
          type="button"
          onClick={toggle}
          title={`Collapse ${title}`}
          className="absolute top-2.5 right-2.5 z-10 rounded p-0.5 text-(--text-dim) transition-colors hover:text-(--text-h)"
        >
          <ChevronDown className="h-3.5 w-3.5" strokeWidth={1.75} />
        </button>
        {children}
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={toggle}
      title={`Expand ${title}`}
      className={`glass flex ${width} items-center gap-2 rounded-xl px-3 py-2 text-left text-xs text-(--text) transition-colors hover:text-(--text-h)`}
    >
      {icon}
      <span className="flex-1 truncate tracking-wide">{title}</span>
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-(--text-dim)" strokeWidth={1.75} />
    </button>
  )
}
