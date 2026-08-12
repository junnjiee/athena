# ATHENA — Terrain Intelligence & Battle Planning

A commander sketches a plan on real ground and instantly sees whether it works.
Globe → area selection → live terrain ingestion → military classification → 3D
battlefield with tactical heatmaps → plan drawing → AI plan validation → Monte
Carlo simulation of LLM-driven soldiers over that ground.

Three processes:

| | Stack | Port | Role |
|---|---|---|---|
| `frontend/` | Vite 8 + React 19 + resium/Cesium + Tailwind v4 + zustand | 5173 | Globe, battlefield render, plan drawing, voice assistant |
| `server/` | Fastify 5 + Socket.IO + Drizzle/Neon Postgres | 8787 | Terrain pipeline, plan persistence, engine broker |
| `engine/` | Python 3.11 + FastAPI + arq/Redis + Postgres + S3 | 8000 | Tick-based combat sim, agents via OpenRouter |

The frontend talks only to the server; the server is the engine's only caller and
holds its bearer token. See [`engine/ENGINE.md`](engine/ENGINE.md) for the
simulation's behaviour and modelling assumptions, and
[`ENGINE_CHANGES.md`](ENGINE_CHANGES.md) for what the engine still needs before
a drawn plan is simulated in full.

## Quick start

### Everything at once, with Docker

Brings up the web app, the terrain service, the simulation engine, and the
Postgres/Redis/S3 the engine needs. Nothing but the soldier-agents' OpenRouter
calls leaves the machine.

```bash
cp .env.docker.example .env   # optional keys; the stack runs without them
docker compose up --build
```

| | |
|---|---|
| Web app | http://localhost:5173 |
| Terrain API | http://localhost:8787 |
| Engine API | http://localhost:8000 |
| MinIO console | http://localhost:9001 (`athena` / `athena-secret`) |

`frontend/src` and `server/src` are bind-mounted, so edits on the host are
picked up live — Vite keeps HMR and the terrain service runs under `tsx watch`.
Rebuild only when dependencies change.

Set `OPENROUTER_API_KEY` in `.env` to actually run simulations; without it a
batch is accepted and every run fails at its first agent call, reported in the
UI as failed runs.

### On the host

```bash
# 1. API + terrain pipeline (port 8787)
cd server && bun install && bun run dev

# 2. Web app (port 5173, proxies /api and /socket.io to 8787)
cd frontend && bun install && bun run dev
```

`DATABASE_URL` may be a Neon connection string or any ordinary Postgres URL —
`server/src/db/client.ts` picks the driver from the host, because Neon's
serverless driver speaks its own HTTP protocol rather than the Postgres wire
protocol and cannot reach a local server.

The terrain pipeline and plan drawing work with no further configuration.
Running simulations additionally needs `ENGINE_URL` and `ENGINE_API_TOKEN` in
`server/.env` (see `server/.env.example`) and a deployed engine — the Run
Simulation dialog says so plainly when they are unset.

Optional: set `VITE_CESIUM_ION_TOKEN` in `frontend/.env.local` (free account at
cesium.com) — without it the app falls back to Cesium's rate-limited demo token,
which loads world imagery/terrain noticeably slower.

## How it works

```
Cesium globe (world terrain + satellite)
  └─ drag-select ground (≤800 m)  →  Generate Battlefield
       └─ POST /api/battleground             Fastify (Node/tsx)
            ├─ DEM: AWS Terrain Tiles (terrarium PNG), mosaic + bilinear sample
            ├─ Features: Overpass API (roads/buildings/landcover/water), 4 mirrors
            ├─ Weather: Open-Meteo (current conditions)
            ├─ Classifier: RBush + point-in-polygon + slope → 10 terrain classes
            ├─ Military grid: cover, concealment, move cost, exposure,
            │                 vehicle mobility, ambush potential (≤800×800 cells)
            └─ progress streamed over Socket.IO ("Athena is reasoning…" panel)
       └─ GET meta (JSON) + grid (binary Float32/Uint8, ~800 KB)
  └─ battlefield reveal: roads draw → water fills → buildings extrude
       → procedural trees populate (staged 5 s animation)
  └─ heatmap drape (single-tile imagery layer from a colormapped canvas)
  └─ hover = live cell sample (TERRAIN INFO panel)
  └─ routes validated against the grid: water crossings, steep slopes,
       exposed stretches, slow going + ETA / exposure / confidence in bottom bar
```

Selections are capped at 800 m a side (`config.maxExtentMeters`) and cells are
fixed at 1 m regardless of extent, so a full-size battleground is 800×800 cells.

### Plan → simulation

```
Run Simulation (bottom bar, needs a saved plan)
  └─ POST /api/plans/:id/simulate      { simulationCount, ticks, model? }
       ├─ reads the plan + its stored grid from Postgres
       ├─ expands establishment: one platoon marker (strength 21) → 21 soldiers
       ├─ projects the packed grid into the engine's payload, gzips it
       └─ POST {ENGINE_URL}/v1/simulation-batches   (bearer token, never the browser's)
  └─ GET /api/simulations/:batchId/events
       └─ relays the engine's SSE stream, Last-Event-ID and all, scoring
          each run on the way past
            ├─ simulation.completed → { summary, replayPath }
            ├─ simulation.failed
            └─ batch.completed
  └─ summaries aggregated live into a win rate, converging as runs land
```

Runs are scored server-side. A replay repeats the whole battlefield surface as
one JSON object per cell — about 17 MB on an 800×800 ground — so letting the
browser fetch all of them moved well over a gigabyte to produce a single win
rate. The service fetches and reduces each replay instead, one at a time, which
also bounds its own memory to a single decoded replay. `replayPath` is kept for
a replay viewer to fetch on demand. See `server/src/services/replaySummary.ts`.

The scenario is **uploaded** rather than named by plan id. The engine accepts
both, but the pull path can only carry what `GET /api/plans/:id` returns — one
entry per drawn marker — and a marker is an establishment, not a soldier. Terrain
inside the payload is decoded from the stored `gridBuffer`, so the battleground
still has one source of bytes; only the laydown is derived. See
`server/src/services/simulationPayload.ts`.

Replays are presigned URLs on the engine's own bucket, fetched back through
`GET /api/simulations/replay` rather than straight from the browser. A presigned
URL signs the `Host` header, so one signed for the bucket's internal hostname is
unusable from a browser that reaches the same bucket under a different name —
which is exactly what happens under docker-compose. Going through the service
also spares the bucket a CORS policy naming the frontend. Only URLs on
`ENGINE_REPLAY_ORIGIN` are ever fetched.

Every soldier is one model call per tick, so a batch costs
`soldiers × ticks × simulationCount` requests. The server refuses a plan over
`config.maxSoldiersPerSimulation` (80), and the run dialog prices a batch before
you commit to it.

### Plan → engine bridge

A saved plan stores drawings as bare lon/lat, which tells the simulation engine
nothing about *what ground* each drawing sits on. `GET /api/plans/:id/brief`
answers both halves of that question:

```
GET /api/plans/:id/brief
  └─ drawings[]  — every unit / objective / route, each carrying
       ├─ kind + label   "deployment" / "fortification" / "objective" / "movement"
       │                 → "red platoon deployment", "blue movement arrow (prowl)"
       ├─ cell           { x, y, index } in simulation-grid space, plus that
       │                 cell's military properties (cover, concealment,
       │                 moveCostFactor, visibility, ambush, slope, elevation)
       ├─ path           routes: the ordered cells the arrow crosses, start → end
       ├─ footprint      objectives: every cell inside radiusMeters
       └─ corridor       aggregate of the ground covered (class counts,
                         dominant class, crossesWater, elevation range)
```

Cell space is stated in the payload itself (`cellSpace`): `x` = column west→east,
`y` = row north→south, `index = y * width + x`, cells `cellMeters` square — the
same row-major layout as the binary grid, so the engine never does lon/lat math.
Nothing is persisted; the brief is derived from the stored grid on each request.
See `server/src/services/planBrief.ts` and `server/src/lib/cells.ts`.

### Performance notes

- The grid crosses the wire as one binary buffer (16-byte header + typed-array
  channels) — no JSON for the 69k-cell payloads; decode is zero-copy views.
- Heatmaps are rendered once to a canvas and draped as a single GPU texture;
  switching metrics never touches entity geometry.
- Repeat selections of the same ground are served from an in-memory LRU
  (instant), and DEM tiles are cached across jobs.
- Trees are one GPU-instanced `BillboardCollection`; building extrusion
  animations are frozen to constants after the reveal so nothing evaluates
  per-frame afterwards.

### Stack decisions (vs. the original wishlist)

- **Fastify + Socket.IO on Node (via tsx)** — answers the "Backend > ?" slot.
  Bun stays the package manager/test runner; the server process runs on Node
  because Socket.IO's websocket upgrade is flaky on Bun 1.1.x.
- **No deck.gl / tldraw yet** — the battlefield renders inside the existing
  Cesium scene (one WebGL context, one camera; unit/route drawing already
  worked there). Revisit deck.gl when the sim replay needs mass agent
  rendering.
- **No queue in the terrain service** — Redis and a job queue live in `engine/`,
  where a batch really is N independent long jobs. The terrain pipeline is
  I/O-bound and completes in seconds with in-process caching, so a queue there
  would add hops rather than remove them.
- **Heuristic classifier, honestly labeled** — deterministic OSM + slope rules
  produce the military properties today; the segmentation-model upgrade path
  is isolated behind `server/src/services/classify.ts`.

## Tests

```bash
cd server && bun test        # tile math, wire format, classifier, plan brief, engine bridge
cd frontend && bun test && bun run lint && bunx tsc -b
cd engine && uv run pytest
```

## Layout

```
athena/
├── frontend/   Vite 8 + React 19 + resium/Cesium + Tailwind v4 + zustand + framer-motion
│   └── src/{components,state,lib,hooks,pages,types}
├── server/     Fastify 5 + Socket.IO + zod + Drizzle (bun-managed, runs on tsx)
│   └── src/{routes/,services/{dem,osm,weather,classify,grid,pipeline,
│            planBrief,simulationPayload},db/,lib/}
└── engine/     Python 3.11 + FastAPI + arq/Redis + asyncpg + boto3 (uv-managed)
    └── athena/{loop,agent,params,context_view,resolvers/,world_state/,
                 models/,loaders/,hosted/}
```

## Security notes

This service has **no user model**. Anyone who can reach it can read any plan by
id and generate battlegrounds. Deploy it behind whatever authenticates your
users; the controls here are damage limitation, not authentication:

- `CORS_ORIGINS` restricts which browser origins may call it.
- `BATTLEGROUND_RATE_LIMIT` caps the one endpoint that spends third-party API
  quota. Everything else reads from Postgres or memory.
- The engine's bearer token never leaves this process, and replay URLs are
  fetched through it rather than by the browser.

Real per-user authorisation needs accounts, which is a product decision rather
than a missing guard.

## Known gaps

The plan a commander draws is richer than what the engine currently simulates:
routes, per-unit vision range, objectives, fortification works and H-hour are all
drawn, stored and served, but dropped on the engine side. Unit **strength** is
plumbed through as of the payload bridge. See
[`ENGINE_CHANGES.md`](ENGINE_CHANGES.md) for the full list and what each would
cost.
