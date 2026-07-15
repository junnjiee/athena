import * as mgrs from 'mgrs'

/** digits per axis: 5 = 1 m, 4 = 10 m, 3 = 100 m */
type MgrsPrecision = 3 | 4 | 5

const MGRS_PATTERN = /^(\d{1,2}[A-Z])([A-Z]{2})(\d+)$/

function parts(lon: number, lat: number, digits: MgrsPrecision): { gzd: string; square: string; easting: string; northing: string } | null {
  const raw = mgrs.forward([lon, lat], digits)
  const match = MGRS_PATTERN.exec(raw)
  if (!match) return null
  const [, gzd, square, numerals] = match
  return { gzd, square, easting: numerals.slice(0, digits), northing: numerals.slice(digits) }
}

/** Full MGRS reference with NATO spacing, e.g. "48N UC 8734 2156" (10 m at the
 *  default 4 digits). Used for AO-level readouts where the grid zone matters. */
export function toMGRS(lon: number, lat: number, digits: MgrsPrecision = 4): string {
  const p = parts(lon, lat, digits)
  if (!p) return `${lat.toFixed(4)}°, ${lon.toFixed(4)}°`
  return `${p.gzd} ${p.square} ${p.easting} ${p.northing}`
}

/** Six-figure grid reference (100 m precision) as spoken over the net --
 *  "GR 873 215". The grid zone and 100 km square are implied by the AO, which is
 *  always well under 100 km across. */
export function toGridRef(lon: number, lat: number): string {
  const p = parts(lon, lat, 3)
  if (!p) return `${lat.toFixed(4)}°, ${lon.toFixed(4)}°`
  return `GR ${p.easting} ${p.northing}`
}
