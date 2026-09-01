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

  /** Athena simulation engine. The engine authenticates callers with a shared
   *  bearer token and has no user model, so it is never exposed to the browser:
   *  this service is its only caller and proxies results back (routes/simulations.ts). */
  engineUrl: (process.env.ENGINE_URL ?? '').replace(/\/+$/, ''),
  engineToken: process.env.ENGINE_API_TOKEN ?? '',
  /** Uploading a gzipped scenario is still a small POST; the engine validates it,
   *  queues the batch, and returns 202 without running anything. */
  engineTimeoutMs: 30_000,
  /** Only section commanders make a model call now — the rest run the engine's
   *  section policy — so a batch costs `agents × ticks × simulationCount`
   *  requests rather than one per soldier. Both are capped: agents because they
   *  are the bill, and soldiers because a run's per-tick work is quadratic in
   *  soldier count regardless of who is deciding. */
  maxAgentsPerSimulation: 40,
  maxSoldiersPerSimulation: 240,

  /** Origin of the engine's object store, e.g. `https://storage.railway.app` or
   *  `http://minio:9000`. Replays are fetched through this service rather than
   *  straight from the browser, for two reasons: the bucket then needs no CORS
   *  policy naming the frontend, and a presigned URL signs the Host header, so
   *  a URL the engine signs for an internal hostname is unusable from a browser
   *  that reaches the same bucket under a different one (exactly what happens
   *  under docker-compose). Only URLs on this origin are ever fetched — the
   *  proxy takes a URL from the caller, so the allowlist is what keeps it from
   *  being an open redirect for server-side requests. */
  engineReplayOrigin: (process.env.ENGINE_REPLAY_ORIGIN ?? '').replace(/\/+$/, ''),

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
  /** Reject selections larger than this on either axis. Matches the frontend's
   *  1 km clamp exactly: cells are one metre, so a full-size ground is
   *  1000x1000 = 1,000,000 cells. */
  maxExtentMeters: 1000,

  jobCacheSize: 24,

  /** Generating a battleground fans out to AWS Terrain Tiles, Overpass,
   *  Terrascope and Esri on someone else's quota, so it is the one endpoint
   *  worth capping per caller. This service has no user model, so the cap is
   *  the abuse control, not authentication — see the security note in the
   *  README. Other routes read from Postgres or memory and are left alone. */
  battlegroundRateLimit: Number(process.env.BATTLEGROUND_RATE_LIMIT ?? 20),
  battlegroundRateWindowMs: 60_000,

  /** LTA DataMall account key — free and instant from datamall.lta.gov.sg.
   *  Unlocks the live road picture (speed bands, incidents, VMS) and station
   *  crowd density. Server-side only; the browser never sees it. Without it
   *  those feeds report `unavailable` with the sign-up hint rather than
   *  failing, so the console still runs keyless. */
  ltaAccountKey: process.env.LTA_ACCOUNT_KEY ?? '',

  /** data.gov.sg throttles to 6 requests per 10 s without a key, 12 with a dev
   *  key and 30 with a production key — verified by hitting it, not read off a
   *  doc page. A dozen Singapore feeds whose TTLs drift into phase would burst
   *  straight through the keyless ceiling, so every upstream fetch passes a
   *  shared budget that queues rather than fails. Raise this only to a figure
   *  the deployed key actually carries; over-stating it converts a short queue
   *  into upstream 429s. */
  sgRequestLimit: Number(process.env.SG_REQUEST_LIMIT ?? 6),
  sgRequestWindowMs: Number(process.env.SG_REQUEST_WINDOW_MS ?? 10_000),

  /** Keep serving a feed's last good value this long past its TTL while refresh
   *  is failing. Beyond it the feed reports `unavailable` rather than handing an
   *  operator half-hour-old weather with a quiet age chip. */
  sgMaxStaleMs: 30 * 60_000,

  /** The traffic-image feed documents ~90 cameras and served 90 as recently as
   *  mid-June 2026; since early July it has returned 8 checkpoint cameras with
   *  `api_info.status` still reading "healthy". Upstream self-reporting is
   *  therefore not a usable health signal, and roster size against the
   *  documented count is. Below this fraction the layer is marked degraded and
   *  says so on the map. */
  sgCameraRoster: 90,
  sgCameraDegradedRatio: 0.5,
} as const
