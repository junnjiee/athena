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
> [`engine/ENGINE.md`](engine/ENGINE.md).

## Quick start

### Everything at once, with Docker

This is the recommended way to run Athena if you are not developing it. The
only thing to install is Docker; Postgres, migrations and all three services
are handled by compose.

**Step 1 — Install Docker.** You need Docker Engine 24+ with Compose v2
(`docker compose`, not `docker-compose`).

- macOS: `brew install --cask docker` (Docker Desktop) or
  `brew install --cask orbstack`, then launch it and wait until it reports
  running. Both Apple Silicon and Intel work; every image is multi-arch.
- Windows: Docker Desktop with the WSL 2 backend.
- Linux: your distribution's `docker` and `docker-compose-plugin` packages.

Check with `docker compose version`.

**Step 2 — Get the code.**

```bash
git clone <this repository>
cd Athena
```

**Step 3 — Create the root `.env`.**

```bash
cp .env.docker.example .env
```

One root `.env` covers all three services — compose passes the variables in
directly, so the per-process `.env` files described under *On the host* are
not used here, and the engine's `--env-file` caveat does not apply.

**Step 4 — Fill in the keys for the full MVP.** The stack starts with every
value blank; terrain generation, plan drawing, route studies and block forces
are deterministic and need nothing. The keys below are what turns on the rest.

| Key in `.env` | Feature it unlocks | Where to get it | Without it |
|---|---|---|---|
| `PROVIDER_API_KEY` | **Assess enemy courses** — the S2 courses-of-action pass, the one place a model reasons about enemy intent | The console of whichever provider `ATHENA_MODEL` names (OpenAI by default) | The button returns `503` and says plainly that no model is configured. Routes and block forces still work |
| `ATHENA_MODEL` | Which model the key above is for, as `provider:name` | — | Defaults to `openai:gpt-5.6-sol`. `anthropic:claude-opus-5`, `google:gemini-2.5-pro`, `ollama:llama3.3` also work — one key, whichever provider |
| `VITE_CESIUM_ION_TOKEN` | Full-speed world imagery and terrain on the globe | Free account at cesium.com → *Access Tokens* | Falls back to Cesium's rate-limited demo token; the globe still works but tiles load noticeably slower |
| `VITE_GOOGLE_MAPS_KEY` | **RECON** mode — Google Photorealistic 3D Tiles over the area | Google Cloud console → enable *Map Tiles API* → create an API key. Free tier is enough for a demo | RECON falls back to the ion proxy asset (needs a real ion token); with neither, the Recon toggle is disabled |
| `ELEVENLABS_API_KEY` | Voice assistant — talk to Athena to pick ground and drive planning | elevenlabs.io → profile → *API Keys* | Assistant dock reports "not configured"; everything else works |
| `ELEVENLABS_AGENT_ID` | The Athena agent on your ElevenLabs account | Generated for you in Step 6 | Same as above |
| `CORS_ORIGINS` | Only for a deployed frontend | — | Leave blank locally: any localhost port is allowed |

For the complete demo you need four things: a model provider key, a Cesium
ion token, a Google Maps key, and an ElevenLabs key. Every key stays inside
the stack — none is ever sent to the browser except the two `VITE_` ones,
which are public-by-design client tokens.

**Step 5 — Build and start.**

```bash
docker compose up --build
```

The first build downloads three base images and installs every dependency —
Cesium alone is several hundred megabytes — so expect **3–8 minutes** on a cold
machine. Later starts take seconds. You are up when the logs show the server
listening on `8787`, uvicorn on `8000`, and Vite printing its `Local:` URL.

| | |
|---|---|
| Web app | http://localhost:5173 |
| Terrain API | http://localhost:8787 |
| Engine API | http://localhost:8000 |
| Postgres | `postgresql://athena:athena@localhost:5432/athena` |

Open http://localhost:5173. It redirects to the planning surface.

**Step 6 — Create the voice agent (only if you set `ELEVENLABS_API_KEY`).**
The agent's prompt and tool catalog live in the repo, so it is created from
code rather than in a dashboard. With the stack running:

```bash
docker compose run --rm server node_modules/.bin/tsx scripts/sync-agent.ts
```

It prints an agent id. Paste it into `.env` as `ELEVENLABS_AGENT_ID`, then
`docker compose up -d server` to restart the server with it. Re-run the same
command any time `server/src/services/assistantAgent.ts` changes.

**Step 7 — Verify the full MVP.** In order, each should work before the next:

1. Drag-select ground on the globe (≤ 800 m) → *Generate Battlefield*. Terrain
   ingests live from public DEM/OSM/imagery services and streams progress — no
   key involved, but it does need outbound internet.
2. Draw units and routes; the bottom bar reports ETA, exposure, confidence.
3. Switch on **RECON** — photorealistic tiles appear (`VITE_GOOGLE_MAPS_KEY`).
4. Open route studies, mark the ground, run a study — corridors and block forces
   are deterministic and need no key.
5. **Assess enemy courses** — the model answers (`PROVIDER_API_KEY`).
6. Open the assistant dock and speak (`ELEVENLABS_*`).

**Day-to-day**

```bash
docker compose up -d              # run in the background
docker compose logs -f server     # tail one service (server | engine | frontend | postgres)
docker compose up -d              # again after editing .env: values are read at container start
docker compose up --build         # after changing dependencies (package.json, pyproject.toml)
docker compose down               # stop everything, keep the database
docker compose down -v            # stop and wipe the database
```

`frontend/src`, `server/src` and `engine/athena` are bind-mounted, so edits on
the host are picked up live — Vite keeps HMR and the terrain service runs under
`tsx watch`. Rebuild only when dependencies change. `.env` changes need
`docker compose up` again (no rebuild) because the values are read at container
start.

**If something goes wrong**

- `port is already allocated` — something on your machine already uses 5432,
  5173, 8787 or 8000. Stop it, or change the left-hand side of the `ports:`
  mapping in `docker-compose.yml` (a local Postgres on 5432 is the usual one).
- The first battlefield never finishes — the terrain pipeline calls public
  Overpass mirrors and AWS terrain tiles; on a locked-down network these may be
  blocked. `docker compose logs -f server` shows which fetch stalled.
- **Assess enemy courses** says no model is configured while the key is in
  `.env` — you edited `.env` after starting; run `docker compose up -d engine`.
- Blank globe or `401` in the browser console — `VITE_CESIUM_ION_TOKEN` is
  wrong. Remove it to fall back to the demo token.

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
