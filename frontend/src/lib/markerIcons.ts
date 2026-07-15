function svgToDataUri(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}

const SIZE = 28

// Unit/threat markers moved to MIL-STD-2525 symbols -- see lib/milsymbols.ts.

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
