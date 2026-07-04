/** All tunables and external endpoints in one place — nothing hardcoded in services. */
export const config = {
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST ?? '127.0.0.1',
  corsOrigin: /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,

  /** AWS Terrain Tiles (Mapzen terrarium encoding) — public S3 bucket, no key needed. */
  demTileUrl: (z: number, x: number, y: number) =>
    `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`,
  demMaxZoom: 15,
  demMinZoom: 10,
  demFetchConcurrency: 8,
  demTileCacheSize: 256,

  overpassEndpoints: [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.private.coffee/api/interpreter',
    'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ],
  overpassTimeoutMs: 25_000,
  /** Public Overpass instances throttle/block requests without an identifying UA. */
  userAgent: 'athena-terrain-service/0.1 (dev)',

  openMeteoUrl: 'https://api.open-meteo.com/v1/forecast',
  weatherTimeoutMs: 8_000,

  /** ESA WorldCover v200 map layer (Terrascope titiler) — public, no key needed.
   *  Fallback vegetation/land-cover signal for cells OSM has no polygon for. */
  worldCoverWmsUrl: 'https://titiler.terrascope.be/wms',
  worldCoverLayer: 'esa-worldcover-map-10m-2021-v2_map',
  worldCoverTimeoutMs: 15_000,
  /** Supersample the single GetMap fetch before majority-voting down to grid
   *  resolution -- cheap since it's one small image, not a tile pyramid. */
  worldCoverSupersample: 2,

  /** Grid sizing: cells are square; the longest bbox edge maps to at most maxCellsPerAxis. */
  maxCellsPerAxis: 288,
  minCellMeters: 5,
  /** Reject selections larger than this on either axis (matches frontend's 3 km clamp, with margin). */
  maxExtentMeters: 6_000,

  jobCacheSize: 24,
} as const
