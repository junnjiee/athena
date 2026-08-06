import { create } from 'zustand'

/**
 * Confirmation gate for destructive assistant tools.
 *
 * Speech recognition mishears, and "clear the plan" is one syllable away from
 * things a commander might reasonably say. A misheard word should not silently
 * destroy a drawing (#61).
 *
 * The tool doesn't block: it parks the action here, returns a sentence telling
 * the operator to confirm on screen, and the agent moves on. The dock renders
 * the prompt; confirming runs the committed action, and its result is fed back
 * to the agent as a contextual update so the conversation stays coherent.
 */

export interface PendingAction {
  id: number
  /** short line rendered on the confirmation chip */
  summary: string
  /** performs the action and returns what to report afterwards */
  commit: () => string
}

interface ConfirmState {
  pending: PendingAction | null
  /** Result of the most recently confirmed or cancelled action, for the dock to
   *  relay back to the agent. Cleared once read. */
  lastOutcome: string | null

  request: (action: Omit<PendingAction, 'id'>) => void
  confirm: () => void
  cancel: () => void
  takeOutcome: () => string | null
}

let nextId = 1

export const useConfirm = create<ConfirmState>((set, get) => ({
  pending: null,
  lastOutcome: null,

  request: (action) => set({ pending: { ...action, id: nextId++ } }),

  confirm: () => {
    const pending = get().pending
    if (!pending) return
    // Clear first: commit() mutates the plan, and a re-render mid-commit should
    // never find a stale prompt still on screen.
    set({ pending: null })
    set({ lastOutcome: pending.commit() })
  },

  cancel: () => {
    const pending = get().pending
    if (!pending) return
    set({ pending: null, lastOutcome: 'Cancelled — nothing was removed.' })
  },

  takeOutcome: () => {
    const outcome = get().lastOutcome
    if (outcome !== null) set({ lastOutcome: null })
    return outcome
  },
}))

/** Parks a destructive action behind on-screen confirmation and returns the
 *  sentence the agent should speak while it waits. */
export function requestConfirmation(action: {
  summary: string
  spoken: string
  commit: () => string
}): string {
  useConfirm.getState().request({ summary: action.summary, commit: action.commit })
  return action.spoken
}
