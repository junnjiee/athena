# PRD — Athena God's Eye (Singapore)

| | |
|---|---|
| **Status** | v1.0 — complete; data catalog verified against live endpoints |
| **Date** | 2026-08-27 |
| **Owner** | Tim |
| **Supersedes** | `GODS_EYE_PIVOT.md` §engine sections — **the simulation engine is out of scope** |
| **Base repo (source of truth)** | [bilawalsidhu/gods-eye-view](https://github.com/bilawalsidhu/gods-eye-view) (MIT code, data carve-outs) |

---

## 1. Overview

Athena pivots from a battle-planning simulator into an **open-source, all-domain,
live open-data operations console for Singapore** — a "god's eye" that fuses every
usable public feed (air, sea, land, weather, cameras, crowds) onto a photorealistic
3D globe, scoped to an incident, with terrain-aware route planning on top.

Three sources feed the product:

1. **GEV (gods-eye-view)** — adopted wholesale as the **source of truth**: its
   Cesium globe shell, layer architecture, data adapters, voice agent, annotation
   engine, sensor modes, and module conventions are canonical. We fork it and
   build *inside* its idioms, not around them.
2. **Athena minus the engine** — the Fastify terrain pipeline, military-grade
   ground classification grid, plan drawing/persistence, and route validation
   survive as the backend "decision layer." The Python simulation engine, its
   workers, and every replay/simulation UI surface are **dropped**.
3. **data.gov.sg + LTA DataMall + OneMap** — a new Singapore data plane across
   three surfaces (§10): traffic speed bands, incidents and VMS, 90 traffic
   cameras, live bus positions, MRT crowd density, rainfall/wind/PSI, **lightning,
   flood alerts, and georeferenced weather radar**, dengue clusters, and
   government-authoritative routing — integrated as GEV-style layer modules behind
   the Athena server's polling proxy.

**Anchor scenario:** a mass-casualty incident at the **Singapore National Stadium
(Sports Hub, Kallang, capacity ~55,000)** during egress. The console shows live
traffic, cameras, transit, weather, and vessel/air pictures around the venue;
the operator generates a terrain grid over Kallang, draws evacuation corridors
and responder ingress routes, and the system validates them against ground truth
(water, slopes, choke points, live congestion) — no simulation, pure live data +
deterministic validation.

## 2. Problem & opportunity

- Every OSINT globe (FlightRadar, MarineTraffic, GEV itself) is **watch-only**.
  Nothing open-source closes the loop from *seeing* to *planning*.
- Emergency-ops software is closed, expensive, and slow to procure (Palantir,
  ESRI). An open, keyless-first console that runs in a browser is an adoption
  wedge for exercises, tabletops, and event planning.
- Singapore is the ideal reference city: the world's densest official open-data
  API surface (data.gov.sg, LTA DataMall, OneMap), one of the busiest shipping
  straits on Earth for the AIS layer, Changi + Paya Lebar for the air picture,
  full Google Photorealistic 3D Tile coverage, and a compact geography where a
  single demo can show everything.
- GEV's own README disclaims emergency-response use. We differentiate by
  engineering for that gap honestly: provenance, data-age labels, degradation
  behavior, and an explicit exercise-vs-live posture — decision *support*, human
  in the loop, never a certified life-safety system.

## 3. Goals

1. **G1 — Full GEV integration:** the forked GEV app runs unmodified feature-wise
   (flights, vessels, satellites, fires, quakes, voice, cockpit, annotations)
   and remains mergeable with upstream.
2. **G2 — Singapore data plane:** every usable data.gov.sg / LTA / OneMap feed
   relevant to traffic, cameras, crowds, weather, and incident response is a
   toggleable GEV layer with live updates, attribution, and staleness display.
3. **G3 — Athena decision layer, engine-free:** battleground grid generation,
   terrain heatmaps, plan drawing, and deterministic route validation ported
   into the GEV shell, served by the Athena Fastify backend.
4. **G4 — Incident model:** one-click incident declaration that rescopes every
   layer to a geofence + clock, with a timeline log and shareable brief.
5. **G5 — Single deployable:** one `docker compose up` — GEV frontend + Athena
   server + Postgres. No Redis, no MinIO, no Python.

## 4. Non-goals (explicit)

- **No simulation engine.** No Monte Carlo runs, no LLM soldier agents, no
  replays, no tick loop. `engine/` is deleted; `redis`, `minio`, `engine-api`,
  `engine-worker` leave docker-compose; `simulation_batches` leaves the schema.
- **No person tracking, face recognition, or named-person search** (GEV's red
  lines are inherited verbatim).
- No mobile app, no offline mode, no CAD/dispatch integration in v1.
- No scraping of non-API sources; official APIs and licensed datasets only.
- No military combat modelling; "military" appears only as GEV's existing
  military-flight registry.

## 5. Personas & use cases

| Persona | Use case |
|---|---|
| **Event security planner** | Pre-event: generate terrain grid over venue, draw and validate egress corridors, identify choke points, save the plan as a brief. |
| **Exercise controller (SCDF/venue tabletop)** | Run a tabletop against live city data; inject an incident pin; ask the voice assistant for the current picture. |
| **OSINT hobbyist / researcher** | GEV's existing audience: watch the strait, the airport, the city — now with the densest city data pack ever shipped. |
| **Ops watch officer (informal)** | Ambient situational awareness: alerts when CAP-style feeds (weather, dengue, incidents) intersect a watched geofence. |

## 6. Anchor scenario — National Stadium, minute by minute

| Beat | Operator action | System behavior | Feature IDs |
|---|---|---|---|
| T+0 | Drops an **Incident pin** on the Stadium; sets 2 km geofence | Every layer rescopes: cameras, traffic, transit, vessels, flights ranked by distance to incident; incident clock + timeline log start | E5-1, E8-1 |
| T+1 | Toggles **LTA traffic cameras** | Nearest camera images (Nicoll Highway, ECP, Merdeka Bridge approaches) projected at their true positions, refreshing on the API's cadence, age-labeled | E3-2 |
| T+2 | Toggles **speed bands + incidents** | Live congestion coloring on Kallang road network; LTA incident/roadwork markers; VMS messages | E3-1 |
| T+3 | Checks **weather and hazards** | Rainfall (5 min) and wind direction/speed at the nearest NEA stations — wind drives smoke and hazmat reasoning; 2-hr nowcast for the Kallang area; **live lightning strikes (2 min) as a halo over an open stadium**; PUB flood alerts with severity; radar imagery draped on the globe | E3-4, E3-4b, E3-4c |
| T+4 | Generates **battleground grid** over Sports Hub (≤1 km) | Athena pipeline: DEM + OSM + classification → mobility/water/choke heatmaps draped on the 3D tiles; Kallang Basin water boundaries make bridge choke points obvious | E4-1..4 |
| T+5 | Draws **egress corridors** from gates to rally points (Kallang MRT, Stadium MRT, Tanjong Rhu) | Route validation: water crossings flagged, bridge widths noted, ETA at crowd walking pace, live congestion overlaid on crossing roads | E5-2, E6-1 |
| T+6 | Draws **responder ingress** (SCDF from Kallang Fire Station, ambulances to hospitals from OneMap themes) | **OneMap `drive` routing re-costed by live speed bands** gives the road leg; the Athena cost grid covers the off-network approach across the concourse; deconfliction warning where ingress crosses egress | E6-2 |
| T+7 | Checks **transit and crowding** | Live bus positions + `Load` near stadium stops (20 s), **MRT station crowd density at Stadium and Kallang (10 min — the only true crowd signal that exists)**, train service alerts, taxi and carpark availability as dispersal capacity | E3-3, E3-3b, E3-5 |
| T+8 | Asks the **voice assistant** "what's between Gate C and Kallang MRT right now?" | Assistant answers grounded in fused layers + terrain grid, cites data ages | E7-1 |
| T+9 | Exports the **incident brief** | Timeline, active layers snapshot, validated routes, camera stills, all provenance-stamped | E8-3 |

## 7. Product principles

1. **GEV is the source of truth.** Its repo layout, vanilla-JS module style,
   layer-registration pattern (`src/main.js`), per-layer `src/data/*.js` modules,
   voice-tool registry, QA-script culture, and `DATA_SOURCES.md` discipline are
   the canon. Athena code adapts to GEV; never the reverse. Upstream merges stay
   possible: our additions are new files plus minimal registration diffs.
2. **Keyless-first.** Every layer that can run without an API key does; keyed
   layers (LTA DataMall, Google tiles) degrade gracefully with a plain in-app
   explanation, exactly like GEV's BYOK pattern.
3. **Honest data.** Every entity shows source, timestamp, and age. Stale is
   visibly stale. Monthly data is labeled "planning baseline," never presented
   as live.
4. **Decision support, not command.** Human in the loop; exercise watermark by
   default; not for safety-of-life navigation. Disclaimers inherited and
   extended, and the engineering (provenance, degradation) backs them up.
5. **City packs.** Singapore is the first `config/*.singapore.json` city pack;
   the structure stays generic so contributors can add cities the way GEV added
   Austin/Shinjuku CCTV.

## 8. System architecture

```
┌─────────────────────────────────────────────────────────────┐
│  GEV shell (fork; Vite + vanilla JS + CesiumJS)  ── SOURCE  │
│  OF TRUTH: globe, layer manager, voice, annotations,        │
│  sensor modes, cockpit, HUD                                 │
│   ├─ existing src/data/* layers (flights, AIS, sats, FIRMS, │
│   │   quakes, traffic, CCTV, radio, launches, cables…)      │
│   ├─ NEW src/data/sg/* layers (data.gov.sg + LTA + OneMap)  │
│   └─ NEW src/athena/* modules (terrain grid, heatmaps,      │
│       plan drawing, route validation UI, incident model)    │
├─────────────────────────────────────────────────────────────┤
│  Athena server (Fastify + Socket.IO + Drizzle/Postgres)     │
│   ├─ terrain pipeline: dem / osm / classify / grid /        │
│   │   pipeline / landcover / planBrief / battlegroundStore  │
│   ├─ plans CRUD + brief derivation                          │
│   ├─ NEW /api/sg/* proxy: keys held server-side, caching,   │
│   │   rate-limit governor per source (GEV's TomTom pattern) │
│   ├─ NEW routing service: cost-grid egress/ingress routing  │
│   └─ assistant agent (merged with GEV voice tools)          │
├─────────────────────────────────────────────────────────────┤
│  Postgres (battlegrounds, plans, incidents)                 │
└─────────────────────────────────────────────────────────────┘
```

**Deleted:** `engine/` (all of it), docker services `redis`, `minio`,
`minio-init`, `engine-api`, `engine-worker`; server `routes/simulations.ts`,
`services/simulationPayload.ts`, `services/replaySummary.ts`, schema table
`simulation_batches`; frontend `ReplayController`, `ReplayViewer`,
`SimulationModal`, `SimulationResultStrip`, `EngineActivityPanel`,
`ReasoningPanel`, `PlaybackBar`, `lib/simulationStream.ts`, `lib/replayGeo.ts`,
`lib/soldierSprite.ts`, `state/simulation.ts`, `types/replay.ts`.

**Retired by porting:** Athena's React frontend. GEV as source of truth means
the React/resium app is not the shell; its terrain/plan features are
re-implemented as GEV-style vanilla modules (the ported logic in
`lib/grid.ts`, `lib/validate.ts`, `lib/movement.ts`, `lib/contours.ts`,
`lib/selectionGeometry.ts` is framework-free TypeScript and ports cleanly).

## 9. Technical feature map

Priorities: **P0** = demo-critical, **P1** = launch, **P2** = later.
Source: **GEV** (exists, keep), **PORT** (from Athena), **NEW**.

### E1 — Globe & shell (all GEV, all P0)

| ID | Feature | Source | Notes |
|---|---|---|---|
| E1-1 | Photorealistic 3D globe (Google 3D Tiles, BYOK) + keyless fallback stacks (OSM + Re:Earth terrain) | GEV | Singapore fully covered by Google 3D tiles |
| E1-2 | Layer manager, toggles, per-layer credits/attribution lightbox | GEV | Extended with SG credits |
| E1-3 | Sensor modes (CRT, night vision, FLIR styling) | GEV | |
| E1-4 | Cockpit mode (ride tracked aircraft) | GEV | Works over Changi approaches |
| E1-5 | Annotation engine (routes, boundaries, measurements) | GEV | Basis for plan drawing (E5) |
| E1-6 | Cinematic scene director | GEV | Demo/marketing capture |
| E1-7 | World-stable icons, motion interpolation, label arbiter | GEV | |

### E2 — Global live layers (all GEV, keep as-is)

| ID | Feature | Source | Priority |
|---|---|---|---|
| E2-1 | Flights: OpenSky + adsb.lol fallback, military registry | GEV | P0 |
| E2-2 | Vessels: AISStream live AIS | GEV | P0 — Singapore Strait is the showcase |
| E2-3 | Satellites: CelesTrak TLE + SGP4, ISS passes | GEV | P1 |
| E2-4 | NASA FIRMS fires, USGS earthquakes | GEV | P1 |
| E2-5 | TomTom/OSM traffic (non-SG cities) | GEV | P2 — superseded by LTA inside SG |
| E2-6 | CCTV framework (Austin/Caltrans/TfL packs) | GEV | P0 — framework reused for LTA cameras |
| E2-7 | Radio, rocket launches, submarine cables, dams, datacenters | GEV | P2 — cables layer is relevant (SG is a landing hub) |

### E3 — Singapore data plane (NEW; final API details in §10)

| ID | Feature | Source | Priority | Feed |
|---|---|---|---|---|
| E3-1 | Live road picture: speed bands, incidents, roadworks, VMS, estimated travel times — **as a new source inside GEV's existing `traffic` layer** (§11.5), keeping token `t` | EXTEND | P0 | LTA DataMall via server proxy |
| E3-2 | Traffic cameras **as an LTA adapter + source pack inside GEV's CCTV subsystem** (§11.5) — inherits frustum projection, viewshed, LOD, focus policy, cards, and mesh drape; zero new tokens | EXTEND | P0 | data.gov.sg traffic-images |
| E3-3 | Transit picture: bus arrivals + **live bus positions** (20 s), train service alerts, **MRT station crowd density** (10 min) | NEW | P1 | LTA DataMall |
| E3-3b | Mobility picture: taxi availability (~1 min), carpark availability (1 min, **needs the HDB coordinate join**), EV charging | NEW | P1 | data.gov.sg v1 + LTA |
| E3-4 | Weather picture: rainfall (5 min), wind speed/direction, temperature, humidity, PSI/PM2.5, UV, 2-hr nowcast across 47 named areas | NEW | P0 | data.gov.sg v2 (NEA), keyless |
| E3-4b | **Acute hazards: lightning strike positions (2 min), PUB flood alerts (CAP-style w/ severity, 3 min), WBGT heat stress** | NEW | P0 | data.gov.sg v2 + LTA |
| E3-4c | **Weather radar drape**: georeferenced PNG (5 min, EPSG:4326 bbox) as a Cesium imagery layer | NEW | P1 | data.gov.sg v2 (beta) |
| E3-5 | Foot-traffic proxies — **no live footfall API exists** (§10.4). Ranks 1–4 (station crowd density, bus load, taxi, carpark) render as *live proxies*; ranks 5–6 (monthly passenger volume, census) as *baselines* in a distinct treatment | NEW | P1 | LTA + data.gov.sg |
| E3-6 | Speed / red-light camera locations — **datasets exist but content is 2016–2019 vintage** (§10.5). Ships only with a permanent "as of 2016–2019" badge, or not at all | NEW | P2 | data.gov.sg static |
| E3-7 | Health + response assets: dengue clusters (daily), AEDs, fire stations, CHAS clinics, hospitals (OneMap themes — data.gov.sg has no hospital GeoJSON) | NEW | P1 | data.gov.sg + OneMap |
| E3-8 | Base data: OneMap geocoding + **routing** (§15), building footprints, MRT exits / bus stops, planning-area population | NEW | P1 | OneMap + data.gov.sg static |
| E3-9 | Singapore city pack: `config/cctv_sources.singapore.json` + `CITY_POIS` entry, following GEV's Austin/Shinjuku pack pattern | NEW | P0 | — |

### E4 — Terrain intelligence (PORT from Athena server)

| ID | Feature | Source | Priority | Notes |
|---|---|---|---|---|
| E4-1 | Area select (≤1 km) → battleground generation: DEM mosaic + OSM features + classification | PORT | P0 | Pipeline unchanged; Socket.IO progress kept |
| E4-2 | Ground grid: cover/concealment retired; **mobility, water, slope, exposure, choke** channels kept; binary wire format kept | PORT | P0 | Relabel military semantics to civil ones |
| E4-3 | Heatmap drape (single-texture canvas layer) + hover cell inspector | PORT | P0 | Re-implemented as GEV module |
| E4-4 | Contours / topo view | PORT | P2 | `lib/contours.ts`, `topomap/` |
| E4-5 | Weather-aware ground effects (rain → mobility penalty from NEA live rainfall) | NEW | P2 | Replaces Open-Meteo with NEA inside SG |

### E5 — Incident & planning (PORT + NEW)

| ID | Feature | Source | Priority | Notes |
|---|---|---|---|---|
| E5-1 | Incident model: pin + geofence + clock; all layers rescope/rank to it; timeline log of operator actions and layer events | NEW | P0 | The product's spine |
| E5-2 | Plan drawing: corridors, cordons, rally points, unit markers — on GEV's annotation engine, persisted via Athena plans API | PORT | P0 | Establishment/military symbology retired |
| E5-3 | Plan persistence + briefs (`/api/plans/:id/brief` cell-space derivation) | PORT | P1 | Schema survives minus sim fields |
| E5-4 | Watchlists & geofence alerts (feed event enters geofence → toast + timeline entry) | NEW | P1 | |

### E6 — Routing & validation (deterministic, engine-free)

| ID | Feature | Source | Priority | Notes |
|---|---|---|---|---|
| E6-1 | Route validation against grid: water crossings, slopes, choke widths, ETA at chosen pace | PORT | P0 | `validate.ts` / `movement.ts` logic, server-side |
| E6-2 | Cost-grid routing: server computes best egress/ingress paths (distance-field / Dijkstra over mobility grid), live congestion as a cost modifier | NEW | P1 | The one piece of engine *math* worth re-implementing in TS — no agents, no ticks |
| E6-3 | Ingress/egress deconfliction warnings | NEW | P1 | Geometric overlap check |
| E6-4 | Vehicle vs pedestrian routing profiles | NEW | P1 | Grid channels already distinguish these |

### E7 — Assistant (GEV + PORT merge)

| ID | Feature | Source | Priority | Notes |
|---|---|---|---|---|
| E7-1 | Voice agent (OpenAI Realtime, 28 tools) extended with Athena tools: incident status, layer query, route validation, grid sample | GEV+NEW | P1 | Cost cap UX inherited |
| E7-2 | Text assistant (Athena `assistantAgent`) unified onto the same tool registry | PORT | P2 | One tool registry, two modalities |

### E8 — Fusion, provenance, export

| ID | Feature | Source | Priority | Notes |
|---|---|---|---|---|
| E8-1 | Provenance & staleness: every entity carries source + fetched-at; age chips; degraded-source banners | NEW | P0 | Extends GEV's stats rows |
| E8-2 | Unified incident-scoped entity ranking (distance + recency) | NEW | P1 | |
| E8-3 | Incident brief export (timeline + snapshot + routes + stills) | NEW | P1 | |
| E8-4 | Exercise/live watermark modes | NEW | P0 | Small, load-bearing for responsible use |

### E9 — Platform & ops

| ID | Feature | Source | Priority | Notes |
|---|---|---|---|---|
| E9-1 | `/api/sg/*` server proxy: keys server-side, per-source cache TTLs + daily budget governors (GEV's TomTom governor pattern) | NEW | P0 | |
| E9-2 | Single docker-compose: frontend + server + Postgres | PORT | P0 | Engine services removed |
| E9-3 | QA scripts per layer (GEV's `scripts/qa-*.mjs` culture) for each SG layer | NEW | P1 | |
| E9-4 | `DATA_SOURCES.md` extension: every SG source, license, attribution | NEW | P0 | Singapore Open Data Licence terms |
| E9-5 | No user model in v1; deploy behind own auth; CORS + rate limits kept | PORT | P0 | Same posture as today's README |

## 10. Singapore data catalog

Verified by live-fetching the keyless endpoints, driving data.gov.sg's catalog
search, and reading the **LTA DataMall API User Guide v6.9 (3 Aug 2026)** and
the OneMap docs. Anything unverified is labeled as such.

### 10.0 Headline findings (read these before designing anything)

1. **Three integration surfaces, not one.** Weather/environment/hazard is
   keyless on data.gov.sg; the entire *traffic* picture is on **LTA DataMall**
   (free instant key); geocoding, demographics, and **routing** are on
   **OneMap** (free 3-day token). Only the first is data.gov.sg proper.
2. **Two live base URLs, and the split is not what the docs imply.** Weather and
   environment migrated to `https://api-open.data.gov.sg/v2/real-time/api/`.
   The three transport feeds we need — **traffic images, carpark availability,
   taxi availability — were never migrated** and remain on
   `https://api.data.gov.sg/v1/transport/…`, verified answering today.
3. **Keyless rate limit is 6 requests / 10 seconds**, rising to 12 with a dev
   key and 30 with a production key. This was hit during verification, so it is
   real and binding — it sizes the entire proxy design (§13, §16).
4. **Singapore Open Data Licence permits commercial use** with conspicuous
   attribution and no implied endorsement. This is materially more permissive
   than OpenSky's non-commercial terms and removes SG data from the commercial
   question in §20.
5. **There is no live footfall API anywhere in the Singapore estate**, and no
   current speed-camera data. Both were explicit asks; §10.4 and §10.5 say what
   exists instead, plainly.
6. **Four feeds nobody asked for that are better than what was asked for:**
   lightning strike positions (2 min), PUB flood alerts (2–3 min, CAP-style with
   severity), WBGT heat stress, and **georeferenced weather-radar PNGs (5 min,
   EPSG:4326 bbox) that drape straight onto the globe**.

### 10.1 Real-time, keyless — data.gov.sg

Base v2: `https://api-open.data.gov.sg/v2/real-time/api/` · envelope
`{code, data, errorMsg}`.

| Feed | Endpoint | Cadence | Shape / notes |
|---|---|---|---|
| Rainfall (NEA) | `…/rainfall` | 5 min | ~70 stations w/ lat-lon + readings, mm |
| Air temperature | `…/air-temperature` | ~1 min | station/readings, °C |
| Relative humidity | `…/relative-humidity` | ~1 min | % |
| Wind speed / direction | `…/wind-speed`, `…/wind-direction` | ~1 min | knots / degrees — **drives smoke & hazmat plume reasoning** |
| PSI | `…/psi` | hourly | 5 regions, sub-indices (SO₂, CO, O₃, PM10, PM2.5) |
| PM2.5 | `…/pm25` | hourly | 5 regions, µg/m³ |
| UV index | `…/uv` | hourly (daytime) | |
| 2-hr forecast | `…/two-hr-forecast` | half-hourly | **47 named areas with label locations** — the right granularity for a venue |
| 24-hr forecast | `…/twenty-four-hr-forecast` | several/day | periods × 5 regions |
| 4-day outlook | `…/four-day-outlook` | daily | |
| **Lightning** | `…/weather?api=lightning` | **2 min** | Strike lat/lon + cloud/ground type; empty array when quiet. 200 m–2 km accuracy, 90–95% detection |
| **WBGT heat stress** | `…/weather?api=wbgt` | ~10 min | Station WBGT °C + Low/Moderate/High. Live since Feb 2025 |
| **PUB flood alerts** | `…/weather/flood-alerts` | 2 min | Active flood events only; empty = none |
| **Weather radar** (beta) | `…/weather-radar-images/70km` (also 240/480 km) | 5 min | Presigned PNG (20-min expiry) **plus an EPSG:4326 bounding box** — a drop-in Cesium imagery layer |

Transport feeds still on **v1** (`https://api.data.gov.sg/v1/transport/…`):

| Feed | Cadence | Notes |
|---|---|---|
| **Traffic images** | image 1–5 min | 90 cameras — see §10.3 |
| **Carpark availability** (HDB/LTA/URA) | 1 min | `carpark_number`, lot type C/Y/H, lots available/total. **No coordinates** — join the HDB Carpark Information CSV (SVY21 → WGS84 via OneMap) |
| **Taxi availability** | ~1 min | GeoJSON MultiPoint of every unhired taxi + count |

All v1 transport feeds accept `?date_time=YYYY-MM-DDTHH:MM:SS` for historical
frames — useful for QA fixtures and for replaying an exercise.

### 10.2 LTA DataMall — the traffic backbone (free key, `AccountKey` header)

`https://datamall2.mytransport.sg/ltaodataservice/` · JSON · max 500
records/call, paginate with `?$skip=500` · no published numeric rate limit.

| API | Cadence | What it gives us |
|---|---|---|
| **Traffic Incidents** | **2 min** | Accident / Breakdown / Road Block / Weather / Fire / Diversion, with lat-lon and a timestamped human message |
| **Traffic Speed Bands v4** | 5 min | Per-link `SpeedBand` 1–8 **with start and end coordinates** — draws directly as colored polylines, no map-matching needed. v4 since Jul 2025 (new LinkID scheme) |
| **VMS / EMAS** | 2 min | Gantry sign positions + the live message drivers are being shown |
| Estimated travel times | 5 min | **Expressways only** — arterial ETAs must come from speed bands or OneMap |
| Faulty traffic lights | 2 min | Blackout / flashing amber |
| Road works / openings | 24 h | Planning-cadence layers |
| **Station crowd density (real-time)** | **10 min** | Per station, Low/Moderate/High — 11 lines incl. TEL |
| Station crowd density (forecast) | 24 h | 30-min intervals per station |
| **Bus arrival v3** | **20 s** | Per service: ETA, **live bus lat-lon**, and `Load` (seats available / standing / limited standing) |
| **PUB flood alerts** | **3 min** | CAP-style: severity Extreme→Minor, urgency, `responseType: Avoid`, 24 h auto-expiry. **Richer than the data.gov.sg variant — prefer this one** |
| Train service alerts | ad hoc | Disruption status, affected segments, shuttle info |
| Carpark availability v2 | 1 min | **Includes coordinates**, unlike the data.gov.sg feed |
| Traffic images v2 | 1–5 min | Same cameras, but presigned 15-min links — **use the keyless data.gov.sg variant instead** |
| Passenger volume (4 APIs) | monthly | ZIP of CSV, hourly tap-in/out per stop/station. Previous month by the 10th |
| Bus services / routes / stops | ad hoc | ~5,000 stops with coordinates |
| EV charging points | 5 min | |
| GTFS-RT (train) | ad hoc | Protobuf |

### 10.3 Traffic images — verified

`GET https://api.data.gov.sg/v1/transport/traffic-images`, keyless. Each camera
returns capture `timestamp`, a **stable public image URL** (no signing),
`location{latitude,longitude}`, `camera_id`, and `image_metadata` at
**1920×1080**. **90 cameras** (IDs 1001–9706) covering expressways plus the
Woodlands/Tuas checkpoints.

Two findings that change the implementation:

- **Prefer data.gov.sg over DataMall for this feed.** DataMall's
  `Traffic-Imagesv2` returns presigned links that expire in 15 minutes; the
  keyless variant's URLs are stable and directly usable as Cesium textures.
- **The roster has been structurally thinned — this is not a transient blip.**
  Probing the feed's own `date_time` history pins the change between
  **2026-06-15 (90 cameras)** and **2026-07-01 (8 cameras)**, and every probe
  from July through today returns the same 8. The survivors are Woodlands
  (2701/2702/2704), Tuas (4703/4712/4713) and two more at 1.26 N (4798/4799) —
  **checkpoints only**. Meanwhile `api_info.status` still reads `"healthy"`.
  Upstream self-reporting is therefore not a usable health signal; roster size
  against the documented count is, and it ships as `assessCameraRoster` in
  `server/src/services/sg/sources.ts`.

**This breaks the anchor scenario's T+1 beat as written.** The 90-camera roster
covered the ECP, PIE, and KPE approaches to Kallang; the surviving 8 do not come
near the stadium. Three options, in order of preference:

1. **Test LTA DataMall's `Traffic-Imagesv2` once the account key exists** — it
   may still carry the full 90, in which case the recommendation above inverts
   and DataMall becomes *required* for camera coverage rather than the inferior
   option. This is the first thing to check in M1.
2. Re-anchor the camera beat on Woodlands Checkpoint, which the feed does still
   cover and which is a legitimate emergency-ops scenario in its own right.
3. Ship the camera layer honest-but-thin: 8 cameras, plainly labelled, with the
   degradation banner the code already emits.

Until (1) is answered, **the stadium demo must not promise live camera coverage
of Kallang.**

### 10.4 Foot traffic — the honest answer

**No pedestrian or footfall API exists on data.gov.sg, DataMall, or OneMap.**
Nothing in the Singapore estate counts people on the ground. The proxy stack,
graded:

| Rank | Proxy | Cadence | What it actually tells you |
|---|---|---|---|
| 1 | **MRT station crowd density** | 10 min | The only true crowd signal. Three levels only (L/M/H). Stadium and Kallang stations covered |
| 2 | **Bus arrival `Load`** | 20 s | Freshest signal available; indirect, but a good anomaly detector near an incident |
| 3 | **Taxi availability** | ~1 min | Density and voids around a venue read as demand surges and road closures |
| 4 | **Carpark availability** | 1 min | Kallang-area drawdown is a solid arrival-volume proxy for stadium events |
| 5 | Passenger volume (tap in/out) | **monthly** | Planning baseline: expected crowd curves by hour and day type. Never live |
| 6 | Census 2020 / OneMap popapi | static | Residential density for impact-radius estimates |

**Product rule:** ranks 1–4 render as *live proxies* with their own cadence
chips; ranks 5–6 render as *baselines* in a visually distinct treatment. The
words "live footfall" appear nowhere in the UI. This is exactly the honesty
requirement in §7.3, and it is now a concrete labeling rule rather than an
aspiration.

### 10.5 Speed cameras — datasets exist, but they are stale

Six datasets are published (SPF fixed / mobile / laser / red-light / digital
red-light, plus an LTA MCE-KPE set and a CSV location list). Their platform
timestamps read 2024–2025, but **the content vintage is 2016–2019**, and SPF has
since deployed cameras — average-speed enforcement among them — that these files
do not contain. **No real-time enforcement API exists.**

Decision: ship as a **P2 static layer with a permanent "as of 2016–2019" badge**,
or not at all. It must never be presented as current enforcement truth. This
downgrades E3-6 from "if a dataset exists" to "exists but is indicative only."

### 10.6 OneMap — geocoding, demographics, and **routing**

Free registration; `POST /api/auth/post/getToken` returns a token valid **3
days with no auto-renew** (so the server needs a refresh job — a real
operational detail, not a footnote). Map tiles need no token.

- **Routing:** `GET /api/public/routingsvc/route?start=&end=&routeType=drive|walk|cycle|pt`
  → duration, distance, and an encoded polyline. **This is government-authoritative
  road and pedestrian-network routing, free.** It changes §15 — see there.
- Search / geocode, reverse geocode (≤500 m buffer), SVY21 converters.
- **Themes:** 100+ layers with bbox filtering, including hospitals and dengue
  clusters. This is where hospital locations come from — data.gov.sg has no
  comprehensive hospital GeoJSON.
- **Population query:** 17 endpoints by planning area (age, economic status,
  household size, dwelling type), census 2010/2015/2020 — an easier path to
  demographics than the SingStat CSVs.

### 10.7 Static / baseline datasets — data.gov.sg

Tabular: `data.gov.sg/api/action/datastore_search?resource_id=…`. Files:
`api-open.data.gov.sg/v1/public/api/datasets/{id}/initiate-download` → signed URL.

| Dataset | Format / vintage | Use |
|---|---|---|
| **Dengue clusters (NEA)** | GeoJSON polygons, **refreshed daily** | The one "static" dataset that is nearly live — case size + locality |
| **AED locations (SCDF)** | CSV, Dec 2024 | Directly relevant to stadium medical response |
| **Fire stations (SCDF)** | — | Responder ingress origins |
| CHAS clinics (MOH) | GeoJSON | Nearest-care layer |
| MRT station exits (LTA) | GeoJSON, Oct 2025 | **Egress destination nodes** for the anchor scenario |
| Bus stops (LTA) | GeoJSON | Keyless alternative to DataMall |
| HDB carpark information | CSV, SVY21 | **Required join** to give carpark availability coordinates |
| Master Plan 2019 building layer (URA) | GeoJSON footprints | Base context; MP2025 layers appearing |
| Planning area / subzone boundaries (URA) | GeoJSON | Choropleth admin geometry |
| Census 2020 by planning area (SingStat) | CSV | Population baselines |
| School directory (MOE) | CSV | School-zone notifications |
| Areas with high Aedes population | GeoJSON, ~monthly | Secondary health layer |
| PUB CCTV | XLSX, **locations only, no feed** | Low value — the only non-traffic CCTV dataset |

### 10.8 Gaps that push work back onto GEV's existing layers

| Want | Singapore government status | Resolution |
|---|---|---|
| Live flights | **None.** CAAS publishes monthly movement statistics only | GEV's existing OpenSky + adsb.lol layer (E2-1) already covers it |
| Live vessels | **At risk.** MPA's SG-MDH Vessel Positions API (3-min) closed registration 24 Jul 2025 pending platform migration; the domain did not resolve during verification | GEV's AISStream layer (E2-2) already covers it. Treat SG-MDH as UNVERIFIED; contact MPA before depending on it |
| Public CCTV beyond traffic | Only the 90 LTA cameras | Accept; §10.3 |
| Live footfall | None | §10.4 proxy stack |
| Current speed cameras | None | §10.5 stale static layer |

The pleasing consequence: **the two domains Singapore does not publish are
exactly the two GEV already solves.** Air and sea come from the base repo; land,
weather, and crowd come from Singapore. That is the clean seam this pivot needed.

### 10.9 Ranked integration order

**Wave 1 (P0, the anchor demo):** LTA traffic incidents · speed bands v4 ·
traffic images (keyless) · OneMap routing · rainfall + wind + 2-hr forecast ·
lightning · PUB flood alerts (DataMall variant).

**Wave 2 (P1):** station crowd density · bus arrival v3 · weather radar drape ·
VMS/EMAS · carpark + taxi availability · dengue clusters · AED/fire-station/MRT-exit
assets.

**Wave 3 (P2):** passenger-volume baselines · census demographics · building
footprints · schools · speed cameras (badged stale) · EV charging.

### 10.10 Layer and share-token allocation

Resolving §11.3's budget against the real catalog. Cameras and road conditions
attach to GEV's existing `cctv` and `traffic` layers (§11.5) and cost nothing.
Eleven new layers, each fusing related feeds behind option chips:

| Layer id | Token | Disposition | Feeds |
|---|---|---|---|
| `sg-weather` | `h` | `enabled+options` | rainfall, temp, humidity, wind, PSI, PM2.5, UV, forecasts |
| `sg-radar` | `n` | `enabled-only` | georeferenced radar PNG drape |
| `sg-hazard` | `z` | `enabled+options` | lightning, flood alerts, WBGT |
| `sg-transit` | `v` | `enabled+options` | bus arrivals + positions, train alerts, station crowd density |
| `sg-mobility` | `y` | `enabled+options` | taxi, carpark, EV charging |
| `sg-health` | `k` | `enabled+options` | dengue clusters, AEDs, clinics |
| `sg-response` | `l` | `enabled+options` | fire stations, hospitals (OneMap themes), MRT exits |
| `sg-baseline` | `p` | `enabled+options` | planning areas, population, footprints, schools, passenger-volume baselines |
| `sg-enforcement` | `j` | `enabled-only` | speed / red-light cameras (badged stale) |
| `athena-grid` | `o` | `enabled+options` | terrain grid heatmap drape |
| `athena-incident` | `0` | `enabled-only` | incident pin, geofence, drawn plan overlay |

**11 of 20 free tokens used; 9 spare** (digits `1`–`9`). The share codec stays at
v2 and upstream `layerState.js` merges remain trivial.

## 11. GEV integration contract (verified against upstream `HEAD`)

GEV is the source of truth, so "integration" means writing to *its* interfaces.
These were read out of the upstream code, not assumed.

### 15.1 The layer module interface

Every data layer is a plain object default-exported from `src/data/<name>.js`.
`DataLayerManager` (`src/data/manager.js`) drives this lifecycle:

| Member | Required | Contract |
|---|---|---|
| `id` | ✅ | Stable unique string, `/^[a-z0-9-]+$/`. Duplicate ids throw at registration. |
| `name`, `icon` | ✅ | Toggle-panel row label and glyph. |
| `refreshInterval` | — | Milliseconds; manager arms and owns the poll timer. Layer never sets its own interval. |
| `init(viewer, {signal})` | ✅ | One-time setup; awaited. |
| `enable(viewer, {signal})` | ✅ | Returns `!== false` on success. |
| `disable(viewer, {signal})` | ✅ | Returns `!== false` to confirm cleanup. |
| `update(viewer, {signal})` | ✅ | One poll tick. Must honor the `AbortSignal`. |
| `destroy(viewer)` | ✅ | Full teardown. |
| `getStats()` | ✅ | `{ count, lastUpdate, error }` — drives the row's feed-state chip (`feed-*`, `OFF`, `UNCERTAIN`). **This is how E8-1 staleness is surfaced for free.** |
| `setParams()` / `getParams()` | — | Per-layer option chips (needed for dispositions with options). |
| `getAnalystRecords(max)` | — | Returns JSON-safe records for the voice/analyst query engine. **Required for E7-1** — a layer without it is invisible to the assistant. |
| `attachDataManager(mgr)` | — | For cross-layer awareness (as `militaryAwareness` does). |

**Implication for the SG plane:** each SG layer is one new file implementing
this object, and each must implement `getStats()` honestly and
`getAnalystRecords()` if the assistant should be able to reason about it. Our
age-chip/provenance requirement (E8-1) rides GEV's existing feed-state
machinery rather than inventing a parallel one.

### 15.2 Registration is sealed and double-booked

`src/main.js` registers every layer then calls
`dataManager.finalizeRegistrations(LAYER_STATE_REGISTRY)`. That call **throws on
any mismatch** between registered layer ids and the serialization registry in
`src/data/layerState.js`. So every new layer requires **two** upstream-file
edits, not one:

1. `src/main.js` — an import plus a `dataManager.register(...)` line.
2. `src/data/layerState.js` — a `LAYER_STATE_REGISTRY` entry:
   `{ id, token, disposition }`, where `disposition` ∈ `enabled-only` |
   `enabled+options` | `enabled+mirrored-options`.

Both are append-to-a-list edits, so upstream merges conflict only line-locally.
This is the *entire* upstream footprint of the SG data plane — everything else
is new files.

### 15.3 ⚠️ The share-token budget is the binding constraint

`layerState.js` validates `token` against `/^[a-z0-9]$/` — a **single**
alphanumeric character, and duplicates throw. The namespace is therefore **36
tokens, of which 16 are taken** (`a b c d e f g i m q r s t u w x`).

**20 tokens remain.** Our Singapore pack (E3-1…E3-8) plus Athena's own
toggleable surfaces (grid heatmaps, plan overlay, incident geofence) is
projected at 13–16 layers. It fits — with ~4 slots of headroom, not 20.

**Resolved in §10.10:** fusing related feeds behind option chips
(`enabled+options`) fits the whole Singapore pack plus Athena's own overlays into
**11 tokens, leaving 9 spare**. The codec stays at v2, share links keep working,
and `layerState.js` remains a clean append. The alternative — bumping
`LAYER_STATE_VERSION` to 3 for multi-char tokens — would break existing share
links and diverge from upstream at a file we want to merge mechanically, so it
is explicitly rejected.

### 15.4 Other inherited mechanics worth designing to

- **Render governor** (`src/renderGovernor.js`): the scene sits in
  `requestRenderMode` unless a module holds it continuous. Any SG layer that
  animates per-frame must take an explicit hold — otherwise it silently won't
  repaint. The earthquakes layer's comment records a measured 32.4 ms → 1.4 ms
  frame-cost win from making ellipse axes static rather than per-frame
  callbacks; **our heatmap drape and camera billboards must follow that rule.**
- **`registerDataCredits(viewer)`** (`src/data/dataCredits.js`): the licensed
  path for attribution. Singapore Open Data Licence and LTA credits register
  here, verbatim from `DATA_SOURCES.md` (E9-4).
- **Google 3D Tiles content may not be cached or stored** — live use only.
  Unchanged for us.
- **QA-script culture** (`scripts/qa-*.mjs`, Puppeteer): ~40 upstream scripts.
  E9-3 means one per SG layer, in the same idiom.

### 11.5 Attach SG feeds to existing GEV subsystems, don't parallel them

The strongest reading of "GEV is the source of truth" is that most SG feeds are
**new sources for subsystems GEV already has**, not new layers. Verified
extension points:

**Traffic cameras → GEV's CCTV subsystem (not a new layer).** `src/data/cctv.js`
is ~198 KB and ships a whole camera-projection stack around it:
`cctvViewshed.js`, `cctvLod.js`, `cctvFocusPolicy.js`, `cctvFocusRequest.js`,
`cctvCards.js`, `cctvGizmo.js`, `meshFloorSampler.js`. Cameras carry
`{ id, name, cityId, provider, sourceKind, feedType, url, lat, lon, headingDeg,
pitchDeg, fovDeg, rangeM, mountHeightM, groundElevationM, license }`, and the
documented env seams are:

```
CCTV_SOURCES_FILE=config/cctv_sources.austin.json   # source-pack JSON
CCTV_SOURCES_JSON=                                  # inline override
CCTV_AUSTIN_ROWS_URL=                               # per-city catalog URL
CCTV_AUSTIN_MAX_SOURCES / CCTV_MAX_SOURCES          # caps
CCTV_AUTO_CALIBRATE=1  CCTV_DRAPE_MESH=1            # projection + mesh drape
```

So Singapore's traffic cameras ship as `config/cctv_sources.singapore.json`
plus an LTA catalog adapter written in the Austin/Caltrans/TfL pattern (runtime
catalog fetch + per-poll frame URLs). **We inherit frustum projection, viewshed,
LOD, focus policy, camera cards, and — via `CCTV_DRAPE_MESH` — frames draped
onto the actual 3D geometry.** For the anchor demo that means live LTA frames
projected onto Kallang's real buildings, for the cost of an adapter. This is the
single highest-leverage integration in the plan, and it costs **zero** new share
tokens.

**Road conditions → GEV's traffic layer (not a new layer).** `src/data/traffic.js`
(~103 KB) already abstracts over TomTom flow vector tiles, OSM road geometry
(`flowTiles.js`, `flowMatch.js`, `trafficBounds.js`, `trafficQueue.js`,
`trafficFlowStyle.js`, `trafficPresetStyle.js`) with a built-in simulation
fallback when no key is present. LTA speed bands are per-road-segment rather
than vector tiles, so this needs a real provider abstraction — but adding LTA as
a *source* behind the existing layer keeps token `t`, keeps the styling presets,
and means the layer is simply better inside Singapore than outside it.

**Fires/hazard → FIRMS pattern; quakes → USGS pattern.** SG hazard feeds
(dengue clusters, PSI) follow the `local-firms` precedent: a bounded, cached,
server-proxied feed rendered as ground discs with static axes.

**Net effect on §11.3's token budget:** cameras and road conditions — the two
heaviest SG feeds — consume **no new tokens**. That leaves the ~20 free slots
for genuinely new layer kinds (weather stations, transit, carparks/taxis,
incidents, dengue, terrain grid, plan overlay, incident geofence), which fits
comfortably and removes the pressure toward a share-codec v3.

## 12. Athena salvage inventory (file-level)

Verified against the working tree. **PORT** = logic moves as-is or nearly;
**REWRITE** = concept survives, code is re-authored to GEV's vanilla-JS idiom;
**DROP** = deleted.

### 16.1 Server — `server/src/` (mostly survives intact)

| File | LoC | Fate | Notes |
|---|---|---|---|
| `services/pipeline.ts` | 190 | **PORT** | Battleground orchestration + Socket.IO progress emits. Drop the `military` stage label; keep the stage machinery. |
| `services/dem.ts` | 134 | **PORT** | AWS terrain tiles, mosaic, bilinear sample. Unchanged. |
| `services/osm.ts` | 186 | **PORT** | Overpass with 4 mirrors. Unchanged. |
| `services/classify.ts` | 300 | **REWRITE (partial)** | Keep slope/landcover/water/road classification and `moveCost`, `vehicleMobility`, `visibility`. **Retire `cover`, `concealment`, `ambush`** — combat semantics with no civil meaning. Replaces them with `chokeWidth` and `crowdCapacity` (see §14). |
| `services/grid.ts` | 77 | **PORT (bump version)** | Binary wire format (`ATHG` magic, 16-byte header, f32 heights + 8×u8 channels). Channel list changes → `GRID_VERSION` 1 → 2. |
| `services/landcover.ts` / `segment.ts` / `satellite.ts` | 565 | **PORT** | Land-cover sampling and segmentation. |
| `services/weather.ts` / `forecast.ts` | 154 | **REWRITE** | Open-Meteo stays as global fallback; **inside Singapore, NEA feeds take precedence** (E3-4, E4-5). |
| `services/planBrief.ts` | 389 | **PORT** | The cell-space derivation (drawing → grid cells + ground properties) is exactly what route validation needs. Strip establishment/ORBAT vocabulary. |
| `services/battlegroundStore.ts` | 70 | **PORT** | LRU + persistence. |
| `lib/cells.ts` | 141 | **PORT** | `rasterizePolyline`, `cellsWithinRadius`, `distanceMeters` — the geometric core of corridor validation. Zero changes needed. |
| `lib/tiles.ts`, `lib/geo.ts`, `lib/enu.ts`, `lib/lru.ts` | 216 | **PORT** | Pure utilities. |
| `routes/plans.ts` | 278 | **PORT** | Plan CRUD + brief. Remove `/simulate`. |
| `services/assistantAgent.ts` | 299 | **REWRITE** | Merges into GEV's voice tool registry (E7-2). |
| `routes/assistant.ts` | 70 | **REWRITE** | Same. |
| `routes/splats.ts` | 65 | **DROP** | Gaussian-splat experiment; out of scope. |
| `routes/simulations.ts` | 639 | **DROP** | Engine broker. |
| `services/simulationPayload.ts` | 294 | **DROP** | Engine payload projection. |
| `services/replaySummary.ts` | 100 | **DROP** | Replay scoring fallback. |
| `db/schema.ts` | 79 | **EDIT** | Keep `battlegrounds`, `plans`. Drop `simulation_batches`. Add `incidents` (§14). |

Server verdict: **~2,400 LoC ported nearly free; ~1,100 LoC deleted.** The
terrain pipeline is the single most valuable thing Athena contributes and it
carries almost no engine coupling.

### 16.2 Frontend — `frontend/src/` (logic ports, React shell retires)

GEV as source of truth means the React/resium app is not the shell. But the
valuable parts are framework-free TypeScript:

| File | LoC | Fate | Notes |
|---|---|---|---|
| `lib/grid.ts` | 296 | **PORT** | `decodeGrid`, `sampleCell`, `renderHeatmapCanvas`, `renderGridLinesCanvas`. Pure canvas + typed arrays, no React. Drops straight into a GEV module (E4-3). |
| `lib/validate.ts` | 188 | **PORT** | `analyzeRoute` / `analyzePlan` → warnings (`steep`, `water`, `exposed`, `slow`) with severities. **This is E6-1 already written.** |
| `lib/movement.ts` | 214 | **PORT** | `slopeSpeedFactor`, `pandolfWatts` (metabolic cost of load carriage), `weatherFactors`, `estimateMovement`. Repurposed from soldier pace to **crowd egress and responder-on-foot timing** — the physics is identical. |
| `lib/contours.ts` | 177 | **PORT** | E4-4. |
| `lib/selectionGeometry.ts` | 86 | **PORT** | Drag-select rectangle math (E4-1). |
| `lib/coords.ts`, `simplify.ts`, `bearing.ts`, `enuOffset.ts`, `clipping.ts`, `pickTerrain.ts` | ~250 | **PORT** | Pure geometry utilities. |
| `lib/intel.ts` | 262 | **REWRITE** | Terrain-inspector readout → GEV HUD idiom. |
| `lib/recommendations.ts` | 199 | **REWRITE** | Plan critique text, decoupled from sim outcomes. |
| `lib/frameGovernor.ts` | 72 | **DROP** | GEV's own `renderGovernor.js` supersedes it (§11.4). |
| `lib/entitySync.ts`, `photoTiles.ts`, `photoHeights.ts`, `topoProjection.ts` | ~380 | **DROP** | GEV's map-stack controller and tile handling supersede. |
| `lib/tacticalSymbols.ts`, `tacticalGeometry.ts`, `markerIcons.ts`, `establishment.ts`, `unitHandle.ts`, `planSort.ts`, `movementStyle.ts` | ~450 | **DROP** | Military symbology / ORBAT. Replaced by civil incident iconography (E5-2). |
| `lib/soldierSprite.ts`, `treeSprite.ts`, `replayGeo.ts`, `simulationStream.ts`, `splats.ts` | ~700 | **DROP** | Engine-coupled rendering. |
| `state/plan.ts`, `battleground.ts`, `mission.ts`, `settings.ts`, `persistence.ts` | ~750 | **REWRITE** | zustand stores → GEV's module-local state + `layerState` serialization. |
| `state/simulation.ts`, `playback.ts`, `orbat.ts`, `photo.ts` | ~400 | **DROP** | |
| `components/**` (38 files) | — | **DROP as components** | Concepts re-expressed in GEV's UI. Terrain/heatmap/plan panels rebuilt in `src/ui.js` idiom; every `Replay*`/`Simulation*`/`Engine*`/`Reasoning*`/`Playback*` panel is deleted outright. |
| `types/replay.ts` | 159 | **DROP** | |

Frontend verdict: **~1,500 LoC of genuinely portable logic**, ~2,500 LoC
dropped, and the React shell retired in favor of GEV's.

### 16.3 Infrastructure

| Item | Fate |
|---|---|
| `engine/` (entire Python tree: `loop`, `agent`, `resolvers`, `world_state`, `models`, `hosted`, `replay`, `params`, tests) | **DROP** |
| docker services `redis`, `minio`, `minio-init`, `engine-api`, `engine-worker` | **DROP** |
| docker volumes `minio-data` | **DROP** |
| `ENGINE_CHANGES.md`, `engine/ENGINE.md` | **DROP** (archive in git history) |
| `docker-compose.yml` | **EDIT** → 3 services: `frontend`, `server`, `postgres` |
| `.env.docker.example` | **EDIT** → remove `OPENROUTER_API_KEY`, S3/Redis; add `LTA_ACCOUNT_KEY`, `GOOGLE_MAPS_API_KEY`, `CESIUM_ION_TOKEN`, `ONEMAP_*` |

## 13. Server API surface (new + changed)

All third-party keys stay server-side (§16). Every SG route follows GEV's
proxy pattern: server-side fetch, TTL cache, daily budget governor, stale-serve
on upstream failure, and a `provenance` envelope the client renders as age chips.

```
GET  /api/sg/:feed                 → { data, provenance }
     provenance: { source, fetchedAt, upstreamAt, ageMs, state:
                   'live'|'cached'|'stale'|'degraded'|'unavailable',
                   attribution, license }
```

Concrete routes are finalized in §10 once the API research lands. Shape is
uniform so one client-side adapter serves every SG layer.

| Route | Method | Purpose | Change |
|---|---|---|---|
| `/api/battleground` | POST | Start terrain pipeline over a bbox | kept |
| `/api/battleground/:id/{meta,grid}` | GET | Metadata + binary grid | kept |
| `/api/plans`, `/api/plans/:id` | CRUD | Plan persistence | kept |
| `/api/plans/:id/brief` | GET | Cell-space derivation of drawings | kept |
| `/api/plans/:id/simulate` | POST | — | **removed** |
| `/api/simulations/**` | — | — | **removed** |
| `/api/incidents`, `/api/incidents/:id` | CRUD | Incident + geofence + timeline (E5-1) | **new** |
| `/api/incidents/:id/timeline` | POST/GET | Append/read timeline entries | **new** |
| `/api/incidents/:id/brief` | GET | Export bundle (E8-3) | **new** |
| `/api/route/solve` | POST | Cost-grid routing (E6-2) | **new** |
| `/api/route/validate` | POST | Warnings + metrics for a drawn route (E6-1) | **new** |
| `/api/sg/*` | GET | Singapore feed proxies (E3-*) | **new** |

## 14. Data model changes

**Grid channels** (`GRID_VERSION` 2) — combat semantics retired for civil ones:

| v1 channel | v2 | Rationale |
|---|---|---|
| `height` (f32) | unchanged | |
| `cls` | unchanged | Terrain class enum; `Trench` class dropped |
| `slope` | unchanged | |
| `moveCost` | unchanged | Pedestrian/vehicle traversal cost — the routing core |
| `vehicleMobility` | unchanged | Responder-vehicle access |
| `visibility` | unchanged | Sightlines — now for camera coverage and crowd wayfinding |
| `cover` | **→ `chokeWidth`** | Traversable width at a cell; the single most useful egress metric |
| `concealment` | **→ `crowdCapacity`** | Persons/m² the surface can hold at safe density |
| `ambush` | **→ `hazardProximity`** | Distance-decay from water, drop-offs, and live hazard feeds |

**New table `incidents`:**

```
incidents(
  id, name, kind,                    -- 'exercise' | 'live' (E8-4 watermark)
  centroid_lon, centroid_lat, radius_m,
  declared_at, closed_at,
  battleground_id → battlegrounds,   -- optional terrain grid
  plan_id → plans,                   -- optional drawn plan
  timeline jsonb,                    -- ordered operator actions + feed events
  created_at, updated_at
)
```

`plans` keeps its schema minus simulation fields; `simulation_batches` is
dropped.

## 15. Routing service (E6-2) — the one piece of engine math worth keeping

Not a simulation: a deterministic, single-shot solve. No ticks, no agents, no
randomness, no LLM.

**Division of labour with OneMap (§10.6).** OneMap ships free, government-authoritative
routing over Singapore's real road and pedestrian networks (`drive` / `walk` /
`cycle` / `pt`). We do not compete with it — we use it, and we solve the part it
cannot:

| Question | Solver | Why |
|---|---|---|
| "Ambulance from Kallang Fire Station to Gate C" | **OneMap `drive`**, re-costed by live speed bands | Authoritative road network, turn restrictions, and it is free |
| "Crowd from Gate C to Stadium MRT along the footpath network" | **OneMap `walk`** | Real pedestrian network |
| "20,000 people across the concourse, the park, and the riverbank — where do they actually flow, and where does it pinch?" | **Athena cost grid** | No road network exists over open ground. This is the gap, and it is exactly what the terrain grid was built for |
| "Is this drawn corridor survivable?" | **Athena validation** (§E6-1) | Water, slope, choke width, capacity — properties of ground, not of edges |

So the cost-grid solver is scoped to **off-network open-ground movement and
capacity analysis**, with OneMap handling everything that follows a mapped way.
That is a smaller, more defensible piece of code than a general router, and it
keeps us honest: we never claim better road routing than the national mapping
agency.

- **Input:** grid id, start/goal (or gate set → rally-point set), profile
  (`pedestrian-crowd` | `pedestrian-responder` | `vehicle-emergency`), and
  optional live-congestion overlay.
- **Cost function:** `moveCost` × profile weights, `chokeWidth` as a capacity
  penalty, `slope` via the ported `slopeSpeedFactor`, impassable on water and
  `hazardProximity` above threshold, plus a live-traffic multiplier on
  road-class cells from the SG speed-band feed (E3-1).
- **Algorithm:** Dijkstra / A* over the cost grid — with a multi-source
  distance field when solving many gates to many rally points at once. Athena's
  engine already proved the distance-field approach works on this grid; it is
  ~200 lines of TypeScript without the engine around it.
- **Output:** polyline in cell space and lon/lat, ETA per profile via the ported
  `estimateMovement`/`pandolfWatts`, plus the same `PlanWarning[]` shape
  `validate.ts` already emits — so drawn routes and solved routes render
  identically.
- **Determinism:** same grid + same inputs + same congestion snapshot ⇒ same
  path. Congestion snapshot id is recorded in the timeline so a result is
  reproducible after the fact.

## 16. Non-functional requirements

- **Performance:** globe interactive at 30 fps+ with 5 SG layers + AIS + flights
  active on an M-class laptop; layer updates never block the render loop; SG
  proxy responses cached so a refresh storm never hits upstream quotas.
- **Quota safety — sized against verified limits.** data.gov.sg enforces
  **6 requests / 10 s keyless, 12 with a dev key, 30 with a production key**
  (hit during verification, so it is real). With ~14 distinct SG feeds on
  cadences from 20 s to hourly, a naive client would blow the keyless budget
  immediately. The proxy therefore **owns all polling**: one server-side
  scheduler per feed at the feed's own cadence, results fanned out to every
  connected client from cache. Browser layer `update()` calls read our cache
  and never reach upstream. LTA DataMall publishes no numeric limit but caps
  responses at 500 records — speed bands need ~10+ paginated calls per 5-minute
  cycle, so that sweep is scheduled, not on-demand.
- **Token lifecycle:** OneMap tokens expire in **3 days with no auto-renew** —
  the server needs a refresh job with alerting, not a startup-time fetch.
- **Security:** all keys server-side only (LTA account key, any data.gov.sg
  keys); browser receives only Google/Cesium tokens exactly as GEV does today;
  GEV `SECURITY.md` posture inherited.
- **Licensing:** the **Singapore Open Data Licence permits commercial use**
  with conspicuous attribution and no implied endorsement — so the entire SG
  data plane is commercially clean, and one footer crediting LTA / NEA / PUB /
  SCDF / URA / SingStat / SLA satisfies it. The commercial question in §20 now
  applies only to *inherited* GEV sources (OpenSky non-commercial, TeleGeography
  NC, Google News), not to anything Singapore-specific.
- **Honesty:** no layer may present data older than 2× its cadence without an
  age chip; monthly datasets are always labeled as baselines.

## 17. Migration plan

| Phase | Scope | Exit criteria |
|---|---|---|
| **M0 — Fork & strip** (week 1) | Fork GEV; delete Athena `engine/` + all sim surfaces (file list in §8); compose down to 3 services. **Register the three free accounts (§20.4) on day one** — they gate everything after | GEV runs locally; Athena server boots engine-free; all remaining tests green |
| **M1 — SG data plane, Wave 1** (weeks 2–4) | `/api/sg/*` **polling** proxy (server owns cadence, §16) + Wave 1 feeds (§10.9): LTA incidents, speed bands v4 into GEV's `traffic` layer, traffic images via the CCTV adapter + `cctv_sources.singapore.json`, OneMap routing, rainfall/wind/nowcast, lightning, flood alerts. Attribution + age chips + degradation banners | Stadium neighborhood shows live SG data in the GEV shell; a deliberate upstream outage renders as a banner, not a blank layer |
| **M2 — Terrain port** (weeks 4–7) | Battleground pipeline wired to GEV UI: area select, grid gen, heatmap drape, hover inspector | Grid over Sports Hub rendered in GEV with civil-labeled channels |
| **M3 — Incident & planning** (weeks 7–10) | Incident model, plan drawing on annotation engine, route validation, deconfliction | Anchor scenario T+0..T+7 fully demoable |
| **M4 — Assistant + export** (weeks 10–12) | Voice/text tools over fused data (every SG layer implements `getAnalystRecords()`, §11.1); brief export; watchlists; Wave 2/3 feeds backfilled | Anchor scenario end-to-end incl. T+8..T+9; launch content captured |

## 18. Success metrics

- Anchor-scenario demo runs end-to-end on keyless mode + one LTA key.
- Time-to-first-picture (clone → globe with SG layers) under 10 minutes.
- ≥ 12 SG sources integrated with verified cadence + attribution.
- Zero silent-stale incidents in QA (every degraded source shows its banner).
- Upstream GEV merges remain possible (additions isolated to new files + registration diffs).

## 19. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **data.gov.sg 6-req/10 s keyless limit** throttles a multi-layer console | High | Server owns all polling on per-feed schedules; clients read cache only (§16). Register a production key (30/10 s) — §20.4 |
| **Traffic-image roster cut from 90 to 8** (checkpoints only) between mid-June and July 2026, while the feed still self-reports "healthy" | **High** | Implemented: `assessCameraRoster` marks the feed degraded against the documented roster and the banner states the real count. **Open:** verify whether DataMall still serves 90 — if so the keyless recommendation inverts. The Kallang camera beat cannot be promised until then |
| **MPA vessel API (SG-MDH) registration closed** pending migration; domain did not resolve | Medium | Not a dependency — GEV's AISStream layer already covers vessels (§10.8). Do not design around SG-MDH until MPA confirms |
| **Speed-camera data is 2016–2019 vintage** | Medium | P2 layer with a permanent staleness badge, or cut. Never presented as current enforcement (§10.5) |
| **No live footfall API exists** | Medium | Graded proxy stack with live-vs-baseline visual separation; the phrase "live footfall" is banned from the UI (§10.4) |
| **OneMap 3-day token, no auto-renew** | Medium | Server-side refresh job with alerting; a missed refresh silently kills routing and geocoding |
| Carpark availability ships **without coordinates** | Low | Mandatory join to HDB Carpark Information CSV + SVY21→WGS84 conversion; a build-time asset, not a runtime lookup |
| Upstream GEV drift vs our fork | Medium | New-files-only discipline; the only shared-file edits are two append-to-list registries (§11.2); merges scheduled per phase |
| Vanilla-JS port of React terrain UI costs more than expected | Medium | Port logic (framework-free TS) first; UI rebuilt to GEV idiom, not translated |
| Weather-radar API is **beta** | Low | Schema may shift; isolate behind the proxy so a break is one adapter, not a layer |
| Google 3D Tiles cost | Low | Keyless stack fallback is first-class, as in GEV |
| "Emergency" framing overreach | High | Exercise watermark default, disclaimers, provenance engineering (E8) |

## 20. Open questions

Narrowed by the data research — SG licensing is no longer in question.

1. **Commercial intent?** Now scoped to *inherited GEV sources only*: OpenSky
   (non-commercial), TeleGeography submarine cables (CC BY-NC-SA — one folder to
   delete), Google News RSS. All Singapore data is commercially clean under the
   Singapore Open Data Licence. A "yes" costs one folder and two layer sources,
   not a redesign.
2. **Repo strategy:** fresh fork named `athena`, or GEV fork with the Athena
   server imported as a subdirectory? *Recommended: the latter* — one repo, GEV
   history preserved, upstream merges stay mechanical.
3. **Keep the name "Athena"?** It reads military, and the product no longer is.
4. **Register three free accounts now** to unblock M1 — they gate real work and
   all are free/instant: (a) **LTA DataMall** `AccountKey`, (b) **data.gov.sg
   production API key** (lifts 6→30 req/10 s), (c) **OneMap** account. *This is
   the only decision blocking Wave 1.*
5. Does v1 need multi-operator plan persistence, or single-operator local only?
6. **Ship the enforcement-camera layer at all?** It is 2016–2019 data. Including
   it invites exactly the "presented as current" failure §7.3 exists to prevent.
   *Recommendation: cut from v1.*

## 21. Implementation status

Branch `feat/gods-eye-singapore`. M1 Wave 1 has begun with the Singapore data
plane, built server-first because the 6-req/10-s ceiling makes the proxy the
load-bearing piece — every layer decision downstream depends on it existing.

**Shipped and verified against live endpoints:**

| Component | File | What it does |
|---|---|---|
| Quota governor | `server/src/services/sg/budget.ts` | Sliding-window budget per upstream host. Refreshes **queue rather than fail**, because a feed refresh is never urgent to the millisecond but a 429 costs the next one too |
| Feed registry | `server/src/services/sg/feed.ts` | TTL cache, single-flight coalescing, stale-serve within `sgMaxStaleMs`, and the provenance envelope. Ten clients on a cold cache produce one upstream request |
| Feed definitions | `server/src/services/sg/sources.ts` | 11 Wave-1 feeds. One parser serves all five NEA station feeds; readings are joined to stations server-side so no browser layer repeats that join |
| HTTP surface | `server/src/routes/sg.ts` | `GET /api/sg/feeds`, `GET /api/sg/:feed` |
| Config | `server/src/config.ts` | `ltaAccountKey`, `sgRequestLimit/WindowMs`, `sgMaxStaleMs`, `sgCameraRoster`, `sgCameraDegradedRatio` |
| Tests | `server/test/sg{Budget,Feed,Sources}.test.ts` | 31 tests, 117 assertions, all passing; `tsc --noEmit` clean |

**Live end-to-end result** (all eight keyless feeds, through the real route):

```
rainfall          live        88 stations
wind-direction    live        17 stations
two-hr-forecast   live        47 areas
lightning         live         0 events     ← quiet is normal, NOT degraded
flood-alerts      live         0 events     ← quiet is normal, NOT degraded
traffic-images    degraded     8 cameras    ← "8 of ~90 documented cameras…"
taxi-availability live      2000 events
traffic-incidents unavailable  —            ← "LTA_ACCOUNT_KEY is not set — …"
```

Second pass returns `cached` in under 1 ms with no upstream traffic, which is
the property the whole quota design rests on.

Three design rules fell out of building it, and they are now enforced by tests:

1. **An empty hazard feed is healthy, not degraded.** Lightning and flood alerts
   are empty most of the time. Only feeds with a documented expected size get an
   `assess` function; hazard feeds deliberately have none.
2. **`degraded` outranks freshness in `state`**, because a thinned payload is
   more actionable than its age — but `ageMs` is still reported, so the
   precedence hides nothing.
3. **A parse failure is a failed fetch**, never a poisoned cache. The previous
   good value survives and is served as `stale`.

**Not yet started:** the M0 strip (see §12 — the working tree still carries
uncommitted simulation work), GEV vendoring, and every browser-side layer module.
