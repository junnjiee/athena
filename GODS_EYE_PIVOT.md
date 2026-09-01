# Athena: God's Eye — Pivot Plan

**Date:** 2026-08-26 · **Status:** Proposal, no code written
**Base:** [bilawalsidhu/gods-eye-view](https://github.com/bilawalsidhu/gods-eye-view) (4.7k★, MIT code, active as of today)
**Salvage source:** this repo (Athena — terrain intelligence + Monte Carlo battle simulation)

---

## 1. The one-line concept

> **Every open-data globe on the internet watches the world. Athena is the one that helps you decide what to do about it.**

God's Eye View (GEV) is the best open-source *perception* layer that exists: live aircraft,
ships, satellites, fires, quakes, traffic, CCTV on a photorealistic globe. But it is
watch-only — it renders the world and stops. Athena's crown jewels are exactly the parts
GEV doesn't have: a terrain-intelligence pipeline that turns real ground into a machine-readable
mobility grid, a route validator, and a seeded Monte Carlo agent simulation engine with
LLM-driven decision-makers, replays, and ranked plan recommendations.

The pivot fuses them into a three-stage loop no open-source tool currently closes:

```
SENSE  (GEV's live layers, expanded)
  → DECIDE  (Athena's terrain grid + routing + plan drawing, re-aimed at incidents)
    → REHEARSE  (Athena's Monte Carlo engine, re-aimed at crowds and response)
```

Anchor demo: a mass-casualty emergency at a stadium. The operator sees everything around
the venue live — traffic, air, transit, cameras, weather — draws evacuation and responder
routes on real terrain, and *stress-tests the plan with 500 simulated runs before anyone
follows it*.

---

## 2. Why this stands out

The "how do we not become fork #1,201 of a flight tracker" question, answered directly.

### 2.1 Category creation: the only open-source sense→decide→rehearse loop

| Product | Sense | Decide | Rehearse | Open source |
|---|---|---|---|---|
| FlightRadar24 / ADSBexchange / MarineTraffic | one domain | ✗ | ✗ | ✗ (ADSBx data yes) |
| GEV | ✔ all-domain | annotations only | ✗ | ✔ |
| ArcGIS Emergency Management | ✔ (paid data) | ✔ | partial (paid ext.) | ✗ |
| Palantir Gotham | ✔ | ✔ | ✔ | ✗, and unobtainable |
| **Athena (pivoted)** | ✔ all-domain, open | ✔ terrain-aware | ✔ Monte Carlo + LLM agents | ✔ |

The empty cell we occupy: nobody open-source connects live open data to terrain-aware
planning to agent simulation. Palantir and ESRI sell that loop to governments for millions.
We ship the honest, inspectable, run-it-on-your-laptop version.

### 2.2 The demo *is* the marketing

GEV got 4.7k stars substantially off 17 GIFs. Our GIFs show something no other globe can:
a drawn evacuation route turning red because 500 simulated crowds jammed at the same
pedestrian bridge, then the tool suggesting the fix, then the fix simulating green.
"The globe that argues with your plan" is inherently shareable.

### 2.3 The adoption wedge: exercise mode

GEV's README (correctly) says *do not use for emergency response*. We don't delete that
sentence — we build around it. v1 ships as an **exercise and planning tool**: tabletop
exercises, pre-event planning, after-action review. Emergency managers run tabletops
constantly, the tooling for them is somewhere between PowerPoint and a paper map, and a
training tool needs no certification and no procurement cycle. That's a real user base
reachable *now*, and it's the honest claim our data quality supports. Live-incident
decision *support* (a human commander, our picture) is the later ambition, earned
incrementally — see §14.

### 2.4 Provenance-first honesty as a feature

Every entity on screen carries **source, timestamp, age, and confidence** — visible,
always. A 90-second-old aircraft position says so. An interpolated vessel track looks
different from a reported one. In a category full of "AI-powered intelligence" vaporware,
radical legibility about what the data actually is becomes the trust moat — and it's
cheap for us because GEV already brokers everything through documented adapters.

### 2.5 A reference city that works out of the box

GEV already bundles Austin: CCTV catalog, bikeshare, a TomTom Austin traffic fixture.
We double down — Austin becomes the fully-loaded reference deployment (transit, hospitals,
venue footprints, population layers), and **Q2 Stadium is the canned demo scenario** that
runs on a fresh clone with free keys. Then we publish the *city pack* format so
contributors bring their own cities online. Per-city data packs and scenario packs are a
contribution model that scales community the way "add a data layer" did for GEV.

---

## 3. The anchor scenario, minute by minute

Venue: **Q2 Stadium, Austin, TX** — capacity 20,738. Time: 21:40, match ending, egress
beginning. Report: explosion and gunfire at the northeast gate. This is the demo script
and the acceptance test for the whole build; every beat names the feature and the data
behind it.

**T+0:00 — Declare the incident.** Operator drops an Incident pin on the NE gate,
sets a 2 km geofence. This is the pivotal new primitive (§10): every layer re-scopes,
re-prioritizes, and starts logging to the incident timeline. A red *EXERCISE* /
*LIVE DATA — DECISION SUPPORT ONLY* watermark is permanent and mode-dependent.

**T+0:30 — Perception snaps to the venue.**
- CCTV layer surfaces the Austin cameras inside the geofence, viewsheds drawn (GEV `cctv.js`, `cctvViewshed.js`).
- Traffic flow around the stadium goes live (TomTom tiles + OSM geometry); Burnet Rd and Braker Ln congestion visible.
- Air picture: two news helicopters inbound, one medical helicopter (ADS-B via OpenSky/adsb.lol); FAA TFR layer (new) shows none yet — flagged, because one will come.
- Transit: CapMetro Red Line and buses near the stadium via GTFS-RT (new adapter) — trains are both an evacuation asset and a crowd sink.
- Weather: wind 14 km/h from SSW (Open-Meteo) — smoke/agent drift cone drawn from the incident pin.
- Population estimate: venue capacity × event clock + Kontur/HRSL ambient density (new layer) → ~19k on site, ~4k already in the parking lots.

**T+1:30 — The ground becomes machine-readable.** One click: *Generate ground grid*
over the stadium district — Athena's existing pipeline verbatim (DEM mosaic → Overpass
features → classifier → 1 m grid). The military channels re-labeled for civil use:
`move cost` → pedestrian/vehicle mobility, `exposure` → open-ground visibility from the
threat point, fences/walls/water as hard barriers. Streams over Socket.IO in seconds,
exactly as today.

**T+3:00 — Draw the plan.** With Athena's existing drawing tools, re-skinned:
- Evacuation corridors from gates A/C/south (away from NE) to three rally points ≥500 m out.
- The validator (today's route validation, extended) flags corridor 2: it funnels 8,000
  people over one 4 m-wide pedestrian bridge across Little Walnut Creek, and crosses the
  medical-helicopter approach.
- Responder ingress: police to NE gate, EMS staging at the west lot — deconflicted
  from egress flow by construction, not by hope.
- Ambulance corridor to Dell Seton trauma center (new hospitals layer: OSM + HHS data),
  routed against *live* traffic, not the map's idea of traffic.
- Helicopter LZ suggested from the grid: slope < 3°, no wires/trees (DEM + OSM obstacles).

**T+4:00 — Rehearse it.** *Simulate this plan*: 500 seeded runs of ~20k crowd agents
plus responder units on the real grid — Athena's engine with a crowd-behavior policy
instead of a rifle-section policy (§11). Individual agents are policy-driven (cheap);
LLM agents play only the few dozen decision-makers: gate marshals, incident command,
crowd-cluster "leaders" — the same commander-only economics that got Athena to 32×
fewer model calls. Results converge live over SSE exactly like today's win rate, but the
scoreboard reads: **median clear time 11:40, p95 22:10, choke exposure: bridge at
corridor 2 carries 41% of casualties-risk-minutes.** The aggregate probability drape —
today's "where this plan tends to get people killed" — becomes "where crowds jam."

**T+5:30 — Fix and re-run.** The conclusion page's ranked recommendations (already
built) say: split corridor 2 at the creek, open the service gate on Delta Dr. Operator
drags the route; re-simulate; p95 drops to 14:05. *That* is the GIF.

**T+6:00 — Brief out.** One artifact: the live picture snapshot, the validated plan,
sim stats, and the incident timeline — the after-action record for a real event, the
whole deliverable for an exercise. Voice assistant (GEV's realtime agent + Athena's
assistant, merged) answers throughout: "fastest clear route from Gate C right now?",
"what's the wind doing to the smoke cone?", "how old is that vessel position?"

---

## 4. The base: what gods-eye-view actually gives us

Assessed from the repo today (updated 2026-08-26).

**Architecture reality check:** GEV is a *frontend-heavy vanilla-JS Vite app*. There is
no standalone server — `/api/*` proxies (FIRMS, TomTom, terrain heights, regional
briefs, radio, launches, military installations) are Vite dev-server middleware with
disk caches. This matters: GEV needs a real backend to grow into what we want, and
**Athena already has one** (Fastify 5 + Socket.IO + Postgres + the Python engine).
The merge is complementary, not redundant.

**We inherit, roughly in order of value:**
1. **The data adapter fleet** (`src/data/`, ~100 modules): flights + military flights
   (OpenSky/adsb.lol), vessels (AISStream), satellites (CelesTrak + SGP4), FIRMS fires,
   USGS quakes, TomTom+OSM traffic, CCTV (Austin/Caltrans/TfL) with viewsheds and LOD,
   Open-Meteo, GDELT/Google News regional briefs, radio, rocket launches, submarine
   cables, dams, datacenters, bikeshare, Natural Earth regions. Each with watchdogs,
   fallbacks, caching, and per-layer attribution.
2. **Rendering craft** we should not rebuild: world-stable icon heading, motion-model
   interpolation of choppy feeds, geoid-aware altitude, ground snapping, label
   arbitration, trail rendering, detection/contact presentation, sensor modes
   (CRT/FLIR/night vision), cockpit mode, the cinematic scene director.
3. **The voice agent**: OpenAI Realtime with 28 tools and an in-app cost governor —
   directly extensible into the incident analyst.
4. **The annotation engine** (world + screen renderers, GeoJSON round-trip, tested) —
   the natural host for our plan-drawing port.
5. **Process culture**: `DATA_SOURCES.md` per-source licensing discipline,
   `SECURITY.md`, 60+ headless QA scripts, unit tests beside modules. We adopt all of it.

**Licensing facts we must respect** (details §14): code is MIT (fork freely, keep
attribution); TeleGeography cables are CC BY-NC-SA (delete if ever commercial); OpenSky
is non-commercial; Google News RSS is personal/non-commercial; Google 3D Tiles is BYOK
live-only, never cached. GEV's ethical red lines — **no named-person search, no face
recognition, no tracking individuals** — we adopt verbatim and permanently.

---

## 5. What we salvage from Athena, component by component

| Athena component | Today | In the pivot |
|---|---|---|
| Terrain pipeline (`server/src/services/{dem,osm,weather,classify,grid,pipeline}`) | ≤1 km battleground → 1 m military grid | **Keep whole.** The "ground grid" service. Raise extent cap for district-scale (§11.1); re-label channels for civil mobility |
| Binary grid wire format + Socket.IO progress | 800 KB zero-copy transfer, live progress | **Keep verbatim** — already the right design |
| Route validation (`validate.ts`, planBrief) | water/slope/exposure/ETA on drawn routes | **Keep, extend**: capacity/width, deconfliction, live-traffic cost |
| Plan drawing + persistence (frontend tools, Drizzle/Postgres, `plans.ts`) | units, routes, objectives, fortifications | **Keep**: becomes incident plans — corridors, cordons, rally points, staging |
| **Python engine** (`engine/`) — tick loop, seeded Monte Carlo, arq/Redis workers, S3 replays, SSE, batch history | LLM section commanders, combat resolvers | **The crown jewel.** Keep the chassis entirely; swap the doctrine (§11.2) |
| Agent-call economics (event-driven decisions, situation signatures, march-vs-fight) | 32× fewer calls, measured | **Keep verbatim** — this is what makes 20k-agent crowd sim affordable |
| Distance-field movement (routes around water, refuses severed ground) | soldiers | **Keep** — it *is* evacuation routing |
| Replay viewer on real ground + aggregate probability drape | tracers, casualties, reasoning bubbles | **Keep**: crowd flows, jam points, responder tracks; drape = congestion risk |
| Conclusion page (verdict, CI, ranked what-to-change) | battle plans | **Keep**: clear-time stats + plan recommendations |
| Assistant (`routes/assistant.ts`, frontend assistant/) | plan Q&A | **Merge** into GEV's voice agent as the incident analyst |
| Server broker pattern (engine token never in browser, presigned replay proxying, CORS, rate limits) | | **Keep** — becomes the broker for *all* keys, replacing GEV's Vite middleware |
| Docker compose stack (web + server + engine + Postgres/Redis/MinIO) | | **Keep** — GEV has nothing like it; "whole stack, one command" survives |

**We retire from the headline** (not necessarily delete): combat-specific resolvers
(shooting, suppression, ammunition), establishments/ORBAT, tactical symbology. The code
can stay in-tree behind the scenario system — a wargame scenario pack remains a valid
community direction — but the product, README, and demos lead with civil protection.
Threat modeling in the stadium sim stays *abstract* (a hazard point with an effect
radius that agents flee), not a simulated attacker. That's both the responsible line
and standard tabletop-exercise practice.

---

## 6. Target architecture: three planes

```
┌─ PERCEPTION ──────────────────────────────────────────────────────┐
│ GEV fork: Cesium globe, Google 3D Tiles, data adapters, sensor    │
│ modes, cockpit, voice I/O, annotations                            │
└──────────────┬────────────────────────────────────────────────────┘
               │ normalized entities (source, ts, age, confidence)
┌─ FUSION (new, in the Athena server) ──────────────────────────────┐
│ Entity store · H3 spatial index · Incident primitive (geofence +  │
│ clock + timeline log) · CAP/alert ingestion · staleness policy ·  │
│ per-layer provenance registry · analyst grounding API             │
└──────────────┬────────────────────────────────────────────────────┘
               │ incident-scoped queries
┌─ DECISION (Athena, re-aimed) ─────────────────────────────────────┐
│ Ground grid pipeline · plan store · route validator · Monte Carlo │
│ engine (crowd/response doctrine) · replays · conclusions · brief  │
└───────────────────────────────────────────────────────────────────┘
```

- **One backend**: Athena's Fastify server absorbs GEV's Vite-middleware proxies as real
  routes. All keys server-side (GEV's own SECURITY.md goal, actually finished). Postgres
  gains `incidents`, `entities` (rolling, TTL'd), `timeline_events` tables alongside
  today's plans/battlegrounds.
- **Fusion is deliberately thin at first**: normalize adapter outputs into one envelope
  `{id, kind, geometry, source, observed_at, received_at, confidence, raw}`, index by H3,
  scope by incident. Anomaly detection, watchlists, multi-sensor correlation are later
  phases — the envelope makes them possible without making v1 depend on them.
- **The engine is untouched infrastructure**: FastAPI + arq + seeded runs + SSE + S3
  replays all survive; only `policy.py`/resolver-level doctrine and the payload's
  semantic labels change.

---

## 7. Frontend strategy — the one big decision

Three options, one recommendation:

- **A. Fork GEV, rewrite Athena's UI into it (vanilla JS).** Fast to the wow, but we
  rewrite the replay viewer, plan tools, sim pages — months — and diverge from upstream
  anyway.
- **B. Port GEV's layers into Athena's React/resium app.** One codebase, but we forfeit
  GEV's deepest polish (cockpit, sensor pipeline, icon/label systems are woven through
  the app) and every upstream improvement forever. Highest cost, highest risk.
- **C. (Recommended) GEV fork as the shell; Athena capabilities as modules inside it;
  Athena's server as the single backend.** GEV is genuinely modular — layers register in
  `main.js`, data modules are self-contained, the annotation engine is pluggable, voice
  tools are a list. We add `src/incident/`, `src/ground/`, `src/planning/`, `src/sim/`
  modules following house style. The React replay viewer and conclusion pages port last
  (they're the most self-contained, talking only to the backend). Patches to GEV core
  stay minimal and upstreamable — we should *contribute* generic improvements back
  (backend brokering, provenance chips), which also builds the relationship with a 4.7k★
  community instead of strip-mining it.

Interim reality: during phases 1–2 the two frontends coexist on the shared backend
(GEV shell for perception, current Athena app for sim/replay), linked by URL handoff.
Ugly, shippable, honest.

---

## 8. Data source roster

GEV's existing sources (§4.1) all carry over. Additions, tiered by demo value:

**Tier 1 — needed for the stadium demo:**
| Source | Layer | License/access |
|---|---|---|
| GTFS + GTFS-RT (CapMetro, then any city) | transit vehicles, stations, headways | open, per-agency |
| NWS/NOAA CAP alerts (api.weather.gov) + FEMA IPAWS public feed | official alert polygons | US public domain |
| FAA TFRs + NOTAMs | airspace restrictions | public |
| OSM extracts: hospitals/trauma levels, fire/EMS stations, shelters, venue footprints + gates | facilities layer | ODbL |
| Kontur population / Meta HRSL / WorldPop | ambient population density | CC BY / open |
| USGS stream gauges + NOAA tides | flood/water state | public domain |
| OpenAQ + PurpleAir | air quality (smoke/hazmat context) | open / CC |

**Tier 2 — breadth ("ALL the data"):**
GOES + MRMS radar imagery, Copernicus/Sentinel STAC imagery (incl. Sentinel-1 SAR),
Landsat, GDACS + ReliefWeb disaster feeds, Blitzortung lightning, EONET events,
national AIS feeds (e.g. Norway's open AIS) to reduce AISStream dependence, APRS
(amateur radio positions), power-outage aggregation (only where an actual API exists —
no scraping), Waze for Cities / city 511 feeds where partnered.

**Honesty notes for the pitch:** "navy": ADS-B shows military aircraft that broadcast;
AIS shows naval vessels that don't go dark — coverage is real but partial, and we label
it, never oversell it. Satellite *imagery* (Sentinel et al.) is hours-to-days latent —
it's context, not live surveillance, and the UI's age labels make that self-evident.
No social-media scraping in v1 (§16): quality and ToS risk both fail the bar.

Every addition follows the GEV pattern: adapter module + watchdog + cache + fallback +
a `DATA_SOURCES.md` row *written before the code*, with license and attribution.

---

## 9. The incident primitive (fusion plane, detailed)

The single most important *new* thing. An **Incident** is: geofence + clock + mode
(exercise/live) + timeline. Declaring one:
1. re-scopes every layer's fetching to the geofence at maximum refresh (quota governors
   per source — GEV's TomTom budget pattern, generalized);
2. starts the **timeline log**: every alert, entity state change of note, operator
   annotation, plan edit, and sim run is an immutable timestamped event — this *is* the
   after-action review, and in exercise mode, the scoring record;
3. arms geofence triggers (aircraft entering, alert polygon intersecting, camera going
   stale);
4. grounds the analyst: voice/text queries answer only from fused, incident-scoped,
   provenance-carrying data — the analyst cites sources and ages in its answers, always.

Staleness policy is a first-class rule set: each layer declares expected cadence;
entities render age visibly (solid → hollow → ghost), and anything past its
trust-horizon is excluded from routing costs and sim inputs automatically.

---

## 10. Routing & simulation repurpose (the differentiator, detailed)

### 10.1 Ground grid at district scale
Today's cap is 1 km / 1 m cells (1M cells). A stadium district wants ~4 km. Plan:
keep 1 m for the venue core, add a 5 m outer ring resolution, or simply raise the cap
with tiled generation — decision spiked in Phase 3 with real perf numbers. Channel
re-semantics: `cover/concealment` → (crowd context) barrier/refuge; `vehicleMobility`
stays; add `pedestrianCapacity` derived from OSM width tags + classifier defaults.
Live overlay: traffic flow and closures modulate edge costs *on top of* the static grid.

### 10.2 Engine doctrine swap
- **Population**: crowd agents (policy-driven, no LLM): flee hazard → follow marked
  corridor → obey capacity/congestion slowdowns (speed as density function — the
  move-cost-allowance mechanic already does this shape). Panic/compliance variability
  sampled per seeded run — that's what Monte Carlo is for.
- **LLM decision-makers** (the only model calls): incident command, gate marshals,
  responder unit leads — a few dozen, event-driven on situation signatures, exactly
  today's commander economics.
- **Scoring**: clear time (median/p95), corridor utilization, choke exposure-minutes,
  responder time-to-scene, deconfliction violations. Wilson intervals as today.
- **Refusal is a feature**: today's "objective on severed ground → refuse before it
  costs a batch" becomes "rally point unreachable from Gate C → refuse the plan."
- Combat resolvers sit dormant behind scenario type; hazard = abstract effect field.

### 10.3 Validator extensions
Width/capacity checks (people-per-minute per corridor vs. load), egress/ingress
crossing detection, LZ suitability, live-traffic-aware ambulance ETA vs. static ETA
shown side by side.

---

## 11. Scenario catalog (proving generality)

Ship as **scenario packs** (data recipe + plan templates + sim doctrine + scoring):
stadium/venue egress (anchor) · wildfire interface evacuation (FIRMS + wind + one road
out) · flood (gauges + DEM = inundation vs. routes) · marathon/parade route security ·
port/harbor incident (AIS + hazmat cone) · search-and-rescue sector planning ·
campus/tabletop generic. Each pack is a community-contributable unit, like GEV layers.

---

## 12. Responsible use & licensing (load-bearing, not an appendix)

- **Claim discipline**: v1 is an exercise/planning/decision-*support* tool. The
  watermark, README, and every brief export state it. We *earn* stronger claims with
  validation studies (compare sim egress times against published real-event data —
  academic collaborations are a stars-magnet, too).
- **GEV red lines adopted verbatim**: no named-person search, no face recognition, no
  individual tracking. CCTV stays frames-with-provenance; no person-level analytics ever.
- **Abstract threats only** in simulation: hazards have geometry and effects, not
  tactics. We ship evacuation doctrine, not attack doctrine.
- **Licensing actions**: keep MIT + data carve-outs structure; decide commercial intent
  *now* (Q1, §17) because it determines OpenSky (non-commercial), TeleGeography
  (delete if commercial), Google News (replace with GDELT-primary). GEV attribution
  retained prominently; upstream contributions offered.
- **Security**: Athena's broker pattern everywhere; keys never in browser; per-source
  quota governors; rate limits; the existing no-user-model honesty until accounts land.

---

## 13. Phased roadmap

| Phase | Weeks (Tim + agents) | Deliverable | Exit test |
|---|---|---|---|
| **0. Spike** | 1–2 | GEV fork running locally against Athena's server for one proxied source; Athena grid drawn as a GEV imagery layer over Q2 Stadium | screenshot of both worlds in one scene |
| **1. One backend** | 2–3 | all GEV `/api/*` middleware → Fastify routes; docker compose runs the whole merged stack; keys brokered | fresh clone → `docker compose up` → globe with live layers |
| **2. Incident + fusion-thin** | 3–4 | entity envelope + H3 index + Incident primitive + timeline + staleness rendering; Tier-1 sources (GTFS-RT, CAP, TFR, facilities, population) | declare incident at Q2 → all layers scope, timeline logs |
| **3. Ground + planning** | 3–4 | district-scale grid decision + civil channel semantics; plan tools in GEV shell; extended validator | draw corridor over the creek → capacity flag fires |
| **4. Sim doctrine** | 4–6 | crowd policy, marshal/commander agents, new scoring, refusal rules; replay + conclusion ported | 500-run egress batch converges; p95 improves after applying a recommendation |
| **5. Demo + launch** | 2–3 | scripted stadium scenario, 5–8 GIFs, README rewrite, city-pack + scenario-pack docs, upstream PRs to GEV | the §3 script runs end-to-end on free-tier keys |

Rough total: ~4–5 months part-time. Phases 2 and 3 can overlap (different planes).
Each phase ends demoable — no phase's value depends on a later one landing.

---

## 14. Non-goals (v1)

No social-media ingestion. No person-level anything, ever. No CAD/dispatch integration.
No mobile apps. No classified/leaked/gray data — open means *licensed* open. No
certified-life-safety claims. No attacker simulation. No global entity history archive
(rolling windows only — we are not building a surveillance database).

## 15. Top risks

1. **Upstream drift** of the GEV fork → mitigated by option C's thin-patch discipline
   and contributing back. 2. **Scope explosion** ("ALL data") → tiers + the incident
   primitive keep every source demo-justified. 3. **Sim credibility** — crowd modeling
   has literature; we start with defensible density-speed behavior, publish assumptions
   in ENGINE.md style, and validate against real events. 4. **API cost/quotas** (Google
   tiles, TomTom, OpenAI) → GEV's governors, generalized; keyless fallbacks everywhere.
   5. **Misuse optics** — §12 discipline, visible watermark, red lines in CONTRIBUTING.

## 16. Decisions I need from you

1. **Commercial intent?** Determines OpenSky/TeleGeography/Google News handling — cheap
   to decide now, expensive to reverse.
2. **Name**: keep *Athena* (recommended — the goddess of *both* wisdom and strategic
   war fits the pivot) vs. fresh name for the fork's community launch.
3. **Repo strategy**: fresh fork of GEV with Athena imported (recommended: clean story,
   preserves GEV history for merges) vs. importing GEV into this repo.
4. **Anchor city confirmed as Austin?** (Strong default given GEV's bundled data.)
5. **Budget ceiling** for metered keys during development (Google 3D Tiles is the big one).
