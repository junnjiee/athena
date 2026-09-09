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

/** A friendly unit in the block force, drawn as the APP-6 frame with its
 *  echelon marked above it: dots for group/section/platoon, a bar for company.
 *  Greyed when the unit is not free to be given a blocking task. */
export function orbatUnitIcon(
  colorHex: string,
  echelon: 'company' | 'platoon' | 'section' | 'group',
  dimmed = false,
): string {
  const dots = { group: 1, section: 2, platoon: 3, company: 0 }[echelon]
  const marks =
    echelon === 'company'
      ? `<path d="M17 4.5v5" stroke="${colorHex}" stroke-width="2" stroke-linecap="round"/>`
      : Array.from({ length: dots }, (_, index) => {
          const cx = 17 + (index - (dots - 1) / 2) * 6
          return `<circle cx="${cx}" cy="7" r="1.9" fill="${colorHex}"/>`
        }).join('')
  return svgToDataUri(`<svg xmlns="http://www.w3.org/2000/svg" width="34" height="26" viewBox="0 0 34 26">
    ${marks}
    <rect x="4.5" y="12" width="25" height="11" rx="1"
      fill="rgba(10,13,18,${dimmed ? '.55' : '.88'})" stroke="${colorHex}" stroke-width="2"/>
  </svg>`)
}
