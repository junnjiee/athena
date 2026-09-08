# Athena Engine

TO AGENTS:

- THIS IS A READ-ONLY FILE FOR AGENTS. YOU MUST OBTAIN EXPLICIT APPROVAL BEFORE WRITING TO THIS FILE
- Always document the behaviour of new features here
- If this document disagrees with actual implementation, it should always be brought up

This doc records the Athena engine's behaviour and its modelling assumptions.

The engine does not fight battles. It complements battle procedure: on the S2
side it finds the routes an enemy reserve can reinforce along, and on the S3
side it will find the block forces a unit can deploy against them. This document
covers what is built — the route substrate.

Three kinds of value appear below:

1. **Configurable today** — the code accepts the value through a parameter.
2. **Scenario input** — describes one study rather than a universal rule.
3. **Hardcoded rule** — implemented directly, not yet changeable.

Tunable defaults live in `athena/params.py`. Every one is a modelling
assumption, not a measurement.

## Authority and information boundaries

- The **terrain service owns all state**: operational areas, marks, operator
  edits. The engine stores nothing.
- A study names an area; the engine **pulls** its graph, computes, and discards
  it. Pulling rather than being handed the graph keeps request bodies small —
  a real area is tens of thousands of edges.
- The engine is **deterministic**: no RNG, ties broken on stable ids. The same
  request always answers the same way. Corridor identity depends on this, and
  so will the operator-feedback loop that learns from it.

## The road graph

Built by the terrain service (`server/src/services/roadGraph.ts`) and delivered
as gzipped JSON.

- A **node** is a junction or the free end of a road. Interior shape points are
  not nodes; an edge keeps its shape between them.
- An **edge** is one stretch of road between two nodes, carrying road class,
  true length, and its geometry.
- Elevation lives on the **node**, so an edge's gradient is derived and signed.

### Modelling assumptions

- **`oneway` is ignored.** Every edge is traversable both ways. A reinforcing
  enemy does not respect traffic direction. *Hardcoded rule.*
- **Bridges and tunnels are ordinary edges.** No structural or demolition
  modelling. A dropped bridge is an operator override, not engine knowledge.
  *Hardcoded rule.*
- **Only drivable ways exist.** Routing is mounted-only; footways, paths,
  cycleways, bridleways and steps are never fetched. The engine is therefore
  blind to dismounted infiltration. *Hardcoded rule.*
- **Gradient is taken between an edge's endpoints**, not its steepest interior
  segment. At operational scale the DEM is far coarser than the shape points, so
  a per-segment slope would mostly measure sampling noise. A short edge over a
  real cliff is understated. *Hardcoded rule.*

## Cost model

Cost is **travel time, not distance**: four kilometres of trunk road beats two
of track.

| Class | km/h | | Class | km/h |
| --- | --: | --- | --- | --: |
| Motorway | 80 | | Unclassified | 30 |
| Trunk | 70 | | Residential | 30 |
| Primary | 60 | | Service | 20 |
| Secondary | 50 | | Living street | 15 |
| Tertiary | 45 | | Track | 15 |

These are march speeds for a mounted column, not civilian free-flow speeds: a
column moves at the speed of its slowest vehicle and does not overtake.
*Configurable today.*

- **Climbing costs time.** Effective speed is divided by
  `1 + GRADIENT_SPEED_PENALTY × gradient`. At the default of `2.0`, a 10% climb
  costs about 20% of the speed. *Configurable today.*
- **Descending is not credited.** A loaded vehicle brakes downhill rather than
  making up time, so a descent costs the same as flat ground. *Hardcoded rule.*
- **Grades above `MAX_MOUNTED_GRADIENT` (0.25) are no-go**, applied to the
  direction of travel — a slope can be impassable one way and legal the other.
  *Configurable today.*

## Route enumeration

Yen's k-shortest paths is deliberately **not** used: its k routes differ by a
block or two, which describes one approach k times. The goal is distinct
avenues of approach.

**Iterative penalty search.** Take the quickest route, multiply its edges'
costs by `PENALTY_FACTOR`, search again. A candidate is admitted only if:

- **Stretch** — within `MAX_STRETCH` (1.6) of the fastest route. An approach
  twice as slow is not a course of action.
- **Sharing** — overlaps every accepted route by less than `MAX_SHARING` (0.7)
  of its length.

The search stops at `ROUTES_PER_PAIR` (8) accepted routes or
`MAX_SEARCH_ITERATIONS` (40) attempts, so a graph that cannot supply K diverse
routes terminates rather than grinding. All four are *configurable today*.

Penalties steer the search only; a route's **reported** cost is always its true
travel time.

### What "bounded exhaustive" guarantees

> K routes per reserve–objective pair, each within `alpha` of the fastest, each
> sharing less than `beta` with any other.

The engine is **complete within marked reserve–objective pairs and silent
outside them**. It does not find approaches from ground nobody marked. This is
the central limitation of the S2 output and should be stated wherever the
result is shown.

## Corridors

A corridor is never asked of the graph directly — "mobility corridor" has no
clean definition as a graph query. It is derived: routes running down much of
the same ground *are* one approach.

- Routes cluster **single-link agglomerative** on shared length, joining when
  similarity reaches `CORRIDOR_SIMILARITY` (0.4). Single-link suits an approach
  that bends: the two ends of a long corridor may share little with each other
  while both clearly belong to the middle. *Configurable today.*
- Similarity is **symmetric** (shared length over the two routes' combined
  length). A short route running inside a long one is not thereby the same
  approach.
- Clustering runs **across all pairs**, not per pair: two reserves feeding the
  same valley are using one approach, and blocking it blocks both.

### Choke points

**The edges common to every route in a corridor are its choke point** — the
ground every route through that corridor must cross. This is where a block is
sited, and it is derived from terrain rather than asserted by an agent.

- Ordered along the corridor's fastest route, so it reads in the direction of
  travel.
- A corridor of one route is wholly its own choke point; there is no narrowing
  to find.
- Routes forced into one corridor while sharing no edge have **no** choke point,
  reported as empty rather than invented.

### Corridor identity

Corridor ids are **derived from the ground covered** — a SHA-256 over the sorted
union of member edge ids — never generated. Re-running over unchanged ground
reproduces them exactly. Two things depend on this: operator renaming and
categorisation survive re-enumeration, and the feedback loop has something
stable to attach to across runs. *Hardcoded rule.*

## Marks and snapping

An operator marks a reserve location or objective on the map, not on a junction,
so every mark is snapped to the **nearest node**. Distance is equirectangular at
the mark's own latitude; ties break on node id, so a mark equidistant from two
junctions always snaps to the same one. Marks are *scenario input*.

## Reporting absence

A reserve–objective pair with no route is **reported, not dropped**. "We found
no way in" is a finding; silently omitting the pair reads as "no threat". Two
reasons are distinguished: no road network near the mark, and no drivable route
between the marks.

Likewise, an area whose graph cannot be fetched is a `502`, never an empty
study — a study on ground nobody read would be a confident answer about nothing.

## HTTP surface

```
GET  /health
POST /v1/route-study    { area_id | graph, reserves[], objectives[], ...params }
                        -> { corridors[], unreachable[] }
```

`area_id` is resolved against `TERRAIN_SERVICE_URL`. `graph` is accepted
directly so the engine can be exercised without a terrain service running.

## Known limits

- **No arrival timing.** The engine says a route exists and how long it takes,
  never who gets there first. Block feasibility in S3 is an option set for a
  human to time, not a plan.
- **No dismounted movement**, and therefore no cross-country approach.
- **Completeness is scoped to marked pairs** (see above).
- **No enemy intent, ranking, or courses of action yet.** Everything here is
  deterministic; the S2 agent layer sits on top of it and is not built.
- **No block forces yet.** The S3 side is not built; choke points are derived
  and waiting for it.
- **Weather, surface condition, and traffic are not modelled.**
- **No corridor is found from unmarked ground.** The operator's marks bound the
  entire analysis.
