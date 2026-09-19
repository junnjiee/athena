function svgToDataUri(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

const SIZE = 28

export function objectiveStarIcon(colorHex: string): string {
  const points = starPolygonPoints(14, 14, 5, 9, 4)
  return svgToDataUri(`<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 28 28">
    <polygon points="${points}" fill="${colorHex}" stroke="rgba(10,13,18,0.85)" stroke-width="1.5" stroke-linejoin="round"/>
  </svg>`)
}

/** Chevron pointing "up" (north, 0 rotation) -- combine with a billboard `rotation`
 *  computed from route bearing to point in the direction of travel. */
export function routeArrowIcon(colorHex: string): string {
  return svgToDataUri(`<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">
    <path d="M10 2 L16.5 16 L10 12.2 L3.5 16 Z" fill="${colorHex}" stroke="rgba(10,13,18,0.85)" stroke-width="1"/>
  </svg>`)
}

/** Red diamond with a central echelon bar: visually distinct from tactical
 *  unit footprints and legible at the operational zoom level. */
export function reserveMarkerIcon(colorHex: string): string {
  return svgToDataUri(`<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 28 28">
    <path d="M14 2.5 25.5 14 14 25.5 2.5 14Z" fill="rgba(10,13,18,.88)" stroke="${colorHex}" stroke-width="2"/>
    <path d="M8 14h12" stroke="${colorHex}" stroke-width="2.5" stroke-linecap="round"/>
  </svg>`)
}

function starPolygonPoints(cx: number, cy: number, spikes: number, outerR: number, innerR: number): string {
  const pts: string[] = []
  const step = Math.PI / spikes
  let rot = -Math.PI / 2
  for (let i = 0; i < spikes; i++) {
    pts.push(`${cx + Math.cos(rot) * outerR},${cy + Math.sin(rot) * outerR}`)
    rot += step
    pts.push(`${cx + Math.cos(rot) * innerR},${cy + Math.sin(rot) * innerR}`)
    rot += step
  }
  return pts.join(' ')
}

type Echelon = 'company' | 'platoon' | 'section' | 'group'

/** APP-6 echelon amplifier centred on `cx` at `cy`: dots for group/section/
 *  platoon, a bar for company. */
function echelonMarks(colorHex: string, echelon: Echelon, cx: number, cy: number): string {
  if (echelon === 'company') {
    return `<path d="M${cx} ${cy - 2.5}v5" stroke="${colorHex}" stroke-width="2" stroke-linecap="round"/>`
  }
  const dots = { group: 1, section: 2, platoon: 3 }[echelon]
  return Array.from({ length: dots }, (_, index) => {
    const x = cx + (index - (dots - 1) / 2) * 6
    return `<circle cx="${x}" cy="${cy}" r="1.9" fill="${colorHex}"/>`
  }).join('')
}

/** A friendly unit in the block force, drawn as the APP-6 frame with its
 *  echelon marked above it: dots for group/section/platoon, a bar for company.
 *  Greyed when the unit is not free to be given a blocking task. */
export function orbatUnitIcon(
  colorHex: string,
  echelon: Echelon,
  dimmed = false,
): string {
  return svgToDataUri(`<svg xmlns="http://www.w3.org/2000/svg" width="34" height="26" viewBox="0 0 34 26">
    ${echelonMarks(colorHex, echelon, 17, 7)}
    <rect x="4.5" y="12" width="25" height="11" rx="1"
      fill="rgba(10,13,18,${dimmed ? '.55' : '.88'})" stroke="${colorHex}" stroke-width="2"/>
  </svg>`)
}

function escapeXml(text: string): string {
  return text.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!)
}

/** Image size, and where inside it the staff foot sits: a billboard anchored
 *  bottom-left needs `pixelOffset(-foot, foot)` to put the foot on the ground point. */
export const BLOCK_FORCE_SYMBOL = { width: 236, height: 84, foot: 6 } as const

/** The block-force staff aid: an APP-6 unit frame with its echelon on top,
 *  the designation to its right and the higher formation below that, on a
 *  staff line whose foot is the block point. The foot dot is part of the
 *  image — filled when the operator has fixed the point, hollow while it is
 *  the engine's provisional inlet point.
 *
 *  Drawn as one image rather than several entities so the pieces never drift
 *  apart as the camera moves; it is a fixed-size annotation, not geometry.
 *  It is also why the dot is not a separate `point` graphic: a clamped point
 *  is rendered by Cesium as a billboard and shares the entity's one billboard
 *  slot, so the two would overwrite each other frame by frame. */
export function blockForceSymbol({
  colorHex,
  echelon,
  designation,
  higherFormation,
  provisional = false,
}: {
  colorHex: string
  echelon: Echelon
  designation: string
  /** Parent unit in the ORBAT; omitted for a root unit. */
  higherFormation?: string | null
  /** No exact block point yet — the staff foot is the engine's nearest inlet point. */
  provisional?: boolean
}): string {
  const { width, height, foot } = BLOCK_FORCE_SYMBOL
  const frame = { x: 44, y: 30, w: 44, h: 20 }
  const textX = frame.x + frame.w + 7
  const staff = provisional ? 'stroke-dasharray="4 3"' : ''
  const dot = provisional
    ? `<circle cx="${foot}" cy="${height - foot}" r="3.5" fill="rgba(10,13,18,.9)" stroke="${colorHex}" stroke-width="2"/>`
    : `<circle cx="${foot}" cy="${height - foot}" r="4.5" fill="${colorHex}" stroke="rgba(10,13,18,.9)" stroke-width="2"/>`
  return svgToDataUri(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <line x1="${foot}" y1="${height - foot}" x2="${frame.x}" y2="${frame.y + frame.h}" stroke="${colorHex}" stroke-width="2" ${staff}/>
    ${dot}
    ${echelonMarks(colorHex, echelon, frame.x + frame.w / 2, frame.y - 8)}
    <rect x="${frame.x}" y="${frame.y}" width="${frame.w}" height="${frame.h}" rx="1"
      fill="rgba(10,13,18,.88)" stroke="${colorHex}" stroke-width="2"/>
    <g font-family="system-ui, sans-serif" fill="${colorHex}" stroke="rgba(10,13,18,.9)" stroke-width="3" paint-order="stroke" stroke-linejoin="round">
      <text x="${textX}" y="${frame.y + 1}" font-size="9" font-weight="600" letter-spacing="1.2">BLOCK FORCE</text>
      <text x="${textX}" y="${frame.y + 15}" font-size="11" font-weight="600">${escapeXml(designation)}</text>
      ${higherFormation ? `<text x="${textX}" y="${frame.y + 28}" font-size="10" fill="${colorHex}" fill-opacity=".8">from ${escapeXml(higherFormation)}</text>` : ''}
    </g>
  </svg>`)
}
