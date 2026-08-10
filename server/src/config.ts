import 'dotenv/config'

/** All tunables and external endpoints in one place — nothing hardcoded in services. */
export const config = {
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST ?? '127.0.0.1',
  corsOrigin: /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,

  /** Neon Postgres connection string (server/.env, see server/.env.example) — used by db/client.ts. */
  databaseUrl: process.env.DATABASE_URL ?? '',

  /** Athena simulation engine. The engine authenticates callers with a shared
   *  bearer token and has no user model, so it is never exposed to the browser:
   *  this service is its only caller and proxies results back (routes/simulations.ts). */
  engineUrl: (process.env.ENGINE_URL ?? '').replace(/\/+$/, ''),
  engineToken: process.env.ENGINE_API_TOKEN ?? '',
  /** Submitting a batch is a small POST; the engine queues and returns 202. */
  engineTimeoutMs: 15_000,

  /** ElevenLabs Agents — powers the voice assistant. The key never leaves the
   *  server: the browser gets a short-lived conversation token instead
   *  (routes/assistant.ts). Run `bun run agent:sync` to create/update the agent
   *  from services/assistantAgent.ts and obtain the agent id. */
  elevenLabsApiKey: process.env.ELEVENLABS_API_KEY ?? '',
  elevenLabsAgentId: process.env.ELEVENLABS_AGENT_ID ?? '',
  elevenLabsApiUrl: 'https://api.elevenlabs.io/v1',
  elevenLabsTimeoutMs: 10_000,

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

  /** Esri World Imagery RGB tiles — the raster the segmentation stage runs on.
   *  Same endpoint the frontend already drapes as its base layer. */
  satelliteTileUrl: (z: number, x: number, y: number) =>
    `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`,
  satelliteMinZoom: 12,
  satelliteMaxZoom: 16,
  satelliteFetchConcurrency: 8,
  satelliteTileCacheSize: 256,
  /** Aim for at least this many imagery pixels per grid-cell edge so per-cell
   *  texture (local variance) is meaningful, not noise. */
  satellitePixelsPerCell: 3,

  /** Segmentation classes below this confidence (0-100) are ignored and the
   *  classifier falls through to the WorldCover prior. */
  segConfidenceMin: 55,
  /** Optional ONNX model path (ATHENA_SEG_MODEL). When unset, the deterministic
   *  spectral backend runs — see services/segment.ts for the model contract. */
  segModelPath: process.env.ATHENA_SEG_MODEL ?? null,
  segModelResolution: Number(process.env.ATHENA_SEG_RES ?? 512),
  /** JSON array mapping model output channel -> TERRAIN_CLASS id (255 = ignore). */
  segModelClassMap: process.env.ATHENA_SEG_CLASSMAP ?? null,
  segWorkerThreads: 2,

  /** Grid sizing: cells are square, fixed at this size regardless of selection extent
   *  (the simulation team needs a constant, predictable resolution to build against). */
  cellMeters: 1,
  /** Reject selections larger than this on either axis (matches frontend's 400 m clamp, with margin). */
  maxExtentMeters: 800,

  jobCacheSize: 24,
} as const
