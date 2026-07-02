import { Ion, Terrain } from 'cesium'

const token = import.meta.env.VITE_CESIUM_ION_TOKEN as string | undefined

if (token) {
  Ion.defaultAccessToken = token
} else {
  console.warn(
    "[Athena] VITE_CESIUM_ION_TOKEN is not set. Falling back to Cesium's built-in demo ion access " +
      'token (imagery/terrain/geocoding work for evaluation, but it is rate-limited and unsuitable for ' +
      'production). Set VITE_CESIUM_ION_TOKEN in .env.local to use your own free ion account.',
  )
}

// Module-level singleton: constructed once, after the token above is set, so World
// Terrain resolves against the right ion account. resium's `terrain` prop is
// constructor-only ("readonly") -- never construct this inline in JSX.
export const worldTerrain = Terrain.fromWorldTerrain({ requestVertexNormals: true })
