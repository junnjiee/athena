import { createJSONStorage } from 'zustand/middleware'
import type { StateStorage } from 'zustand/middleware'

/**
 * Storage backend for persisted stores.
 *
 * `localStorage` when the environment provides it, an in-memory map otherwise.
 * Without the fallback, zustand logs "the given storage is currently
 * unavailable" on every write anywhere there is no DOM — which is every unit
 * test — burying real output in noise. State still behaves correctly in that
 * case; it just doesn't outlive the process, which is what a test wants anyway.
 */
function memoryStorage(): StateStorage {
  const map = new Map<string, string>()
  return {
    getItem: (name) => map.get(name) ?? null,
    setItem: (name, value) => {
      map.set(name, value)
    },
    removeItem: (name) => {
      map.delete(name)
    },
  }
}

const fallback = memoryStorage()

export const persistedStorage = createJSONStorage(() => {
  try {
    // Accessing localStorage throws outright when cookies are blocked, so a
    // typeof check alone isn't enough.
    if (typeof localStorage === 'undefined') return fallback
    localStorage.getItem('__athena_probe__')
    return localStorage
  } catch {
    return fallback
  }
})
