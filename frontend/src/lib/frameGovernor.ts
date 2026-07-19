/** Adaptive quality governor for RECON mode.
 *
 *  Photoreal streaming cost varies wildly with GPU, network, and view; a fixed
 *  quality setting either wastes headroom or tanks the framerate. The governor
 *  watches an EMA of frame time and walks a small ladder of quality tiers --
 *  degrading tile detail, render resolution, and finally splat visibility --
 *  so the mode converges to interactive framerates and sharpens back up when
 *  there's headroom. Pure state-machine (no Cesium imports) so it's testable.
 */

export interface QualityTier {
  /** tileset maximumScreenSpaceError -- higher = fewer/coarser tiles */
  sse: number
  /** viewer.resolutionScale -- fragment count scales with the square */
  resolutionScale: number
  /** whether gaussian-splat hero tilesets may render at this tier */
  splats: boolean
}

/** T0 (sharp) → T3 (survival). */
export const QUALITY_TIERS: readonly QualityTier[] = [
  { sse: 16, resolutionScale: 1.0, splats: true },
  { sse: 24, resolutionScale: 1.0, splats: true },
  { sse: 32, resolutionScale: 0.85, splats: true },
  { sse: 48, resolutionScale: 0.7, splats: false },
]

/** Entry tier: coarse-first paint; the governor sharpens toward T0 only when
 *  the frame budget proves it can afford to. */
export const ENTRY_TIER = 2

/** Degrade when the EMA is slower than ~25 fps... */
export const DEGRADE_MS = 40
/** ...recover only when comfortably fast (~45 fps) -- the gap is hysteresis. */
export const RECOVER_MS = 22
/** consecutive slow frames before degrading (reacts in well under a second) */
export const DEGRADE_FRAMES = 20
/** consecutive fast frames before sharpening (recovers deliberately) */
export const RECOVER_FRAMES = 120

const EMA_ALPHA = 0.1

export interface GovernorState {
  tier: number
  emaMs: number
  slowStreak: number
  fastStreak: number
}

export function initialGovernor(tier: number = ENTRY_TIER): GovernorState {
  return { tier, emaMs: 16, slowStreak: 0, fastStreak: 0 }
}

/** Advance one frame. Returns a new state; `state.tier` changing is the signal
 *  to re-apply tier settings to the scene. */
export function stepGovernor(state: GovernorState, frameMs: number): GovernorState {
  // clamp pathological samples (tab switches, GC pauses) so one spike can't
  // dominate the average
  const sample = Math.min(frameMs, 250)
  const emaMs = state.emaMs + EMA_ALPHA * (sample - state.emaMs)

  const slowStreak = emaMs > DEGRADE_MS ? state.slowStreak + 1 : 0
  const fastStreak = emaMs < RECOVER_MS ? state.fastStreak + 1 : 0

  if (slowStreak >= DEGRADE_FRAMES && state.tier < QUALITY_TIERS.length - 1) {
    return { tier: state.tier + 1, emaMs, slowStreak: 0, fastStreak: 0 }
  }
  if (fastStreak >= RECOVER_FRAMES && state.tier > 0) {
    return { tier: state.tier - 1, emaMs, slowStreak: 0, fastStreak: 0 }
  }
  return { tier: state.tier, emaMs, slowStreak, fastStreak }
}
