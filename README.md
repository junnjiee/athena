# ATHENA — Terrain Intelligence & Battle Planning

A commander sketches a plan on real ground and instantly sees whether it works.
This repo currently implements the **terrain visualization pipeline** (steps 1–10 of
the product journey): globe → area selection → live terrain ingestion → military
classification → 3D battlefield with tactical heatmaps → plan drawing → AI plan
validation. The Monte Carlo simulation engine is Phase 2 and not built yet.

## Quick start

```bash
# 1. API + terrain pipeline (port 8787)
cd server && bun install && bun run dev

# 2. Web app (port 5173, proxies /api and /socket.io to 8787)
cd frontend && bun install && bun run dev
```

Optional: set `VITE_CESIUM_ION_TOKEN` in `frontend/.env.local` (free account at
cesium.com) — without it the app falls back to Cesium's rate-limited demo token,
which loads world imagery/terrain noticeably slower.

## How it works

```
Cesium globe (world terrain + satellite)
  └─ drag-select ground (≤3 km)  →  Generate Battlefield
       └─ POST /api/battleground             Fastify (Node/tsx)
            ├─ DEM: AWS Terrain Tiles (terrarium PNG), mosaic + bilinear sample
            ├─ Features: Overpass API (roads/buildings/landcover/water), 4 mirrors
            ├─ Weather: Open-Meteo (current conditions)
            ├─ Classifier: RBush + point-in-polygon + slope → 10 terrain classes
            ├─ Military grid: cover, concealment, move cost, exposure,
            │                 vehicle mobility, ambush potential (≤288×288 cells)
            └─ progress streamed over Socket.IO ("Athena is reasoning…" panel)
       └─ GET meta (JSON) + grid (binary Float32/Uint8, ~800 KB)
  └─ battlefield reveal: roads draw → water fills → buildings extrude
       → procedural trees populate (staged 5 s animation)
  └─ heatmap drape (single-tile imagery layer from a colormapped canvas)
  └─ hover = live cell sample (TERRAIN INFO panel)
  └─ routes validated against the grid: water crossings, steep slopes,
       exposed stretches, slow going + ETA / exposure / confidence in bottom bar
```

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
- **No PostGIS / Redis / BullMQ / Piscina yet** — they exist to serve the
  simulation cluster (job queues, worker pools, persistent AOs). The terrain
  pipeline is I/O-bound and completes in seconds with in-process caching, so
  they'd add latency (extra hops) rather than remove it. Slot them in with
  Phase 2.
- **Heuristic classifier, honestly labeled** — deterministic OSM + slope rules
  produce the military properties today; the segmentation-model upgrade path
  is isolated behind `server/src/services/classify.ts`.

## Tests

```bash
cd server && bun test        # tile math, wire-format round-trip, classifier rules
cd frontend && bun run lint && bunx tsc -b
```

## Layout

```
athena/
├── frontend/   Vite 8 + React 19 + resium/Cesium + Tailwind v4 + zustand + framer-motion
│   └── src/{components,state,lib,hooks,pages,types}
└── server/     Fastify 5 + Socket.IO + zod (bun-managed, runs on tsx)
    └── src/{routes.ts,services/{dem,osm,weather,classify,grid,pipeline},lib}
```
