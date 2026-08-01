/** WGS84 geodetic → ECEF and local east-north-up frames, dependency-free.
 *  Used by the splat tooling to write 3D Tiles root transforms (column-major
 *  4x4 ENU→ECEF), matching what CesiumJS computes with
 *  Transforms.eastNorthUpToFixedFrame. */

const WGS84_A = 6378137
const WGS84_E2 = 6.69437999014e-3

export function geodeticToEcef(lonDeg: number, latDeg: number, heightM: number): [number, number, number] {
  const lon = (lonDeg * Math.PI) / 180
  const lat = (latDeg * Math.PI) / 180
  const sinLat = Math.sin(lat)
  const cosLat = Math.cos(lat)
  const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat)
  return [
    (n + heightM) * cosLat * Math.cos(lon),
    (n + heightM) * cosLat * Math.sin(lon),
    (n * (1 - WGS84_E2) + heightM) * sinLat,
  ]
}

/** Column-major 4x4 transform placing a local ENU frame (x=east, y=north, z=up,
 *  origin at the geodetic point) into ECEF — the `root.transform` a 3D Tiles
 *  tileset expects for a locally-modeled asset. */
export function enuToEcefMatrix(lonDeg: number, latDeg: number, heightM: number): number[] {
  const lon = (lonDeg * Math.PI) / 180
  const lat = (latDeg * Math.PI) / 180
  const sinLon = Math.sin(lon)
  const cosLon = Math.cos(lon)
  const sinLat = Math.sin(lat)
  const cosLat = Math.cos(lat)
  const origin = geodeticToEcef(lonDeg, latDeg, heightM)
  return [
    // east
    -sinLon, cosLon, 0, 0,
    // north
    -sinLat * cosLon, -sinLat * sinLon, cosLat, 0,
    // up
    cosLat * cosLon, cosLat * sinLon, sinLat, 0,
    // origin
    origin[0], origin[1], origin[2], 1,
  ]
}
