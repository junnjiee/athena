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
- A partial break replaces one edge with intact/broken/intact children in a new
  immutable revision. The cut junctions use negative node ids and child edges
  use the `split:<source-edge-id>:<serial>:<part>` namespace. All three retain
  the original `wayId`, OSM name, and operator road code; only the middle child
  has `destroyed: true`, so routing can still use the surviving approaches.
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

## Reserve timing

Reserve timing keeps the four doctrinal stages distinct. Decision, readiness
and deployment time are scenario inputs normalized to minutes; movement time is
the route cost computed by the engine. A reserve commences movement after
decision + readiness, and completes its task after commencement + movement +
deployment. Missing operator inputs remain unknown, so Athena never treats an
unassessed stage as zero. The courses-of-action prompt receives both the source
stages and the corridor-specific completion time.

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
- **Directionally aligned** — their start-to-finish travel headings differ by
  no more than `CORRIDOR_MAX_HEADING_DEGREES` (45°). Direction is retained, so
  a crossing axis or traffic moving the opposite way is a different approach.
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

An operator marks a reserve location or point objective on the map, not on a
junction, so those marks are snapped to the **nearest node**. Distance is
equirectangular at the mark's own latitude; ties break on node id, so a mark
equidistant from two junctions always snaps to the same one. An area objective
instead supplies every live junction and every road-entry point inside its
bounds as goals. One search stops at the fastest ground reached, including
part-way along a long edge; the route's exact terminal, distance, timing and
display geometry all stop at that boundary. Diverse searches may enter the
same objective by different roads. If no live road intersects the area, the
centre snap preserves point behavior. Marks are *scenario input*.

Every mark may carry an IVO locality: a named terrain reference suggested by
the terrain service and editable by the operator. Reserve marks additionally
carry their deployment intelligence: optional K level (`K` through `K4`),
owning formation, and assessed/confirmed status. These fields do not alter
snapping or routing; they are preserved for the deployment overlay and supplied
to the enemy-course assessment. New and legacy reserves default to **assessed**.
Only the operator can assert **confirmed**, reflecting the
two-independent-source rule. Objectives do not carry reserve-only metadata.

Reserve composition is an ordered task organisation. Each element keeps its
own designation, aggressor echelon, exact modifier (`(=)` = 1/3, `(-)` = 2/3,
full = 3/3, `(+)` = 4/3), convoy position, and `count × platform` establishment.
The modifier changes the computed strength fraction, never the echelon: a
company(=) remains a company. Non-integral equipment results remain rational
thirds rather than being silently rounded. Order of move is explicit and is
passed to the enemy-course assessment in that order.

A mark may carry a bounding box — an objective the operator drew as ground
rather than clicked as a point. The footprint participates in routing; `lon`/
`lat` remains its display centre and deterministic fallback when no live road
intersects it. *Hardcoded rule.*

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

Every effort names a corridor id, reserve id, and objective id from one exact
routed combination in the study. A model cannot take three individually real
ids and recombine them into a movement the graph never found. Anything else is
rejected and **reported** in `rejected`, never rendered as a real approach. A
model inventing or recombining ground is the failure this whole boundary exists
to catch, so suppressing it would destroy the only evidence that it happened.

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
  Selections must be unique objectives in the current study; blank, duplicate,
  or stale ids are rejected before the model is called.
- **Prose** — free text as an S2 would write it, passed to the model unedited.
  It is the half no schema holds.

Intent is *scenario input*. It is **empty** when no objective is selected and
the narrative is blank. The engine names that condition and still answers; it
does not refuse.

The saved assessment remains bound to that scenario and its routed ground. When
a study reruns, objective selections that no longer exist are pruned while the
analyst's narrative is retained. The saved courses are retained only if intent
is unchanged and every effort still names the same routed corridor–reserve–
objective combination; otherwise they are invalidated and must be reassessed.
Legacy efforts without an objective use their original corridor–reserve pair.
This prevents a recorded model judgement from silently surviving the ground or
scenario it was made against.

### What the model is shown

Corridor id, bounded operator name/category where present, fastest time, how many
routes, each routed reserve→objective pair, reserve deployment intelligence,
objective IVO localities, and whether each corridor has a choke point. Operator labels are
explicitly delimited as scenario data; the stable id remains the only reference
the model may return. **Route geometry is withheld** — it would fill the context
without changing any judgement being asked for.

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
Each unit carries its location, personnel strength, organic weapon holdings,
availability and optional REDCON. Availability answers whether the unit is free
to receive the task. REDCON 1–5 answers how ready it is to move (1 highest, 5
lowest); it is display-only and does not constrain allocation or feed the timing
model. Missing REDCON remains unreported rather than being guessed.

### Weapons are organic holdings

Weapon rows use the capability-generic catalogue from doctrine: ATGM, Light RR,
LAW, 40mm AGL, 12.7mm HMG, GPMG, SAW, 81mm and 60mm mortars, and mini UAV. A row
belongs only to the ORBAT node on which it is entered. When a formed unit is
offered as a block force, its candidate weapon list aggregates that unit and all
of its descendants, by system. This makes the task-organised force measurable
without storing the same weapon twice on both a section and its parent.

Legacy units with no weapon rows stay valid and read as *no weapons recorded*;
Athena never invents an establishment from echelon. Personnel strength remains
ORBAT context, but it is not emitted as the measure of a block candidate.

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

Without both directions the same men are allocated to two inlets under two
different names, which makes an allocation worthless. Siblings are untouched.
*Hardcoded rule.*

## Block forces

Given the corridors the S2 pass derived and an ORBAT, the engine reports what
could block every axis/inlet. The corridors are **passed in rather than
re-derived**, so the answer is against the operator's current picture — including
corridors they have already blocked — rather than a possibly different set.

A saved block plan remains bound to those routed inlets. When a study reruns,
the server recalculates the whole block pass from the retained ORBAT and current
corridors, so distances, urgency, allocation, sealing, and reaction timing all
describe the new ground. An inlet's stable identity is its reserve, objective,
and ordered edge sequence, independent of corridor regrouping. Operator block
points, delay assessments, and establishment assessments are carried into the
recalculation only for identities that survive exactly; the engine then applies
its normal allocation and point checks again. Inputs on routes that disappeared
are dropped rather than attached to different ground. Legacy corridor-only plans
have no inlet identity with which to carry an input. Changes to the saved reserve
scenario also trigger this recalculation even when the route ground itself stays
fixed, because composition and timing feed sealing and reaction outcomes.

### Distance is not time

The engine **does not model arrival**. Candidates for an inlet are ordered by
straight-line distance from the unit to the nearest point on that axis's full
polyline — equirectangular at the unit's own latitude. This projection matters
on long road segments whose stored vertices may be far apart. When force is too
scarce to hold every inlet, route time decides which inlets remain open.
The response retains that exact nearest point for each candidate and allocation,
so the map's dashed tasking link lands on the same ground as the displayed
distance. An operator-set block point supersedes it. Older saved plans retain a
representative inlet-midpoint fallback.

Neither is a claim about who arrives first. Distance is not road distance and not
travel time; it exists because with arrival time excluded nothing else
distinguishes which unit blocks which inlet, and the alternative output is
every unit against every approach. **The race remains the commander's judgement.**
*Hardcoded rule.*

### Allocation

**Coverage is the first optimisation objective.** Each axis is an inlet and can
receive its own operator-set block position, including axes in a corridor with
no common choke. The allocator computes the ORBAT's maximum independent commitment
capacity, then chooses the nearest force for each urgent inlet only when that
choice leaves enough capacity to achieve the maximum. A nearby parent formation
is therefore skipped when committing it would consume descendants needed to
hold other inlets. If there is only one inlet, that same parent remains eligible:
this is a coverage rule, not an echelon ceiling. Ties break on unit id, so the
result is deterministic.

The candidate's weapon list describes what the allocated force brings. Sealing
is assessed only after the maximum-coverage allocation is fixed, so an
under-equipped block force remains visible rather than silently costing the
plan an inlet.

### Sealing assessment

For each allocated inlet, the engine finds the reserve named by that route and
selects the hardest catalogued platform class in its task organisation. Counts
retain the composition modifier as an exact reduced fraction. Only weapons
that the matching table marks **preferred** or **acceptable** for destruction
count; conditional matches do not become facts by assumption.

The recorded effective-weapon count is compared one-for-one with that
hardest-platform count:

- no effective weapon — **passed**;
- some effect but a remaining platform fraction — **delayed and attrited**;
- enough effect to leave no remainder — **destroyed at the block**.

Missing reserves, unrecognised platform names, and compositions with no
catalogued hardness produce **unknown**, with a reason. They never produce a
guessed result. Mixed compositions are deliberately assessed against their
hardest known class; softer elements are not used to make an anti-armour block
look stronger. The result is deterministic and does not change allocation.

### Reaction chain

Each sealing assessment also carries the doctrinal Reaction to Ops Plan chain.
The reserve's decision plus readiness stages give **commenced**. An allocated
unit establishes **contacted by block force**. The operator may set an exact
point on that inlet; the engine snaps a click within 500 m onto the routed
polyline and accumulates the actual edge travel times to calculate enemy
contact. A point naming unknown ground or outside that tolerance is rejected
and surfaced. Without an operator point, contact time remains explicitly
unknown. The operator may also assess when the allocated force will be
established at that exact point, using the same plan-relative minutes as enemy
commencement. The assessment is bound to both unit and grounded point; a changed
allocation or moved point rejects it rather than silently reusing stale timing.
When contact is known, the reaction states whether the block is established by
contact. A force known to be late cannot realize its capability at that point,
so the reaction records an unimpeded pass and computes objective arrival when
reserve timing is complete. Otherwise the sealing outcome decides whether a
remnant continues:

- destroyed — no remnant continues and the reserve **did not reach** the
  objective;
- passed — delay is zero, the remnant continues, and reserve task-completion
  time gives **reached objective** when all timing inputs exist;
- delayed and attrited — the remnant continues and reaches the objective. The
  operator may enter a positive assessed delay for that inlet and allocated
  force; complete reserve timing plus this explicit duration calculates final
  arrival. Without it, neither delay duration nor final arrival time is invented;
- unknown — continuation and objective outcome stay unknown.

Every missing event input is returned in `reaction.unknowns`. This makes an
incomplete chain visible instead of turning absent intelligence into a zero.

### Two kinds of absence, kept apart

- **unblockable** — nothing can be put on this inlet. Either its route is not in
  the area's road graph, or no uncommitted unit exists.
- **uncovered** — the inlet could have been blocked, but the force ran out before
  reaching it.

An S3 needs to tell *"there is nowhere to stand"* from *"we were one section
short"*. Collapsing the two would hide the difference, and the second is a
resourcing problem while the first is not.

## Document intelligence

`/v1/document-intelligence` is the model boundary for proposing reserve records
from operator-supplied text. Each document has an immutable request-local id;
the model must attach every extracted claim to exactly one of those ids and
include a short evidence excerpt. A claim citing an id outside the request is
rejected and returned, never accepted silently.

Document bodies are delimited as **untrusted source material** and the system
instruction explicitly forbids obeying commands found inside them. After the
model call, deterministic code normalizes designation and locality, counts each
source document once, and applies the two-source rule: two independent documents
confirm a matching position; one document leaves it assessed. The response is a
proposal for operator review, not a mutation of study marks.

The terrain service converts PDF, DOCX, Markdown, and text uploads in memory;
raw source bytes are neither stored nor forwarded. It enforces 10 MB and
100,000-character per-document limits, a 40 MB combined byte limit, and a
500,000-character combined text limit. The engine independently enforces the
same aggregate text ceiling. The S2 review surface discloses that extracted
plain text leaves the machine for the configured model provider, shows every
cited excerpt, and requires an exact named-place match inside the AO before an
operator can accept a proposal as a mark. Acceptance persists each bounded
excerpt with its source filename on the reserve record, keeping the assessment
auditable without storing the uploaded file.

## Platform catalogue and weapon matching

The aggressor catalogue is fixed reference data from doctrine: 13 named
platforms with stable ids and types. BTR-90 is hard-skin light and Truck is
soft-skin. Non-vehicle systems have no hardness rather than receiving a guessed
one, and a name outside the catalogue resolves to nothing. Hardness is therefore
a property of a known platform, never a field typed on a unit.

Weapon matching is deterministic. Given an own-force `WeaponSystem`, target
class, and required effect, it returns one of:

- **preferred** or **acceptable** — enough recorded doctrine to count it as
  effective;
- **conditional** — potentially effective, but only under a named condition such
  as flank/rear aspect or close range; it does not count until that fact exists;
- **ineffective** — cannot create the requested effect;
- **wasteful** — could act on the target but violates weapon economy, notably an
  ATGM against soft skin;
- **unknown** — the doctrine table makes no claim, which stays different from a
  claim of ineffectiveness.

This gate never calls a model and never fills a missing pairing by analogy.
Mortar fire against fortification shows why effect is an input: it is acceptable
for suppression and ineffective for destruction.

## HTTP surface

```
GET  /health            -> { ok }
GET  /v1/platform-catalogue
                        -> [{ id, name, platform_type, hardness? }]

POST /v1/document-intelligence
                        { documents: [{ id, name, text }] }
                        -> { proposals[], rejected[] }

POST /v1/weapon-target-match
                        { weapon, target, effect }
                        -> { weapon, target, effect, quality, conditions[], rationale }

POST /v1/route-study    { area_id, graph_revision? | graph, reserves[], objectives[],
                          routes_per_pair?, max_stretch?, max_sharing?,
                          corridor_separation_meters?, corridor_detour_ratio?,
                          excluded_edge_ids? }
                        -> { corridors[], unreachable[] }

POST /v1/block-forces   { area_id, graph_revision? | graph, corridors[], orbat,
                          reserves[], block_points?: [{ inlet_id, lon, lat }],
                          delay_assessments?: [{ inlet_id, unit_id, delay_minutes }],
                          block_establishments?: [{ inlet_id, unit_id,
                            block_point_lon, block_point_lat, established_minutes }] }
                        -> { inlets[], allocation[], unblockable[], uncovered[],
                             sealing[], block_points[], rejected_block_points[],
                             delay_assessments[], rejected_delay_assessments[],
                             block_establishments[], rejected_block_establishments[] }

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

- **No automatic block-force arrival model.** A credible derived arrival time
  still needs an assembly area or movement route, a movement start time and a
  route/speed model. The reaction chain therefore accepts a bounded operator
  assessment and labels it as such; it never converts straight-line proximity
  into arrival time.
- **Sealing is a capability comparison, not combat simulation.** Effective
  weapons are compared one-for-one with the hardest known reserve platforms.
  The engine does not model ammunition expenditure, rate of fire, exposure,
  losses to the block force, or a conditional engagement becoming feasible.
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
- **Area-objective reach remains road based.** Routing stops at the first live
  road point inside the bounds, including a mid-edge boundary intersection,
  but does not model off-road movement across the rest of the objective.
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
