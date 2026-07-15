// milsymbol's runtime module only has a default export (the `ms` namespace
// object), despite its .d.ts also declaring named exports -- Rolldown checks
// the real ESM bindings, so import the default.
import ms from 'milsymbol'
import type { ForceSide } from '../types/entities'

/** MIL-STD-2525C SIDCs: ground infantry unit at platoon echelon (position 12 'D'),
 *  friendly vs hostile frames. milsymbol renders the doctrinal shapes -- blue
 *  rectangle with crossed rifles, red diamond -- with the platoon dots on top. */
const UNIT_SIDC: Record<ForceSide, string> = {
  blue: 'SFGPUCI----D',
  red: 'SHGPUCI----D',
}

export interface UnitSymbol {
  /** data-URL for Cesium billboards */
  url: string
  /** CSS-pixel draw size (canvas is oversampled by dpr for crispness) */
  width: number
  height: number
  /** pre-rendered bitmap for 2D canvas contexts (topo view) */
  canvas: HTMLCanvasElement
}

const SYMBOL_SIZE = 20
const cache = new Map<ForceSide, UnitSymbol>()

/** Cached APP-6/2525 unit symbol per force side. Cheap to call from render
 *  loops -- symbols are built once per session. */
export function unitSymbol(side: ForceSide): UnitSymbol {
  const cached = cache.get(side)
  if (cached) return cached

  const symbol = new ms.Symbol(UNIT_SIDC[side], {
    size: SYMBOL_SIZE,
    outlineWidth: 2,
    outlineColor: 'rgba(10,13,18,0.6)',
  })
  const { width, height } = symbol.getSize()
  const dpr = window.devicePixelRatio || 1
  const built: UnitSymbol = {
    url: symbol.toDataURL(),
    width,
    height,
    canvas: symbol.asCanvas(dpr),
  }
  cache.set(side, built)
  return built
}
