# Route Substrate — Design

Sub-project **A** of the Athena planning-engine pivot.
Date: 2026-09-08 · Status: approved design, pending implementation plan

## 1. Why this exists

Athena's engine was a force-on-force simulation: LLM-driven soldiers moving,
observing and shooting on a 1 m tactical grid. That engine is being removed. The
engine's new role is to **complement battle procedure** rather than fight a
battle:

- **S2 side** — find enemy reinforcement routes, using enemy intent as context,
  and raise the most relevant Enemy Courses of Action (ECAs).
- **S3 side** — find the block forces a unit can deploy against them, from a
  given ORBAT.

The full product decomposes into four sub-projects:

|       | Sub-project                                                     | Depends on     |
| ----- | --------------------------------------------------------------- | -------------- |
| **A** | **Route substrate** — road graph, corridors, route enumeration   | —              |
| B     | S2 ECA generation — agent reasoning over A's output              | A              |
| C     | S3 block forces — ORBAT tree, assignment enumeration             | A (B for ECAs) |
| D     | Learning loop — accept/reject feedback adjusting ECA weights     | B              |

**This document specifies A only.** A is deliberately first and deliberately free
of AI: it is the ground truth every later stage reasons over. If the graph or the
corridors are wrong, every ECA in B and every block force in C is confidently
wrong, and an agent will paper over the error rather than surface it.

## 2. Decisions taken

Recorded because several were close calls, and a later reader will otherwise
re-litigate them.

| Decision           | Choice                                                                       | Consequence                                                                    |
| ------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Mobility           | Mounted only                                                                 | Pure graph problem. Footways and paths are never fetched. Blind to dismounted infiltration. |
| Corridor detection | Road-graph connectivity                                                      | The coarse DEM does *not* shape corridors; it grades edges.                    |
| Detection order    | Routes first, corridors emerge by clustering; operator edits re-run enumeration | "Corridor" is never defined as a graph query; it is a property of the routes found. |
| Completeness       | Bounded exhaustive                                                           | K diverse routes per reserve–objective pair, under explicit stretch and sharing bounds. |
| Compute split      | Server ingests, engine searches                                              | Reuses working Overpass/DEM/cache infrastructure; the engine stays stateless.   |
| State ownership    | Server (Postgres)                                                            | The engine persists nothing.                                                    |
| Block position     | Corridor choke point                                                         | Derived from ground truth in A, consumed by C.                                  |
| Impassability      | Edge-level override                                                          | A dropped bridge is an edge, not a corridor.                                    |

Deferred by decision rather than oversight: **arrival timing**. C reports that a
unit *can* block a route, not that it arrives first. The output is an option set
for a human to time, not a plan.

## 3. Architecture

```
Operator selects operational area on the globe (10-50 km)
  |- POST /api/operational-area                        [server, Fastify]
  |    |- Overpass: mounted road classes only, with node refs
  |    |- DEM: coarse terrarium tiles (zoom ~12) for edge gradient
  |    |- build topological graph: junctions -> nodes, segments -> edges
  |    '- persist immutably; progress over the existing Socket.IO pattern
  |
Operator marks enemy reserve locations + objectives
  |- POST /api/route-study                             [server]
  |    |- Python engine service:
  |    |    |- GET graph by id from the server   <- engine pulls, is not pushed
  |    |    |- K diverse routes per reserve->objective pair
  |    |    '- cluster routes into corridors; derive choke points
  |    '- persist corridors + routes
  |
Operator edits corridors
  '- PUT /api/route-study/:id -> re-run only if the graph or marks changed
```

**The engine pulls the graph by ID.** A 30 km road graph is tens of thousands of
edges; inlining that in every request body works in development and fails in a
demo. This also has precedent: the deleted engine's `fetch_plan` /
`fetch_battleground` pulled scenario payloads from the terrain service the same
way. The engine fetches, computes, returns, and remembers nothing.

## 4. Data model

Two new tables, mirroring the existing `battlegrounds` / `plans` split — an
immutable ingested artefact plus a mutable operator-owned document against it.

**`operational_areas`** — immutable once written, so repeated studies over the
same ground never re-hit Overpass.

- `id`, `name`, `bbox`, `generatedAt`
- `nodeCount`, `edgeCount`, `demZoom`
- packed graph (`bytea`, following the existing binary grid precedent)

**`route_studies`** — mutable.

- `areaId`, `name`
- `marks` — enemy reserve locations, objectives
- `corridors` — including `source: 'auto' | 'operator'`
- `routes`
- `edgeOverrides` — operator impassability

`source` distinguishes a detection from an operator edit. D's learning loop needs
that distinction, and it cannot be recovered later.

## 5. Graph construction

**Query.** Highway ways filtered to mounted classes — `motorway`, `trunk`,
`primary`, `secondary`, `tertiary`, `residential`, `unclassified`, `service`,
`living_street`, `track`, plus `_link` variants — requesting node refs *and*
geometry.

The current terrain query uses `out tags geom`, which returns coordinates but no
node IDs, leaving junctions inferable only by matching floats. The operational
query must return node refs so that topology is known rather than guessed.

Excluding `path|footway|cycleway|bridleway|steps|pedestrian` follows directly from
the mounted-only decision and removes a large fraction of ways in populated areas.
This is the main mitigation for the principal scaling risk in A: a 25 s Overpass
timeout against public mirrors over a box of up to 50 km.

**Junctions.** A node ID appearing in two or more ways, or a way endpoint, becomes
a graph node. Ways split at those nodes into edges.

**Edge attributes.** Road class, true length over the way geometry, and gradient
sampled from the coarse DEM.

**Modelling assumptions**, to be stated in `ENGINE.md`:

1. **`oneway` is ignored.** A reinforcing enemy does not respect traffic
   direction. All edges are bidirectional.
2. **Gradient gates mounted passability.** Above a tunable limit an edge is no-go.
   This is the coarse DEM's only role in the search.
3. **Bridges and tunnels are ordinary edges.** No structural or demolition
   modelling. A dropped bridge is an operator override, not engine knowledge.

## 6. Cost model

Cost is **travel time, not distance** — 4 km of trunk road beats 2 km of track.
Time derives from a speed-per-road-class table plus a gradient penalty.

That table is the successor to the deleted engine's `TERRAIN_PROFILES`: a small
set of tunable numbers that everything downstream depends on, documented as
assumptions rather than measurements.

## 7. Route enumeration

Yen's k-shortest paths is rejected: its k routes differ by a block or two, which
is useless when the goal is distinct avenues of approach.

**Iterative penalty search.** Compute the fastest route, penalise its edges,
re-run, repeat. A candidate is admitted only if it passes three tests:

- **Stretch** — no worse than `alpha` times the fastest route. An approach twice
  as slow is not a course of action.
- **Sharing** — overlaps every already-accepted route by less than `beta` of its
  length.
- **Local optimality** — it is the sensible way to travel between its own
  waypoints, not a detour with a kink in it.

This yields a guarantee that can be stated to a commander: *K routes per
reserve–objective pair, each within `alpha` of the fastest, each sharing less than
`beta` with any other.* That is what "bounded exhaustive" means here, and it is
explicit about its edges: the engine is complete within marked reserve–objective
pairs and silent outside them.

**Scale.** Five reserves against three objectives at K=8 is 120 routes, each a
Dijkstra over roughly 50k edges — milliseconds. Search cost is not a design
constraint; Overpass ingestion is.

## 8. Corridors and choke points

Routes cluster into corridors agglomeratively by **shared-length fraction**,
against a single threshold. This is explainable to an operator in one sentence:
*these routes are one corridor because they share 60% of their length.*

**The edges common to every route in a corridor are its choke point.** This is the
most tactically valuable output in A. C needs a block *position* even though it
does not model arrival timing, and this derives that position from ground truth
rather than asking an agent to invent it.

## 9. Determinism and identity

The search is deterministic: fixed tie-breaking by node and edge ID, no RNG.
Corridor IDs are **derived from member edge sets, not randomly generated**.

Both are load-bearing:

1. **Operator edits survive re-enumeration.** With random IDs, every re-run
   silently discards the operator's naming and categorisation.
2. **D cannot learn without stable identity.** "The operator keeps rejecting this
   kind of ECA" needs something durable to attach to across runs.

Determinism is asserted by test, not assumed.

## 10. Re-run rules

| Operator action                  | Effect                                                                   |
| -------------------------------- | ------------------------------------------------------------------------ |
| Rename, categorise, split, merge | Grouping and metadata only. Applied over existing results. **No re-search.** |
| Edge impassability override      | Re-search.                                                                |
| Add, move or remove a mark       | Re-search.                                                                |

Re-running the graph search because someone typed a name would churn corridor
identity for nothing.

Corridor-level "mark impassable" is sugar that sets overrides on that corridor's
choke-point edges. Removing every edge of a corridor would delete edges shared
with corridors the operator did not touch.

## 11. API

```
POST   /api/operational-area            start ingest (job + Socket.IO progress)
GET    /api/operational-area/:id        metadata
GET    /api/operational-area/:id/graph  packed graph - the engine's input
POST   /api/route-study                 marks -> corridors + routes
GET    /api/route-study/:id
PUT    /api/route-study/:id             operator edits; re-runs per section 10
```

## 12. Engine package

A fresh `engine/`, as a thin FastAPI service over the existing pydantic
dependency.

```
athena/graph.py       graph model, decode the server's packed format
athena/routing.py     penalty search, stretch/sharing/local-optimality tests
athena/corridors.py   clustering, choke-point derivation
athena/params.py      tunables
athena/service.py     FastAPI app
```

`params.py` keeps its name from the deleted engine; centralised tunables were one
of that codebase's better ideas.

**Tunables:** `K`, stretch `alpha`, sharing `beta`, clustering threshold,
speed-per-road-class, gradient no-go limit.

## 13. Failure policy

**The route substrate fails loudly rather than degrading.**

The terrain pipeline does the opposite, and correctly so: it catches an Overpass
failure and continues with `limited data - OSM unavailable`, because a missing
building is cosmetic. A missing *road* is not. It is a corridor absent from the
analysis but present on the ground, inside a product whose claim is that it
enumerated the approaches.

The operational ingest therefore retries hard, caches aggressively, and then
errors. It never writes a partial graph. This contradicts the established pattern
in the adjacent service deliberately, and is documented here because a future
maintainer will otherwise "fix" it to match.

## 14. UI

Fits existing patterns rather than building a parallel app.

| Need                         | Existing pattern to follow                                          |
| ---------------------------- | ------------------------------------------------------------------- |
| Area selection at 10-50 km   | `RectangleSelectionController` (currently ≤3 km)                     |
| Mark placement               | `usePlacementTool` / `PlacementController`                          |
| Route and corridor rendering | `entitySync` polylines, coloured per corridor, choke point emphasised |
| Entity volume                | `simplify`, `frameGovernor`                                         |
| Corridor editor              | `PlanRosterPanel` as the closest analogue                           |
| Ingest progress              | existing `ReasoningPanel` + Socket.IO channel                       |
| Route studies                | a page alongside `PlansPage`                                        |

## 15. Testing

A is the foundation, so it carries the heaviest testing in the project. TDD
throughout.

- **Junction splitting** is the highest-risk code. Fixtures for the cases that
  actually break it: crossroads, T-junction, a way touching another mid-span,
  dual carriageways, a roundabout.
- **Determinism** — identical inputs produce byte-identical corridor IDs.
- **Guarantees as property tests** — every accepted route within `alpha`, every
  pair sharing under `beta`.
- **Hand-built graphs** small enough that the correct answer is known by
  inspection.
- **One golden test** over a recorded real area, to catch whole-chain regressions.

## 16. ENGINE.md

Replaced wholesale, with explicit approval, keeping the old document's best
feature: the three-way **configurable today / scenario input / hardcoded rule**
distinction, and its habit of stating what is *not* modelled.

Sections: graph model; cost model and speed table; enumeration and its guarantees;
clustering and choke points; determinism and identity; tunables; known limits.

The limits section carries the assumptions fixed above: oneway ignored, bridges
and tunnels ordinary, no arrival timing, mounted only, and completeness scoped to
marked reserve–objective pairs.

## 17. Non-goals

- Dismounted or cross-country movement.
- Arrival timing, and therefore any claim that a block succeeds.
- ECA generation, ORBAT modelling, block-force assignment, and feedback learning —
  sub-projects B, C and D.
- Any AI in the route substrate. A is deterministic end to end.
