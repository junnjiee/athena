import { create } from 'zustand'

/** Chrome that every page shares.
 *
 *  The rail's width is not the rail's own business: four pages pin their panels
 *  clear of it, and they all have to agree on where its edge is. One store, so
 *  the offset can never disagree with what is drawn.
 */
interface ShellState {
  railCollapsed: boolean
  toggleRail: () => void
}

export const useShell = create<ShellState>()((set) => ({
  railCollapsed: false,
  toggleRail: () => set((state) => ({ railCollapsed: !state.railCollapsed })),
}))

/** Left offset for anything that must clear the rail, as a Tailwind class.
 *
 *  Collapsed the rail is an icon strip rather than nothing: on a surface where
 *  the map wants every pixel, navigation still has to be one click away. */
export function useRailOffset(): string {
  return useShell((state) => (state.railCollapsed ? 'left-22' : 'left-60'))
}
