import { Triangle, Map, ClipboardList, Activity, Radar, Users, Settings } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'

/** Battleground/Plans/Settings have real pages -- the rest stay non-interactive
 *  stubs (no `path`) rather than wiring up routes that don't exist yet.
 *  Tracked in issues #54-#58. */
const NAV_ITEMS = [
  { label: 'Battleground', icon: Map, path: '/' },
  { label: 'Plans', icon: ClipboardList, path: '/plans' },
  { label: 'Simulations', icon: Activity, path: null },
  { label: 'Intel', icon: Radar, path: null },
  { label: 'Units', icon: Users, path: null },
  { label: 'Settings', icon: Settings, path: '/settings' },
]

/** Floating glass navigation rail — self-positioned on the left edge. */
export function Sidebar() {
  const location = useLocation()
  const navigate = useNavigate()

  return (
    <aside className="glass-deep pointer-events-auto absolute top-4 bottom-4 left-4 z-30 flex w-52 flex-col rounded-2xl">
      <div className="flex items-center gap-2 px-5 py-5">
        <Triangle className="h-4 w-4 text-(--text-h)" strokeWidth={2.5} />
        <span className="text-sm font-semibold tracking-widest text-(--text-h)">ATHENA</span>
      </div>

      <nav className="flex flex-col gap-1 px-3">
        {NAV_ITEMS.map(({ label, icon: Icon, path }) => {
          const active = path !== null && location.pathname === path
          return (
            <button
              key={label}
              type="button"
              disabled={path === null}
              onClick={path ? () => navigate(path) : undefined}
              className={`relative flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                active
                  ? 'bg-white/10 text-(--text-h)'
                  : path === null
                    ? 'cursor-not-allowed text-(--text-dim)'
                    : 'text-(--text) hover:bg-white/5 hover:text-(--text-h)'
              }`}
            >
              {active && (
                <span className="absolute top-1/2 left-0 h-4 w-0.5 -translate-y-1/2 rounded-full bg-(--accent)" />
              )}
              <Icon className="h-4 w-4" strokeWidth={1.75} />
              {label}
            </button>
          )
        })}
      </nav>

      <div className="mt-auto flex items-center gap-2 border-t border-(--border) px-4 py-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-xs font-medium text-(--text-h)">
          TC
        </div>
        <div className="leading-tight">
          <div className="text-sm text-(--text-h)">Tim Chia</div>
          <div className="text-xs text-(--text-dim)">Commander</div>
        </div>
      </div>
    </aside>
  )
}
