import { Triangle, Route, Settings, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useShell } from '../../state/shell'

/** Only the two surfaces a commander actually works in today. The tactical
 *  battleground, plans, intel and units pages still answer on their URLs, but
 *  none of them carry the route-substrate workflow, so putting them in the rail
 *  only offers dead ends. */
const NAV_ITEMS = [
  { label: 'Planning', icon: Route, path: '/route-studies' },
  { label: 'Settings', icon: Settings, path: '/settings' },
]

/** Floating glass navigation rail — self-positioned on the left edge.
 *
 *  Retracts to an icon strip rather than disappearing. The map wants every
 *  pixel it can get, but a rail that vanishes entirely leaves no way back that
 *  is visible on the surface itself. */
export function Sidebar() {
  const location = useLocation()
  const navigate = useNavigate()
  const collapsed = useShell((state) => state.railCollapsed)
  const toggleRail = useShell((state) => state.toggleRail)

  return (
    <aside
      className={`glass-deep pointer-events-auto absolute top-4 bottom-4 left-4 z-30 flex flex-col rounded-2xl transition-[width] duration-200 ${
        collapsed ? 'w-14' : 'w-52'
      }`}
    >
      <div className={`flex items-center py-5 ${collapsed ? 'justify-center px-0' : 'gap-2 px-5'}`}>
        <Triangle className="h-4 w-4 shrink-0 text-(--text-h)" strokeWidth={2.5} />
        {!collapsed && (
          <span className="text-sm font-semibold tracking-widest text-(--text-h)">ATHENA</span>
        )}
      </div>

      <nav className={`flex flex-col gap-1 ${collapsed ? 'px-2' : 'px-3'}`}>
        {NAV_ITEMS.map(({ label, icon: Icon, path }) => {
          const active = location.pathname === path
          return (
            <button
              key={label}
              type="button"
              title={collapsed ? label : undefined}
              aria-label={label}
              onClick={() => navigate(path)}
              className={`relative flex items-center rounded-lg py-2 text-left text-sm transition-colors ${
                collapsed ? 'justify-center px-0' : 'gap-3 px-3'
              } ${
                active
                  ? 'bg-white/10 text-(--text-h)'
                  : 'text-(--text) hover:bg-white/5 hover:text-(--text-h)'
              }`}
            >
              {active && (
                <span className="absolute top-1/2 left-0 h-4 w-0.5 -translate-y-1/2 rounded-full bg-(--accent)" />
              )}
              <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
              {!collapsed && label}
            </button>
          )
        })}
      </nav>

      <div className={`mt-auto flex flex-col gap-3 border-t border-(--border) py-4 ${collapsed ? 'px-2' : 'px-4'}`}>
        <button
          type="button"
          onClick={toggleRail}
          title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          aria-expanded={!collapsed}
          className={`flex items-center rounded-lg py-2 text-sm text-(--text) transition-colors hover:bg-white/5 hover:text-(--text-h) ${
            collapsed ? 'justify-center px-0' : 'gap-3 px-3'
          }`}
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4 shrink-0" strokeWidth={1.75} />
          ) : (
            <PanelLeftClose className="h-4 w-4 shrink-0" strokeWidth={1.75} />
          )}
          {!collapsed && 'Collapse'}
        </button>

        <div className={`flex items-center ${collapsed ? 'justify-center' : 'gap-2'}`}>
          <div
            title={collapsed ? 'Tim Chia — Commander' : undefined}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs font-medium text-(--text-h)"
          >
            TC
          </div>
          {!collapsed && (
            <div className="leading-tight">
              <div className="text-sm text-(--text-h)">Tim Chia</div>
              <div className="text-xs text-(--text-dim)">Commander</div>
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}
