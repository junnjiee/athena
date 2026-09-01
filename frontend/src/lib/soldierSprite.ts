import { FRIENDLY_HEX, HOSTILE_HEX } from './colors'

/**
 * A soldier as a small figure on the ground.
 *
 * Drawn rather than modelled: a glTF asset would be a download, a licence and a
 * build step, and at the height a commander actually looks at a battleground a
 * clean silhouette reads better than a low-poly model anyway.
 *
 * What it has to communicate, in about thirty pixels: which side, whether it is
 * still standing, and which way it is facing. Everything here serves one of
 * those three. A helmeted head, a weapon held across the body and a slight
 * forward lean read as a soldier; a circle on a stick reads as a diagram.
 *
 * Sprites are generated once and cached per side, state and facing, because a
 * BillboardCollection wants a stable image reference — handing it a fresh data
 * URL per soldier per tick would re-upload a texture every frame of playback.
 */

type Side = 'blue' | 'red'

const cache = new Map<string, string>()

const W = 40
const H = 64

/** Darken a hex colour toward black by `amount` (0–1). */
function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16)
  const r = Math.round(((n >> 16) & 255) * (1 - amount))
  const g = Math.round(((n >> 8) & 255) * (1 - amount))
  const b = Math.round((n & 255) * (1 - amount))
  return `rgb(${r},${g},${b})`
}

function standing(side: Side, facingLeft: boolean): string {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  const base = side === 'blue' ? FRIENDLY_HEX : HOSTILE_HEX
  const dark = shade(base, 0.45)
  const darker = shade(base, 0.68)
  const outline = 'rgba(8,10,14,0.9)'

  if (facingLeft) {
    ctx.translate(W, 0)
    ctx.scale(-1, 1)
  }

  // Ground shadow, so the figure sits on the terrain instead of hovering.
  ctx.fillStyle = 'rgba(0,0,0,0.35)'
  ctx.beginPath()
  ctx.ellipse(20, 60, 9, 3, 0, 0, Math.PI * 2)
  ctx.fill()

  ctx.lineJoin = 'round'
  ctx.lineWidth = 1.5
  ctx.strokeStyle = outline

  // Rear leg, then front leg — a walking stance rather than standing to
  // attention, so a column of them reads as moving.
  ctx.fillStyle = darker
  ctx.beginPath()
  ctx.moveTo(17, 40)
  ctx.lineTo(13, 52)
  ctx.lineTo(11, 59)
  ctx.lineTo(16, 59)
  ctx.lineTo(19, 51)
  ctx.lineTo(21, 40)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()

  ctx.fillStyle = dark
  ctx.beginPath()
  ctx.moveTo(21, 40)
  ctx.lineTo(25, 51)
  ctx.lineTo(28, 59)
  ctx.lineTo(23, 59)
  ctx.lineTo(20, 51)
  ctx.lineTo(18, 40)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()

  // Torso: webbing-heavy, slightly leaning forward.
  ctx.fillStyle = base
  ctx.beginPath()
  ctx.moveTo(14, 20)
  ctx.lineTo(27, 19)
  ctx.lineTo(28, 33)
  ctx.lineTo(25, 42)
  ctx.lineTo(16, 42)
  ctx.lineTo(13, 32)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()

  // Chest rig.
  ctx.fillStyle = darker
  ctx.fillRect(16, 26, 10, 7)
  ctx.strokeRect(16, 26, 10, 7)

  // Weapon held across the body, muzzle forward. The single most readable cue
  // that this is a soldier and which way it is looking.
  ctx.strokeStyle = 'rgba(20,22,26,0.95)'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(14, 32)
  ctx.lineTo(36, 26)
  ctx.stroke()
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(22, 30)
  ctx.lineTo(24, 36)
  ctx.stroke()

  // Arms over the weapon.
  ctx.strokeStyle = outline
  ctx.lineWidth = 1.5
  ctx.fillStyle = dark
  ctx.beginPath()
  ctx.moveTo(25, 22)
  ctx.lineTo(33, 27)
  ctx.lineTo(31, 30)
  ctx.lineTo(23, 26)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()

  // Head and helmet.
  ctx.fillStyle = shade(base, 0.2)
  ctx.beginPath()
  ctx.arc(21, 13, 5.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()

  ctx.fillStyle = darker
  ctx.beginPath()
  ctx.ellipse(21, 11, 7.5, 5.5, 0, Math.PI, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
  // Brim, forward.
  ctx.beginPath()
  ctx.moveTo(21, 11)
  ctx.lineTo(30, 12)
  ctx.lineTo(29, 14.5)
  ctx.lineTo(21, 14)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()

  return canvas.toDataURL('image/png')
}

function fallen(side: Side): string {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  // Prone and desaturated: a casualty has to read as one at a glance, without
  // a legend and without being mistaken for a soldier lying in cover.
  const grey = 'rgba(122,126,132,0.95)'
  const greyDark = 'rgba(78,82,88,0.95)'
  const tint = side === 'blue' ? FRIENDLY_HEX : HOSTILE_HEX

  ctx.fillStyle = 'rgba(0,0,0,0.3)'
  ctx.beginPath()
  ctx.ellipse(20, 58, 14, 4, 0, 0, Math.PI * 2)
  ctx.fill()

  ctx.strokeStyle = 'rgba(8,10,14,0.85)'
  ctx.lineWidth = 1.5
  ctx.lineJoin = 'round'

  // Body lying across the cell.
  ctx.fillStyle = grey
  ctx.beginPath()
  ctx.ellipse(21, 53, 13, 5, -0.08, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()

  // Legs trailing.
  ctx.fillStyle = greyDark
  ctx.beginPath()
  ctx.moveTo(30, 51)
  ctx.lineTo(37, 55)
  ctx.lineTo(36, 58)
  ctx.lineTo(29, 56)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()

  // Helmet, come to rest.
  ctx.fillStyle = greyDark
  ctx.beginPath()
  ctx.arc(8, 52, 4.5, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()

  // A thread of side colour so you can still tell whose casualty it is.
  ctx.strokeStyle = tint
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(14, 51)
  ctx.lineTo(26, 53)
  ctx.stroke()

  return canvas.toDataURL('image/png')
}

/** Cached sprite for a soldier's side, state and facing. */
export function soldierSprite(
  side: Side,
  alive: boolean,
  facingLeft = false,
): string {
  const key = `${side}-${alive}-${alive && facingLeft}`
  const hit = cache.get(key)
  if (hit) return hit

  const made = alive ? standing(side, facingLeft) : fallen(side)
  cache.set(key, made)
  return made
}

/** Commanders get a ring so the soldier whose reasoning is on screen is
 *  findable among its section. */
export function commanderRing(side: Side): string {
  const key = `ring-${side}`
  const hit = cache.get(key)
  if (hit) return hit

  const canvas = document.createElement('canvas')
  canvas.width = 40
  canvas.height = 40
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  const base = side === 'blue' ? FRIENDLY_HEX : HOSTILE_HEX
  ctx.strokeStyle = base
  ctx.lineWidth = 2.5
  ctx.beginPath()
  ctx.arc(20, 20, 15, 0, Math.PI * 2)
  ctx.stroke()

  // Chevron above, so a commander is identifiable even where rings overlap.
  ctx.lineWidth = 2.5
  ctx.beginPath()
  ctx.moveTo(15, 8)
  ctx.lineTo(20, 3)
  ctx.lineTo(25, 8)
  ctx.stroke()

  const made = canvas.toDataURL('image/png')
  cache.set(key, made)
  return made
}
