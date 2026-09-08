# ATHENA — Terrain Intelligence & Battle Planning

A commander sketches a plan on real ground and instantly sees whether it works.
Globe → area selection → live terrain ingestion → military classification → 3D
battlefield with tactical heatmaps → plan drawing → AI plan validation.

Two processes:

| | Stack | Port | Role |
|---|---|---|---|
| `frontend/` | Vite 8 + React 19 + resium/Cesium + Tailwind v4 + zustand | 5173 | Globe, battlefield render, plan drawing, voice assistant |
| `server/` | Fastify 5 + Socket.IO + Drizzle/Neon Postgres | 8787 | Terrain pipeline, plan persistence |

The frontend talks only to the server.

> **Where the engine went.** Athena previously carried a third process: a
> force-on-force simulation that ran LLM-driven soldiers over this terrain and
> scored a plan by Monte Carlo. It has been removed. The engine is being rebuilt
> as a planning aid that complements battle procedure rather than fighting the
> battle — finding enemy reinforcement routes for the S2 and deployable block
> forces for the S3. See
> [`docs/superpowers/specs/2026-09-08-route-substrate-design.md`](docs/superpowers/specs/2026-09-08-route-substrate-design.md).

## Quick start

### Everything at once, with Docker

```bash
cp .env.docker.example .env   # optional keys; the stack runs without them
docker compose up --build
```

| | |
|---|---|
| Web app | http://localhost:5173 |
| Terrain API | http://localhost:8787 |

`frontend/src` and `server/src` are bind-mounted, so edits on the host are
picked up live — Vite keeps HMR and the terrain service runs under `tsx watch`.
Rebuild only when dependencies change.

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
       └─ GET meta (JSON) + grid (binary Float32/Uint8)
  └─ battlefield reveal: roads draw → water fills → buildings extrude
       → procedural trees populate (staged 5 s animation)
  └─ heatmap drape (single-tile imagery layer from a colormapped canvas)
  └─ hover = live cell sample (TERRAIN INFO panel)
  └─ routes validated against the grid: water crossings, steep slopes,
       exposed stretches, slow going + ETA / exposure / confidence in bottom bar
```

Selections are capped at 800 m a side (`config.maxExtentMeters`) and cells are
fixed at 1 m regardless of extent, so a full-size battleground is 800×800 cells.

### Plan brief

A saved plan stores drawings as bare lon/lat, which says nothing about *what
ground* each drawing sits on. `GET /api/plans/:id/brief` answers both halves:

```
GET /api/plans/:id/brief
  └─ drawings[]  — every unit / objective / route, each carrying
       ├─ kind + label   "deployment" / "fortification" / "objective" / "movement"
       │                 → "red platoon deployment", "blue movement arrow (prowl)"
       ├─ cell           { x, y, index } in grid space, plus that cell's military
       │                 properties (cover, concealment, moveCostFactor,
       │                 visibility, ambush, slope, elevation)
       ├─ path           routes: the ordered cells the arrow crosses, start → end
       ├─ footprint      objectives: every cell inside radiusMeters
       └─ corridor       aggregate of the ground covered (class counts,
                         dominant class, crossesWater, elevation range)
```

Cell space is stated in the payload itself (`cellSpace`): `x` = column west→east,
`y` = row north→south, `index = y * width + x`, cells `cellMeters` square — the
same row-major layout as the binary grid, so a consumer never does lon/lat math.
Nothing is persisted; the brief is derived from the stored grid on each request.
See `server/src/services/planBrief.ts` and `server/src/lib/cells.ts`.

### Road graph

`server/src/services/roadGraph.ts` turns Overpass ways into a routable graph:
junctions and free ends become nodes, everything between them is one edge that
keeps its shape. Junction detection counts visits across drivable ways only, so
a footpath crossing a road is not a junction for a vehicle. Output is sorted and
edge ids derive from way and offset, so unchanged ground rebuilds identically.

This is the first piece of the route substrate described in the spec above.

### Performance notes

- The grid crosses the wire as one binary buffer (16-byte header + typed-array
  channels) — no JSON for the large payloads; decode is zero-copy views.
- Heatmaps are rendered once to a canvas and draped as a single GPU texture;
  switching metrics never touches entity geometry.
- Repeat selections of the same ground are served from an in-memory LRU
  (instant), and DEM tiles are cached across jobs.
- Trees are one GPU-instanced `BillboardCollection`; building extrusion
  animations are frozen to constants after the reveal so nothing evaluates
  per-frame afterwards.

### Stack decisions

- **Fastify + Socket.IO on Node (via tsx)** — Bun stays the package
  manager/test runner; the server process runs on Node because Socket.IO's
  websocket upgrade is flaky on Bun 1.1.x.
- **No deck.gl / tldraw** — the battlefield renders inside the existing Cesium
  scene (one WebGL context, one camera; unit/route drawing already worked
  there).
- **No queue** — the terrain pipeline is I/O-bound and completes in seconds with
  in-process caching, so a queue would add hops rather than remove them.
- **Heuristic classifier, honestly labeled** — deterministic OSM + slope rules
  produce the military properties today; the segmentation-model upgrade path
  is isolated behind `server/src/services/classify.ts`.

## Tests

```bash
cd server && bun test        # tile math, wire format, classifier, plan brief, road graph
cd frontend && bun test && bun run lint && bunx tsc -b
```

## Layout

```
athena/
├── frontend/   Vite 8 + React 19 + resium/Cesium + Tailwind v4 + zustand + framer-motion
│   └── src/{components,state,lib,hooks,pages,types}
└── server/     Fastify 5 + Socket.IO + zod + Drizzle (bun-managed, runs on tsx)
    └── src/{routes/,services/{dem,osm,weather,classify,grid,pipeline,
             planBrief,roadGraph},db/,lib/}
```

## Security notes

This service has **no user model**. Anyone who can reach it can read any plan by
id and generate battlegrounds. Deploy it behind whatever authenticates your
users; the controls here are damage limitation, not authentication:

- `CORS_ORIGINS` restricts which browser origins may call it.
- `BATTLEGROUND_RATE_LIMIT` caps the one endpoint that spends third-party API
  quota. Everything else reads from Postgres or memory.

Real per-user authorisation needs accounts, which is a product decision rather
than a missing guard.
