import { create } from 'zustand'

export interface PhotoTileStats {
  loaded: number
  pending: number
  /** current maximumScreenSpaceError stage (coarse → sharp) */
  sse: number
}

/** UI-facing state for RECON (photorealistic) mode. Written by
 *  PhotoModeController (inside the Cesium tree), read by page-level chrome
 *  (ViewModeToggle hint, X-ray button, TileStatsHud). */
interface PhotoState {
  /** photo view currently active */
  active: boolean
  /** Google tileset created and preloading in the background */
  warming: boolean
  /** initialTilesLoaded fired at least once */
  ready: boolean
  /** see-through markers (disable depth test) vs real occlusion */
  xray: boolean
  /** last toggle → first-photon (initialTilesLoaded) duration */
  toggleMs: number | null
  /** median DEM-vs-mesh vertical disagreement over probe points */
  meshOffsetM: number | null
  stats: PhotoTileStats | null
  /** number of gaussian-splat hero tilesets mounted */
  splatCount: number

  setXray: (xray: boolean) => void
  patch: (partial: Partial<Omit<PhotoState, 'setXray' | 'patch'>>) => void
}

export const usePhoto = create<PhotoState>((set) => ({
  active: false,
  warming: false,
  ready: false,
  xray: false,
  toggleMs: null,
  meshOffsetM: null,
  stats: null,
  splatCount: 0,

  setXray: (xray) => set({ xray }),
  patch: (partial) => set(partial),
}))
