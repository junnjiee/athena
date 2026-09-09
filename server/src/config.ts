import 'dotenv/config'

/** Any localhost port — the dev server and docker-compose both land here. */
const LOCALHOST_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/

export function parseCorsOrigins(raw: string | undefined): RegExp | string[] {
  const origins = (raw ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter((origin) => origin !== '')
  return origins.length > 0 ? origins : LOCALHOST_ORIGIN
}

/** All tunables and external endpoints in one place — nothing hardcoded in services. */
export const config = {
  port: Number(process.env.PORT ?? 8787),
  host: process.env.HOST ?? '127.0.0.1',
  /** Browser origins allowed to call this service. `CORS_ORIGINS` is a
   *  comma-separated list of exact origins for a deployed frontend; with it
   *  unset any localhost port is allowed, which is the dev and docker-compose
   *  case. A hardcoded localhost regex would block every deployment. */
  corsOrigin: parseCorsOrigins(process.env.CORS_ORIGINS),

  /** Neon Postgres connection string (server/.env, see server/.env.example) — used by db/client.ts. */
  databaseUrl: process.env.DATABASE_URL ?? '',

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
  /** The operational road fetch covers a box up to two orders of magnitude
   *  larger than a battleground, so it needs longer than the tactical query.
   *  Filtering to drivable classes is what keeps even this achievable. */
  overpassOperationalTimeoutMs: 90_000,
  /** Small place=* lookup used for AO titles, IVO fields, and document
   *  locations. It shares the mirror pool but must never hold up typing. */
  placeLookupTimeoutMs: 8_000,
  /** Largest operational area, metres a side. Reinforcement comes from depth,
   *  so this is far beyond `maxExtentMeters`; the ceiling exists because a
   *  public Overpass mirror will not serve an unbounded road network. */
  operationalMaxExtentMeters: 50_000,
  /** DEM ground resolution for operational node elevations. Gradient over a
   *  road segment does not need metre accuracy, and a finer tile would
   *  multiply fetches across a 50 km box for no routing benefit. */
  operationalDemResolutionMeters: 30,

  /** Athena planning engine. It is stateless and holds no user data, so it is
   *  never exposed to the browser: this service is its only caller. Without
   *  this, areas still ingest and the study endpoints report it is unset. */
  engineUrl: (process.env.ENGINE_URL ?? '').replace(/\/+$/, ''),
  /** A study is a graph search over tens of thousands of edges, not a model
   *  call, so this bounds a slow network rather than slow thinking. */
  engineTimeoutMs: 60_000,
  /** The courses-of-action pass is a model reasoning about how a force would
   *  fight, not a graph search, so it runs to minutes rather than seconds. */
  engineReasoningTimeoutMs: 300_000,
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

  /** Generating a battleground fans out to AWS Terrain Tiles, Overpass,
   *  Terrascope and Esri on someone else's quota, so it is the one endpoint
   *  worth capping per caller. This service has no user model, so the cap is
   *  the abuse control, not authentication — see the security note in the
   *  README. Other routes read from Postgres or memory and are left alone. */
  battlegroundRateLimit: Number(process.env.BATTLEGROUND_RATE_LIMIT ?? 20),
  battlegroundRateWindowMs: 60_000,
} as const
