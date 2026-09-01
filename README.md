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

## God's Eye pivot (in progress)

Athena is being re-aimed from battle-plan simulation to an **open-source
live-open-data operations console for Singapore**, built on
[God's Eye View](https://github.com/bilawalsidhu/gods-eye-view) with the
simulation engine removed. The full specification is in [`PRD.md`](PRD.md);
what already runs:

```bash
# 1. Singapore data plane (port 8787) — no database needed
cd server && bun install && bun run sg

# 2. The console (port 4173) — proxies /api/sg to the above
cd app && npm install && npm run dev
```

Open http://localhost:4173, then enable **SG Weather**, **SG Taxis** or
**SG Hazards** in the DATA LAYERS panel. No API keys are required for any of
it: the globe falls back to the keyless OSM + Re:Earth stack, and every
Singapore feed used here is keyless. A Google Maps key upgrades the globe to
photorealistic 3D tiles; an `LTA_ACCOUNT_KEY` (free, instant, from
datamall.lta.gov.sg) adds the live road picture.

`GET /api/sg/feeds` lists what this deployment can serve. Each feed answers with
its data plus a provenance envelope — source, attribution, licence, age, cadence
and state (`live` / `cached` / `stale` / `degraded` / `unavailable`) — so a feed
that is thinned or missing a key says so rather than looking normal.

See [`app/ATHENA.md`](app/ATHENA.md) for what was changed in the vendored fork
and how to merge upstream.

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
  └─ drag-select ground (≤1 km)  →  Generate Battlefield
       └─ POST /api/battleground             Fastify (Node/tsx)
            ├─ DEM: AWS Terrain Tiles (terrarium PNG), mosaic + bilinear sample
            ├─ Features: Overpass API (roads/buildings/landcover/water), 4 mirrors
            ├─ Weather: Open-Meteo (current conditions)
            ├─ Classifier: RBush + point-in-polygon + slope → 10 terrain classes
            ├─ Military grid: cover, concealment, move cost, exposure,
            │                 vehicle mobility, ambush potential (≤1000×1000 cells)
            └─ progress streamed over Socket.IO ("Athena is reasoning…" panel)
       └─ GET meta (JSON) + grid (binary Float32/Uint8, ~800 KB)
  └─ battlefield reveal: roads draw → water fills → buildings extrude
       → procedural trees populate (staged 5 s animation)
  └─ heatmap drape (single-tile imagery layer from a colormapped canvas)
  └─ hover = live cell sample (TERRAIN INFO panel)
  └─ routes validated against the grid: water crossings, steep slopes,
       exposed stretches, slow going + ETA / exposure / confidence in bottom bar
```

Selections are capped at 1 km a side (`config.maxExtentMeters`) and cells are
fixed at 1 m regardless of extent, so a full-size battleground is 1000×1000 cells.

### Plan → simulation

```
Run Simulation (bottom bar, needs a saved plan)
  └─ POST /api/plans/:id/simulate      { simulationCount, ticks, model? }
       ├─ reads the plan + its stored grid from Postgres
       ├─ expands establishment: one platoon marker (strength 21) → 21 soldiers
       ├─ projects the packed grid into the engine's payload, gzips it
       └─ POST {ENGINE_URL}/v1/simulation-batches   (bearer token, never the browser's)
  └─ GET /api/simulations/:batchId/events
       └─ relays the engine's SSE stream, Last-Event-ID and all, carrying
          each run's outcome as it lands
            ├─ simulation.completed → { summary, replayPath }
            ├─ simulation.failed
            └─ batch.completed
            ├─ simulation.progress → per-tick state of a run in flight:
            │                        who is deciding, tick latency, standing
            │                        orders, alive counts, shots
  └─ summaries aggregated live into a win rate, converging as runs land
```

Runs are scored by the engine, at the point the run ends, and the result rides
out on the completion event. Nothing fetches a replay to compute a win rate;
`server/src/services/replaySummary.ts` remains as a fallback for a batch queued
by an engine that does not report outcomes.

Replays themselves got an order of magnitude smaller. Schema 4 drops the
per-cell battlefield surface, which was ~16 MB of a 17 MB replay on an 800×800
ground and byte-identical in every run of a batch; elevation is already in the
terrain grid, and every soldier and shot carries its own. `replayPath` fetches
one on demand for the replay viewer.

Completed batches outlive the tab that watched them: the engine stores each run's
outcome and lists batches, and the service keeps the batch → plan mapping the
engine cannot know. The **Simulations** page joins the two.

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

A batch is priced by **decisions, not soldiers**, and three things keep that
number small:

1. **Only section commanders are agents.** A rifle section is seven men under one
   commander; the other six run the engine's section policy and never contact a
   provider. Sevenfold.
2. **A commander only decides when something changes.** Each tick it is described
   by a coarse situation signature — nearest enemy's distance band, whether it is
   under fire, its section's strength. Unchanged means it carries on: advancing
   along its drawn axis out of contact, repeating its last decision in contact.
3. **A soldier out of contact marches.** Crossing empty ground at a fighting pace
   burned ticks — and therefore decisions — on an approach nobody needed to think
   about.

Measured on a 28-soldier plan with the forces 135 m apart over 120 ticks: **3,360
model calls under one-per-soldier-per-tick, 105 actually made — 32× fewer**, and
the cost grows sub-linearly with the tick budget, so a long approach is now
affordable. The run reports both numbers so the saving is visible.

**On wall clock**, ticks are serial and a tick in contact costs one decision
round trip, so a single run is bounded by its own ticks — not by how many calls
it makes. What moved that number was cutting what each call has to read: the
agent history windows went from ten ticks to four, which took per-call latency
from a rising 1.6→7 s to a flat 2.2 s median. Batching a tick's decisions into
one request was tried and measured *slower* (290 s → 600 s+), because concurrent
requests overlap where one generation does not. For a *batch* of runs the lever
is `WORKER_CONCURRENCY` and `WORKER_REPLICAS`, which scale almost linearly. The server
caps sections (`config.maxAgentsPerSimulation`) and soldiers separately, and the
run dialog prices a batch before you commit to it.

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

## What the engine simulates of a drawn plan

Everything a commander draws now reaches the simulation:

- **Objectives** carry a side. The owner is ordered to take and hold it, the other
  side to stop them; an objective with no side is contested.
- **Routes** become an axis of advance in grid coordinates, and the **gait**
  (`prowl` / `patrol` / `charge`) sets how much ground a soldier covers per tick.
- **Unit strength** expands one marker into one agent per soldier, and an
  establishment's **vision range** reaches the soldiers it fields.
- **Fortifications** become protective ground rather than a man standing in a
  hole — a trench raises the protection of the cells it covers.
- **H-hour** decides daylight; a night plan halves what a soldier can pick out.

A tick is a bound on how far a soldier travels rather than a fixed metre: entering
a cell spends its move cost against a per-tick allowance, so a soldier covers more
road than wetland, and forces drawn tens of metres apart reach each other inside a
normal tick budget.

Movement routes with a distance field, so a force goes **round** a river rather
than into it, and a plan whose objective is on the far side of severed ground is
refused before it costs a batch rather than after it produces an
"inconclusive". A soldier detects at its establishment's range and may engage
anything it sees;
what makes a long shot a bad idea is the rifle's range falloff, not a cap on
reporting. Completed runs are watchable **on the battleground itself**. The conclusion page
hands you back to the globe with the plan still drawn and the run playing over
the real ground: soldiers as figures clamped to the terrain, tracers between
them, casualties left where they fell, and each section commander's stated
reasoning floating above it as the tick advances. Underneath is the aggregate
across every run in the batch — where this plan *tends* to take people, and
where it tends to get them killed — draped on the ground as a probability layer.
The plan stays editable while you watch, which is the point: you correct it
against what actually happened, on the ground it happened on.

A firefight is decided by position and cover rather than by who shot first: a
soldier under fire shoots at a third of its normal accuracy, a magazine is thirty
rounds with a one-tick reload, and a section whose commander is killed promotes a
survivor. Every run is seeded, so a batch reproduces itself and its win rate
carries a 95% confidence interval. Every agent states why it did what it did, and
the **conclusion page** shows that reasoning alongside the verdict and a ranked
list of what to change about the plan.

Still open: weather beyond daylight, re-submitting a chosen seed from the UI, a
user model, and component/E2E tests. See
[`ENGINE_CHANGES.md`](ENGINE_CHANGES.md).
