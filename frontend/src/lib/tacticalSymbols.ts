export interface UnitSymbol {
  /** data-URL for Cesium billboards */
  url: string
  /** CSS-pixel draw size (canvas is oversampled by dpr for crispness) */
  width: number
  height: number
  /** pre-rendered bitmap for 2D canvas contexts (topo view) */
  canvas: HTMLCanvasElement
}

const HOSTILE_INK = '#e8564f' // matches --hostile

function makeCanvas(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const dpr = window.devicePixelRatio || 1
  const canvas = document.createElement('canvas')
  canvas.width = width * dpr
  canvas.height = height * dpr
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2d context unavailable')
  ctx.scale(dpr, dpr)
  return { canvas, ctx }
}

function toSymbol(canvas: HTMLCanvasElement, width: number, height: number): UnitSymbol {
  return { url: canvas.toDataURL('image/png'), width, height, canvas }
}

// Platoon ovals are sized up from section ovals (bigger unit = bigger symbol,
// same convention as the dot-count amplifier) and both are generously sized so
// a trench bracket can sit visually inside one without the shapes overlapping.
const AREA_SIZE: Record<2 | 3, { width: number; height: number }> = {
  2: { width: 76, height: 52 },
  3: { width: 96, height: 64 },
}

const areaCache = new Map<string, UnitSymbol>()

/** Area-position graphic (section/platoon): a transparent oval outline in the
 *  given side color, with 2 (section) or 3 (platoon) dots straddling its top
 *  edge -- the SAF unit-size amplifier style requested in place of a strict
 *  MIL-STD-2525C point icon. Shared by both blue and red sides. */
export function areaPositionSymbol(dots: 2 | 3, color: string): UnitSymbol {
  const cacheKey = `${dots}-${color}`
  const cached = areaCache.get(cacheKey)
  if (cached) return cached

  const { width, height } = AREA_SIZE[dots]
  const { canvas, ctx } = makeCanvas(width, height)

  const cx = width / 2
  const cy = height / 2 + 4
  const rx = width / 2 - 6
  const ry = height / 2 - 8

  ctx.lineWidth = 2.5
  ctx.strokeStyle = color
  ctx.beginPath()
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2)
  ctx.stroke()

  ctx.fillStyle = color
  const spacing = 10
  const startX = cx - ((dots - 1) * spacing) / 2
  for (let i = 0; i < dots; i++) {
    ctx.beginPath()
    ctx.arc(startX + i * spacing, cy - ry, 3, 0, Math.PI * 2)
    ctx.fill()
  }

  const symbol = toSymbol(canvas, width, height)
  areaCache.set(cacheKey, symbol)
  return symbol
}

const blueAreaCache = new Map<2 | 3, UnitSymbol>()

/** Blue-force area-position graphic (section/platoon): a transparent rectangle
 *  outline with an X-cross, plus 2 (section) or 3 (platoon) dots above it --
 *  the reference "own force section" doctrinal graphic, minus its separate
 *  small amplifier sub-box (simplified to match how the red oval shows its
 *  dots directly above the shape). Toolbar-thumbnail use only -- the on-map
 *  rendering uses real ground-vector geometry (see useUnitEntities.ts). */
export function blueAreaSymbol(dots: 2 | 3, color: string): UnitSymbol {
  const cached = blueAreaCache.get(dots)
  if (cached) return cached

  const { width, height } = AREA_SIZE[dots]
  const { canvas, ctx } = makeCanvas(width, height)

  const left = 6
  const right = width - 6
  const top = height / 2 - (height / 2 - 8)
  const bottom = height - 6

  ctx.lineWidth = 2.5
  ctx.strokeStyle = color
  ctx.strokeRect(left, top, right - left, bottom - top)

  ctx.beginPath()
  ctx.moveTo(left, top)
  ctx.lineTo(right, bottom)
  ctx.moveTo(right, top)
  ctx.lineTo(left, bottom)
  ctx.stroke()

  ctx.fillStyle = color
  const cx = width / 2
  const spacing = 10
  const startX = cx - ((dots - 1) * spacing) / 2
  for (let i = 0; i < dots; i++) {
    ctx.beginPath()
    ctx.arc(startX + i * spacing, top - 6, 3, 0, Math.PI * 2)
    ctx.fill()
  }

  const symbol = toSymbol(canvas, width, height)
  blueAreaCache.set(dots, symbol)
  return symbol
}

const trenchCache = new Map<boolean, UnitSymbol>()

/** Trench / prepared-trench fortification graphic: a flat-topped bracket with
 *  legs flaring outward and down. Prepared (occupied/dug-in) trenches are
 *  dashed; hasty trenches are a solid line. */
export function trenchSymbol(prepared: boolean): UnitSymbol {
  const cached = trenchCache.get(prepared)
  if (cached) return cached

  const width = 36
  const height = 20
  const { canvas, ctx } = makeCanvas(width, height)

  ctx.lineWidth = 2.5
  ctx.strokeStyle = HOSTILE_INK
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.setLineDash(prepared ? [4, 3] : [])
  ctx.beginPath()
  ctx.moveTo(4, 16)
  ctx.lineTo(10, 4)
  ctx.lineTo(26, 4)
  ctx.lineTo(32, 16)
  ctx.stroke()

  const symbol = toSymbol(canvas, width, height)
  trenchCache.set(prepared, symbol)
  return symbol
}
