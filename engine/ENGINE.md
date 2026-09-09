# Athena Engine

> **To agents:** obtain explicit approval before writing to this file. Document
> the behaviour of new features here, and raise any disagreement between this
> document and the implementation rather than resolving it silently.

This document records what the Athena engine does and the modelling assumptions
it does it under. It is the reference for the engine's behaviour; where it and
the code disagree, that is a defect in one of them and worth raising rather than
quietly working around.

The engine does not fight battles. It complements battle procedure. On the S2
side it finds the routes an enemy reserve can reinforce along and assesses how
that enemy would use them; on the S3 side it finds the block forces a unit could
put against them. Everything here is deterministic except the courses-of-action
pass, which is the only place a model reasons.

## How to read this document

Three kinds of value appear below:

1. **Configurable today** — the code accepts the value through a parameter.
2. **Scenario input** — describes one study rather than a universal rule.
3. **Hardcoded rule** — implemented directly, not yet changeable.

Tunable defaults live in `athena/params.py`. Every one is a modelling
assumption, not a measurement.

## Authority and information boundaries

- The **terrain service owns all state**: operational areas, marks, operator
  edits, learned weights. The engine stores nothing.
- A study names an area; the engine **pulls** its graph, computes, and discards
  it. Pulling rather than being handed the graph keeps request bodies small — a
  real area is tens of thousands of edges.
- The engine is **deterministic everywhere except the courses-of-action pass**:
  no RNG, ties broken on stable ids, the same request answering the same way.
  Corridor identity depends on this, and so does the feedback loop that learns
  from it.
- The engine **learns nothing on its own**. Ranking weights arrive with a
  request and are returned changed; the terrain service stores them. A second
  deployment reading the same ground with neutral weights gets the doctrinal
  answer.

## The road graph

Built by the terrain service (`server/src/services/roadGraph.ts`) and delivered
as gzipped JSON. Field names mirror the server's `RoadGraph` exactly, so the
contract reads the same from either side.

- A **node** is a junction or the free end of a road. Interior shape points are
  not nodes; an edge keeps its shape between them.
- An **edge** is one stretch of road between two nodes, carrying road class,
  true length, its geometry, and the source OSM name and lane count when they
  exist. Name and lanes are operator-facing prefill metadata; the engine does
  not use either in routing.
- A destroyed edge remains in the revision with `destroyed: true`, preserving
  its axis identity for display and comparison, but is omitted from routing
  adjacency. Destruction is a terrain state, never deletion.
- Operator-added roads snap to two live junctions and use negative road ids plus
  `added:N:index` edge ids. OSM ids are positive, so neither identity space can
  collide. Added edges otherwise route by the same class, grade and direction
  rules as extracted roads.
- Elevation lives on the **node**, so an edge's gradient is derived and signed.

### Modelling assumptions

- **`oneway` is ignored.** Every edge is traversable both ways; only the sign of
  the gradient changes with direction. A reinforcing enemy does not respect
  traffic direction. *Hardcoded rule.*
- **Bridges and tunnels are ordinary edges.** The engine does not infer damage.
  A confirmed loss is stored as destroyed ground in a graph revision; a study's
  hypothetical loss remains an `excluded_edge_ids` override. *Hardcoded rule.*
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
  `1 + GRADIENT_SPEED_PENALTY x gradient`. At the default of `2.0`, a 10% climb
  costs about 20% of the speed. *Configurable today.*
- **Descending is not credited.** A loaded vehicle brakes downhill rather than
  making up time, so a descent costs the same as flat ground. *Hardcoded rule.*
- **Grades above `MAX_MOUNTED_GRADIENT` (0.25) are no-go**, applied to the
  direction of travel — a slope can be impassable one way and legal the other.
  *Configurable today.*

## Route enumeration

Yen's k-shortest paths is deliberately **not** used: its k routes differ by a
block or two, which describes one approach k times. The goal is distinct avenues
of approach.

**Iterative penalty search.** Take the quickest route, multiply its edges' costs
by `PENALTY_FACTOR` (1.6), search again. A candidate is admitted only if:

- **Stretch** — within `MAX_STRETCH` (1.6) of the fastest route. An approach
  twice as slow is not a course of action.
- **Sharing** — overlaps every accepted route by less than `MAX_SHARING` (0.7)
  of its own length.
- **Not a repeat** — its exact edge set has not already been accepted.

The search stops at `ROUTES_PER_PAIR` (8) accepted routes, at
`MAX_SEARCH_ITERATIONS` (40) attempts, or as soon as the cheapest remaining
option exceeds the stretch limit — penalties only ever push the search further
out, so nothing better follows. A graph that cannot supply K diverse routes
terminates rather than grinding.

`ROUTES_PER_PAIR`, `MAX_STRETCH` and `MAX_SHARING` are *configurable today* per
request; `PENALTY_FACTOR` and `MAX_SEARCH_ITERATIONS` are function parameters
with no request field, so they are *configurable today* in code only.

Penalties steer the search only; a route's **reported** cost is always its true
travel time. The underlying search is Dijkstra over travel time with ties broken
on node id, so the same graph always yields the same route — corridor identity
downstream depends on that.

### What "bounded exhaustive" guarantees

> K routes per reserve–objective pair, each within `alpha` of the fastest, each
> sharing less than `beta` with any other.

The engine is **complete within marked reserve–objective pairs and silent
outside them**. It does not find approaches from ground nobody marked. This is
the central limitation of the S2 output and should be stated wherever the result
is shown.

## Corridors

An **axis** is one route through the ground. A **corridor is a bundle of axes**:
the set that together forms one approach, from the same place to the same place
through the same gap.

Grouping is on how the axes lie, never on tarmac they share. Two roads either
side of the same gap share no segment whatever and are plainly one approach, so
shared length is the wrong question. It was the rule here until now, and it split
every such pair in two — reporting a lone axis as a corridor and overstating how
many approaches an enemy has.

Two axes are one corridor when all three hold:

- **Laterally close** — median separation at or under `CORRIDOR_SEPARATION_METERS`
  (5 km). Every node of each axis is measured to the nearest node of the other and
  the median taken. Median rather than minimum, because two approaches that merely
  touch at a shared objective are not thereby close along their length.
  *Configurable today.*
- **Laterally connected** — the way round from the middle of one axis to the
  middle of the other is at most `CORRIDOR_DETOUR_RATIO` (3.0) times their
  straight-line separation. *Configurable today.*
- Grouping is **single-link agglomerative**, so belonging is transitive. That
  suits an approach that bends: the two ends of a long corridor may lie far apart
  while both clearly belong to the middle.

### The obstacle test needs no terrain

Connectivity is what separates corridors, and it is measured entirely on the road
graph. Where ground is impassable there are no roads across it, so an obstacle
appears as a long way round: two axes either side of a reservoir sit 2 km apart
and 30 km apart through the network. **The engine reads no landcover, no
trafficability surface and no off-road terrain.** Node elevation remains, sampled
at road nodes for gradient in the cost model — a property of the axis itself.

Connectivity is measured between the **middles** of two axes, never their ends.
Routes from one reserve to one objective share both endpoints, so an end-measured
distance is always zero and would merge every approach into one.

- Clustering runs **across all pairs**, not per pair: two reserves feeding the
  same valley are using one approach, and blocking it blocks both.
- Corridors are returned **fastest first**, ties broken on corridor id. Routes
  within a corridor are ordered by time, then by edge ids.

### Choke points

**The edges common to every axis in a corridor are its choke point** — the ground
every route through that corridor must cross. This is where a block is sited, and
it is derived from the network rather than asserted by an agent.

- Ordered along the corridor's fastest route, so it reads in the direction of
  travel.
- A corridor of one axis is wholly its own choke point; there is no narrowing to
  find.
- **Axes in one corridor that share no ground have no choke point**, reported as
  empty rather than invented. This is now the common case rather than a curiosity:
  two roads through the same gap are one corridor with nowhere a single block sits
  astride both. Such a corridor must be held axis by axis.

### Corridor identity

Corridor ids are **derived from the ground covered** — `cor_` plus the first 16
hex characters of a SHA-256 over the sorted union of member edge ids — never
generated. Re-running over unchanged ground reproduces them exactly. Two things
depend on this: operator renaming and categorisation survive re-enumeration, and
the feedback loop has something stable to attach to across runs. *Hardcoded
rule.*

## Marks and snapping

An operator marks a reserve location or objective on the map, not on a junction,
so every mark is snapped to the **nearest node**. Distance is equirectangular at
the mark's own latitude; ties break on node id, so a mark equidistant from two
junctions always snaps to the same one. Marks are *scenario input*.

A mark may carry a bounding box — an objective the operator drew as ground
rather than clicked as a point. The engine ignores it: `lon`/`lat` is the centre,
and routing goes to the node nearest that centre. The footprint is for the
operator's map, not for the search. *Hardcoded rule.*

## Reporting absence

A reserve–objective pair with no route is **reported, not dropped**. "We found no
way in" is a finding; silently omitting the pair reads as "no threat". Two
reasons are distinguished:

- `no road network near this mark` — the graph has no nodes to snap to.
- `no drivable route between these marks` — snapped, but nothing connects them
  within the search's bounds.

Likewise, an area whose graph cannot be fetched is a `502`, never an empty study
— a study on ground nobody read would be a confident answer about nothing.

## Enemy courses of action

The S2 assessment, and **the only place in the engine where a model reasons**.
Everything else is deterministic, and that is what makes this defensible: the
corridors, routes and ground are the route substrate's output, and the model
supplies judgement over them rather than facts of its own.

A course of action is a **scheme**, not a single move: exactly one main effort
plus any supporting efforts. An assessment that could only ever name one corridor
would describe a simpler enemy than the one being planned against.

**With no corridors the model is not called at all.** Given nothing to reason
over it would fill the silence, which is the failure the grounding check exists
for. An empty corridor list returns an empty assessment without a model call.

### The model may not invent ground

Every effort names a corridor id and a reserve id from the study. Anything else
is rejected and **reported** in `rejected`, never rendered as a real approach. A
model inventing a corridor is the failure this whole boundary exists to catch, so
suppressing it would destroy the only evidence that it happened.

A course failing the check is **dropped whole, not repaired**. Removing one
effort leaves a scheme the model never proposed and nobody has judged.

Two further rules are enforced on shape: a course must have at least one effort,
and exactly one main effort. *Hardcoded rules.*

### The model judges; the code ranks

The model scores each course on **likelihood** (given the stated intent) and
**danger** (cost to us if it happens) independently. The doctrinal pair — most
likely and most dangerous — is then selected **in code** from those scores, not
chosen by the model, and before any learned weighting is applied. One course can
be both, and when it is, that is the finding rather than a fault. Ties break on
name, so the same scores always name the same course. *Hardcoded rule.*

### Intent

Two halves, because a staff officer works in both:

- **Structured** — which marked objectives the enemy is believed to want. No
  named objectives means every objective is in play, stated as such in the
  prompt. Posture is deliberately absent: control of the designated objective
  is the scenario assumption, not another field for the operator to guess.
- **Prose** — free text as an S2 would write it, passed to the model unedited.
  It is the half no schema holds.

Intent is *scenario input*. It is **empty** when no objective is selected and
the narrative is blank. The engine names that condition and still answers; it
does not refuse.

### What the model is shown

Corridor id, fastest time, how many routes, which reserves can use it, and
whether it has a choke point. **Route geometry is withheld** — it would fill the
context without changing any judgement being asked for.

### Which model, and how it is configured

**The engine takes no position on which model reasons.** It asks for a schema and
is given one back; nothing about the call is shaped around a particular provider,
and no vendor SDK is a dependency. The model is named as `provider:name` —
`openai:gpt-5.6-sol` by default, overridden by `ATHENA_MODEL` — and resolved by
pydantic-ai. Its key comes from a single `PROVIDER_API_KEY` rather than a
vendor-specific variable, handed to whichever provider class pydantic-ai maps
that prefix to; the engine holds no table of providers and names none. Changing
provider is a change of environment, not of code. *Configurable today* in
`athena/params.py`, along with the token ceiling (`ECA_MAX_TOKENS`, 16000) and
the system prompt.

With `PROVIDER_API_KEY` unset the model name is passed through untouched and key
resolution falls entirely to pydantic-ai, which reads whichever conventional
variable that provider expects. A deployment already exporting one keeps working
untouched.

A provider that cannot be resolved **raises rather than being swapped** for one
that can. Everywhere else in the engine an unanswerable question is reported
instead of answered badly, and a silent fallback to a different vendor's
judgement would be the worst instance of it.

Nothing is asked of the model that only one provider offers. Reasoning effort in
particular is not set: models that reason do so on their own terms, and a knob
that exists on one vendor's API is not a modelling assumption this engine makes.

### Three ways this pass fails, kept apart

An empty list of courses must never be how a failure reaches an operator: "the
enemy has no options" and "we did not get an answer" are opposite findings. The
three failures are distinguished because each is a different action.

| Failure | Raised as | HTTP | What the operator does |
| --- | --- | --: | --- |
| No model configured to ask | `NotConfiguredError` | `503` | Set `ATHENA_MODEL` and `PROVIDER_API_KEY` in the engine's environment |
| Model reached, no assessment came back | `RefusedError` | `502` | Read the message; retry, or reconsider the intent |
| Model unreachable — rate limit, outage | `RefusedError` | `502` | Try again |

- **Not configured** covers a missing key, a provider that cannot be resolved,
  and a provider rejecting the key or the model name (`401`, `403`, `404` from
  upstream). All three are one operator action — fix the deployment — and none is
  a finding about the enemy. It is a `503` rather than a `502` because nothing
  upstream failed: this deployment was never given a model to ask. The message
  names both environment variables, because it is read in the app rather than in
  a stack trace. *Hardcoded rule.*
- **Refusal** covers a decline, a truncation and a wall of prose alike. The
  engine deliberately does not read a provider's own refusal vocabulary to tell
  these apart — it would be reading one vendor's stop codes, and the distinction
  changes nothing an operator does. *Hardcoded rule.*
- **Upstream unavailability** (any other provider HTTP status) is not
  configuration: the answer is to retry, not to edit anything.

The terrain service surfaces the engine's own sentence rather than its wire
format, so a one-line configuration fix does not reach the operator as an opaque
failure.

## Learned ranking

Two commanders reading the same study reasonably attend to different things: one
to speed, another to what can actually be blocked. The engine learns which, from
what the operator accepts and rejects.

### What is learned, and what is not

**The doctrinal pair is not learnable.** Most likely and most dangerous are
selected from the model's scores *before* any weighting is applied, and nothing
here can move them. Learning decides only the order of the remaining list.
*Hardcoded rule.*

### Learning is over features, not courses

A course of action has no identity across runs — the model rewrites it every
time. But "fast", "blockable" and "multi-pronged" are properties of the ground
and the scheme, and they mean the same thing next week. Feedback therefore
attaches to a **feature vector**, which is what makes it attachable at all.

Five features, each 0-1, each named for something a commander would say aloud:

| Feature | Meaning |
| --- | --- |
| `speed` | How fast the main effort's corridor is, against the fastest in the study |
| `blockable` | Share of the corridors used that have a choke point |
| `complexity` | How many efforts the scheme has; a single thrust is 0 |
| `likelihood` | The model's own score |
| `danger` | The model's own score |

`speed` is relative to the study rather than absolute, so "fast" means the same
thing whether the ground spans five minutes or five hours. `complexity` saturates
at three efforts — beyond that the difference stops being one a commander would
act on. A course whose efforts name no corridor in the study scores zero on
`speed` and `blockable`.

### The update rule

Weights start neutral at `PREFERENCE_NEUTRAL` (0.5), and neutral means the
ranking is purely doctrinal. On a verdict, each weight moves by
`rate x (feature - 0.5)`, positive on accept and negative on reject, clamped to
`[0, 1]`.

In words: **accepting a course that was strong on a feature raises that feature's
weight; rejecting it lowers it.** A course that was unremarkable on a feature
barely moves that weight, which is what stops one verdict from dragging the whole
vector. `PREFERENCE_LEARNING_RATE` is `0.1` — deliberately low, so a commander
does not find the ranking transformed because they dismissed one course on a
Tuesday. Both values are *configurable today*.

Accepting and then rejecting the same course returns the weights exactly where
they started.

Ordering scores each course as its features weighted by the weight vector,
normalised by the weights' sum, highest first with ties broken on name. While the
weights are neutral the list is returned in doctrinal order untouched.

### Visible and resettable

The rule is arithmetic an operator can follow, the weights are readable, and they
can be reset to neutral. A ranking that drifts for reasons nobody can see is
worse than no ranking at all — which is also why the terrain service keeps every
verdict and the feature vector that produced it, rather than only the current
weights.

## Order of battle

The force a commander has to block with. This is the force *available for this
task*, not the formation's establishment: units get moved around by mission
requirement, so the operator supplies it per study. The ORBAT is *scenario
input*.

Athena models organisation down from a company — company, platoon, section,
group. Nothing above a company exists, so a company is always the root of a tree.
Each unit carries its location, strength and availability.

### Role follows the echelon commanded

Role is not stored on a unit. It is derived from the echelon that unit commands:
a company or platoon is commanded by an officer, a section by a sergeant, a group
by a man. That keeps one fact in one place — promote a unit by giving it command
of a larger formation, not by editing two fields that can disagree. A group being
led by a man holding an appointment rather than by a sergeant is doctrine, not an
approximation. *Hardcoded rule.*

### The tree rule, and why there is no cycle check

A unit's parent must sit at a **strictly higher echelon**. Because echelon depth
strictly decreases on every step upward and is bounded below by zero, that single
rule also makes parent cycles impossible. The engine therefore has no separate
cycle check, and does not need one. Ids must be unique and every named parent
must exist. *Hardcoded rule.*

### Availability

Only an **uncommitted** unit is offered as a block force. A `committed` unit is
already doing something the commander decided mattered more, and offering it as
free would quietly propose breaking that. A `reserve` unit is likewise withheld.
Available units are offered **largest echelon first**, so a commander sees the
formed body before its parts — a force is offered up rather than broken up.
Availability is *scenario input*.

### Committing spends the tree in both directions

Committing a unit makes unavailable:

- everything **below** it — committing a platoon commits its sections;
- everything **above** it — a platoon with one section gone is no longer a
  platoon to commit.

Without both directions the same men are allocated to two corridors under two
different names, which makes an allocation worthless. Siblings are untouched.
*Hardcoded rule.*

## Block forces

Given the corridors the S2 pass derived and an ORBAT, the engine reports what
could block what. The corridors are **passed in rather than re-derived**, so the
answer is against the operator's current picture — including corridors they have
already blocked — rather than a possibly different set.

### The size ceiling

The operator states the largest formation that may be committed to any one
corridor. A ceiling of platoon admits a platoon, a section or a group, but not a
company. Expressed on echelon depth so it cannot disagree with the tree rule.
*Scenario input.*

### Distance is not time

The engine **does not model arrival**. Candidates for a corridor are ordered by
straight-line distance from the unit to the nearest vertex of the choke point —
equirectangular at the unit's own latitude — and the allocation serves the
quickest corridor first on the grounds that it is the one the enemy reaches
soonest.

Neither is a claim about who arrives first. Distance is not road distance and not
travel time; it exists because with arrival time excluded nothing else
distinguishes which unit blocks which corridor, and the alternative output is
every unit against every approach. **The race remains the commander's judgement.**
*Hardcoded rule.*

### Allocation

One pass, mutually exclusive: each corridor in urgency order takes the nearest
force still free, and that force's whole commitment set is spent. Ties break on
unit id, so the same ORBAT always proposes the same force. The result is
deterministic.

### Two kinds of absence, kept apart

- **unblockable** — nothing can be put on this corridor. Either it has no choke
  point (its routes share no ground to stand on), its choke point is not in the
  area's road graph, or no uncommitted unit fits the ceiling.
- **uncovered** — the corridor could have been blocked, but the force ran out
  before reaching it.

An S3 needs to tell *"there is nowhere to stand"* from *"we were one section
short"*. Collapsing the two would hide the difference, and the second is a
resourcing problem while the first is not.

## HTTP surface

```
GET  /health            -> { ok }

POST /v1/route-study    { area_id, graph_revision? | graph, reserves[], objectives[],
                          routes_per_pair?, max_stretch?, max_sharing?,
                          corridor_separation_meters?, corridor_detour_ratio?,
                          excluded_edge_ids? }
                        -> { corridors[], unreachable[] }

POST /v1/block-forces   { area_id, graph_revision? | graph, corridors[], orbat, ceiling }
                        -> { corridors[], allocation[], unblockable[], uncovered[] }

POST /v1/enemy-courses-of-action
                        { corridors[], reserves[], objectives[], intent, weights? }
                        -> { courses[], most_likely, most_dangerous, rejected[] }

POST /v1/preference/feedback
                        { weights, course, corridors[], verdict }
                        -> { weights, features }
```

Request bounds on `/v1/route-study`: `routes_per_pair` 1–32, `max_stretch` above
1.0, `max_sharing` above 0 and at most 1.0, `corridor_separation_meters` above 0,
`corridor_detour_ratio` at least 1.0.

`excluded_edge_ids` carries the operator's own knowledge of the ground — a
dropped bridge, a flooded ford — which the engine has no way of knowing on its
own.

The courses endpoint takes no graph: it reasons about which approaches an enemy
would use, not about the ground beneath them, and the corridors already carry
everything that judgement rests on.

`area_id` is resolved against `TERRAIN_SERVICE_URL`. When `graph_revision` is
present, the engine fetches that immutable snapshot rather than the area's
current head. Route studies pin this value, and the block-force pass carries it
forward, so corridor edge ids are always interpreted against the ground that
produced them. `graph` is accepted directly so the engine can be exercised
without a terrain service running.

| Status | Meaning |
| --: | --- |
| `400` | Neither `area_id` nor `graph` given; or a study with no reserves or no objectives |
| `502` | The area's graph could not be fetched; or the model was reached and no assessment came back |
| `503` | No model is configured for the courses-of-action pass |

A graph that cannot be fetched is a `502` on either endpoint, never an empty
answer.

### Running the engine

The engine reads `os.environ` directly and loads no file of its own. A plain `uv
run` therefore ignores `.env`, and the courses-of-action pass then fails as
unconfigured; start it with the env file:

```
uv run --env-file .env uvicorn athena.service:app --port 8000
```

Under Docker the variables are passed in by compose, so no file is read.

## Known limits

- **No arrival timing.** The engine says a route exists and how long the enemy
  takes along it, but never whether a block force gets there first. A block plan
  is an option set for a human to time, not a plan.
- **A block force is never sized against the threat.** The engine does not ask
  whether a section can actually hold what is coming down the corridor, only
  whether it is free and within the ceiling.
- **No dismounted movement**, and therefore no cross-country approach — for the
  enemy or for a block force moving to its position.
- **Completeness is scoped to marked pairs** (see above).
- **The courses-of-action pass is not reproducible.** Everything else in the
  engine answers the same way every time; this one does not. Two runs over
  identical ground and identical intent may name different courses. Where a
  decision needs to be defended later, record the assessment rather than
  expecting to regenerate it.
- **An assessment is only as good as the intent it was given.** With no selected
  objective and no narrative the model has nothing but terrain, and what comes
  back is geography rather than intelligence. The engine reports when intent is
  empty; it does not refuse.
- **The model's scores are judgement, not measurement.** Likelihood and danger
  are its opinion on a scale, not probabilities derived from anything. They order
  courses; they do not quantify risk.
- **An objective's area is not modelled.** An objective drawn as ground routes to
  its centre like any other mark; the engine does not consider approaches to its
  edges or its extent.
- **Learned weights are one deployment's taste, not doctrine.** They reflect
  whoever has been giving verdicts on this instance. Reset them when the operator
  changes, or read them and decide whether they still describe the commander
  being served.
- **A rejected reference means the assessment was incomplete.** Courses that
  named ground which does not exist were dropped, so what remains is a subset of
  what the model proposed — read `rejected` before treating the list as the whole
  answer.
- **The allocation is one greedy pass, not an optimum.** It serves urgency first
  and never backtracks, so a different assignment may cover more corridors. It is
  a starting point for a commander, not a solution.
- **Weather, surface condition, and traffic are not modelled.**
- **No corridor is found from unmarked ground.** The operator's marks bound the
  entire analysis.
