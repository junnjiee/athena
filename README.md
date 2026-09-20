# ATHENA — Terrain Intelligence & Battle Planning

A commander sketches a plan on real ground and instantly sees whether it works.
Globe → area selection → live terrain ingestion → military classification → 3D
battlefield with tactical heatmaps → plan drawing → AI plan validation.

Three processes:

| | Stack | Port | Role |
|---|---|---|---|
| `frontend/` | Vite 8 + React 19 + resium/Cesium + Tailwind v4 + zustand | 5173 | Globe, battlefield render, planning surface, voice assistant |
| `server/` | Fastify 5 + Socket.IO + Drizzle/Postgres | 8787 | Terrain pipeline, persistence, the engine's only caller |
| `engine/` | FastAPI + pydantic-ai (Python, uv) | 8000 | Route studies, enemy courses of action, block forces |

The frontend talks only to the server; the server is the only thing that talks
to the engine. The engine holds no state of its own — it pulls an operational
area's road graph from the server, computes, and returns the result.

> **On the planning engine.** Athena previously carried a force-on-force
> simulation that ran LLM-driven soldiers over this terrain and scored a plan by
> Monte Carlo. That was removed and replaced by `engine/`, which complements
> battle procedure rather than fighting the battle: enemy reinforcement routes
> and their courses of action for the S2, deployable block forces for the S3.
> Behaviour and modelling assumptions are in
> [`engine/ENGINE.md`](engine/ENGINE.md); the original design is in

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
| Engine API | http://localhost:8000 |

One root `.env` covers all three services here — compose passes the variables in
directly, so the per-process `.env` files below are not used and the engine's
`--env-file` caveat does not apply. Postgres and the migrations are handled for
you. To use the courses-of-action pass, set `ATHENA_MODEL` and
`PROVIDER_API_KEY` in that root `.env`.

`frontend/src`, `server/src` and `engine/athena` are bind-mounted, so edits on
the host are picked up live — Vite keeps HMR and the terrain service runs under
`tsx watch`. Rebuild only when dependencies change.

### On the host

You need **Bun**, **Python 3.11+** with [uv](https://docs.astral.sh/uv/), and a
**Postgres** to point at. There are three separate `.env` files, one per process
— there is no shared root one outside Docker.

**0. Postgres.** Easiest is the one from compose; any Postgres or a Neon
connection string works just as well.

```bash
docker compose up -d postgres   # postgresql://athena:athena@localhost:5432/athena
```

**1. Terrain service** — port 8787.

```bash
cd server
cp .env.example .env            # set DATABASE_URL and ENGINE_URL (below)
bun install
bun run db:migrate              # creates the tables; run once, and after schema changes
bun run dev
```

`server/.env` must contain at least:

```
DATABASE_URL=postgresql://athena:athena@localhost:5432/athena
ENGINE_URL=http://localhost:8000
```

The server refuses to start without `DATABASE_URL`. It loads `.env` itself (via
`dotenv/config`), so no flag is needed.

**2. Planning engine** — port 8000. Only this process needs a model key.

```bash
cd engine
uv sync
cp .env.example .env            # set ATHENA_MODEL and PROVIDER_API_KEY (below)
uv run --env-file .env uvicorn athena.service:app --port 8000
```

`engine/.env`:

```
TERRAIN_SERVICE_URL=http://localhost:8787
ATHENA_MODEL=openai:gpt-5.6-sol
PROVIDER_API_KEY=<your key for whichever provider ATHENA_MODEL names>
```

> **`--env-file` is not optional.** Unlike the server, the engine reads
> `os.environ` directly and loads no file of its own, so a plain `uv run`
> silently ignores `.env`. The symptom is **Assess enemy courses** failing with
> "the engine has no model to ask" while the key sits correctly in the file. Add
> `--reload` too if you are editing engine code — it does not pick up changes
> otherwise. See [`engine/README.md`](engine/README.md).

**3. Web app** — port 5173, proxies `/api` and `/socket.io` to 8787.

```bash
cd frontend
cp .env.example .env.local      # optional keys; note .env.local, not .env
bun install
bun run dev
```

Open http://localhost:5173. It redirects to the planning surface.

Everything except the engine works with no keys at all: terrain generation, plan
drawing, route studies and block forces are deterministic. Only the enemy
courses-of-action pass reaches a model.

## Environment

| File | Key | Without it |
|---|---|---|
| `server/.env` | `DATABASE_URL` | **The server will not start.** Neon string or any Postgres URL — `src/db/client.ts` picks the driver from the hostname, because Neon's serverless driver speaks HTTP rather than the Postgres wire protocol and cannot reach a local server |
| | `ENGINE_URL` | Route studies, courses and block forces return `503`; terrain generation and plan drawing still work |
| | `CORS_ORIGINS` | Any localhost port is allowed, which is what you want locally. A deployed frontend must be named here |
| | `BATTLEGROUND_RATE_LIMIT` | Defaults to 20 generations per caller per minute — the one endpoint that spends third-party quota |
| | `ELEVENLABS_API_KEY` / `ELEVENLABS_AGENT_ID` | The assistant dock reports "not configured"; everything else works. Run `bun run agent:sync` once after setting the key to create the agent and print its id |
| `engine/.env` | `ATHENA_MODEL` | Defaults to `openai:gpt-5.6-sol`. Named as `provider:name` and resolved by pydantic-ai — `anthropic:claude-opus-5`, `google:gemini-2.5-pro`, `ollama:llama3.3` all work |
| | `PROVIDER_API_KEY` | Falls back to whatever conventional variable that provider expects (`OPENAI_API_KEY` and so on). With neither, **Assess enemy courses** returns `503` naming both variables |
| | `TERRAIN_SERVICE_URL` | Defaults to `http://localhost:8787` |
| `frontend/.env.local` | `VITE_CESIUM_ION_TOKEN` | Falls back to Cesium's rate-limited demo token — world imagery and terrain load noticeably slower. Free account at cesium.com |
| | `VITE_GOOGLE_MAPS_KEY` | RECON (photorealistic) mode falls back to the ion proxy asset; with neither, the Recon toggle is disabled |

One key, not one per vendor, is deliberate on the engine side: which client
`PROVIDER_API_KEY` reaches follows from `ATHENA_MODEL` alone, so swapping
provider is a change of those two lines and nothing else.

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
cd server   && bun test                  # tile math, wire format, classifier, plan brief, road graph
cd frontend && bun test && bun run lint && bunx tsc -b
cd engine   && uv run pytest             # routing, corridors, ORBAT, blocking, ranking, HTTP surface
```

The engine suite needs no key and touches no network: the courses-of-action
pass is driven through pydantic-ai's offline test models.

## Layout

```
athena/
├── frontend/   Vite 8 + React 19 + resium/Cesium + Tailwind v4 + zustand + framer-motion
│   └── src/{components,state,lib,hooks,pages,types}
├── server/     Fastify 5 + Socket.IO + zod + Drizzle (bun-managed, runs on tsx)
│   └── src/{routes/,services/{dem,osm,weather,classify,grid,pipeline,
│            planBrief,roadGraph,engineClient},db/,lib/}
└── engine/     FastAPI + pydantic-ai (Python, uv-managed)
    └── athena/{graph,routing,corridors,study,eca,preference,orbat,blocking,service}.py
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
