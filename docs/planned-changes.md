# Planned changes

A log of intended changes to the planning surface, captured from discussion.
Not a spec and not a plan of record — no implementation has started. One open
question remains and it blocks nothing; everything else is settled.

Grouped A–F. **Order: B first, then A**, then the rest — fix the corridor model
before building UI that renders corridors, so the new sidebar is built against
the corrected shape rather than retrofitted to it. B is engine only; A is almost
pure frontend.

Doctrinal facts referenced here — echelons, reserve levels, timings, route
classification, target hardness, weapon–target pairings — live in
[`DOCTRINE.md`](DOCTRINE.md), which is the source of truth. This file records
*changes*; that file records *what is true*.

---

## A. Shell and Steps 1–2

Frontend only. Self-contained. Builds the shell that C and D later fill.

### Layout

- **Left rail becomes retractable.** `components/layout/Sidebar.tsx`, currently
  fixed `w-52`. The page header and the library aside are both hard-pinned to
  `left-60` in `pages/RouteStudiesPage.tsx`, so those offsets have to become
  dynamic rather than constant.
- **Delete the top bar.** The `<header>` in `RouteStudiesPage.tsx`. Verified
  redundant — every one of its four tool buttons arms an identical mode
  reachable elsewhere:

  | Top-bar button | Already reachable from |
  |---|---|
  | Select area | Library "New area" button; step guide action |
  | Reserve | `MarkGroup` **+** in the marks panel |
  | Objective | `MarkGroup` **+** in the marks panel |
  | Force | ORBAT panel place button (`OrbatPanel.tsx:76`) |

  Only the title line (`ROUTE SUBSTRATE` + study/area name) is unique to it and
  needs rehoming — proposed destination is the head of the new right sidebar.
  Removing the header also drops one of the three `left-60` pins above.

- **Right panel column becomes a full sidebar, segmented three ways:**
  **Ground** (neutral), **S2**, **S3**. Ground belongs to neither staff branch —
  it is common to both. This replaces the current floating `w-80` stack of
  marks panel plus four-tab strip (`corridors` / `courses` / `orbat` / `block`).

### Renames

| Current | Becomes |
|---|---|
| Operational Library | Theater |
| Areas | AO |
| Studies | Terrain Study |
| "Ingest road graph" | "Create road graph" |

Literal strings at `RouteStudiesPage.tsx:701`, `:717`, `:772`, `:825`. The
underlying domain type is `OperationalAreaMeta` (frontend types, server
`operational_areas` table, engine wire shapes).

### Step 1 — declare the AO

- ~~**Auto-title the AO from location data.**~~ **Done** — the finalized AO
  selection resolves its nearest named OSM locality through the shared
  server-side place lookup. The suggestion fills only an untouched input, so
  an operator's typed name always wins.
- ~~**Highlight the AO name input** so it reads as the field awaiting input.~~
  **Done** — the selected-ground form now presents a focused, accented field
  with lookup progress in its placeholder.
- **Once the area is declared, black out everything but the AO.** The globe
  ceases to exist outside the selected portion — the Battlefield tab's
  behaviour. **This already exists and is directly reusable:**
  `frontend/src/lib/clipping.ts` — `applyGlobeClipping(viewer, rectangle)`
  builds a `ClippingPolygonCollection` with `inverse: true`, clipping everything
  outside the rectangle; `clearGlobeClipping` undoes it. Called from
  `BattlegroundSelectorPage.tsx:269,391,412`, cleared at `:365`. The
  route-studies page never adopted it and sets only a zoom cap.
  - Caveat already documented in that file: clipping is skipped below a 100 m
    diagonal (`MIN_CLIPPING_DIAGONAL_METERS`) because float32 precision in the
    clipping shader blanks the globe. An AO is ≥10 km a side, so this never
    applies here.
- **Remove the 2D/3D toggle — always 2D.** `toggleSceneMode` in
  `hooks/useMapControls.ts` (Cesium `morphTo2D`/`morphTo3D`) and its button in
  `components/globe/MapControls.tsx`.
- **Add a camera-angle tool so depth still reads.** Note `useMapControls`
  already carries an unused `toggleElevation` — vertical exaggeration (2.5×)
  plus a camera-tracking headlamp light. Directly relevant.

### Step 2 — create the road graph

- **Draw every detected road as a black line.** Roads are currently never
  rendered: the graph is fetched and held in state, but only *corridors* get
  polylines (`hooks/useCorridorEntities.ts`). This is a new overlay.
- **Allow the operator to add roads.**
- **Road naming on a theme.** Auto-assigned names must be **two syllables** —
  `FALCON`, `COBRA`, `RAVEN`, `KESTREL` — so a road can be called unambiguously
  over voice. **The operator picks the theme per AO** from a built-in set (birds
  of prey, big cats, weather, trees), so roads in adjacent AOs stay
  distinguishable. Names are drawn from the chosen list in sequence without
  collision, and every one stays operator-editable.
- **Road coding**, confirmed grammar (see [`DOCTRINE.md` §4](DOCTRINE.md)):

  ```
  KRANJI(4 X)     single carriageway, all-weather heavy
  BKE(6// X)      dual carriageway, all-weather heavy
  MANDAI(2 Z)     single carriageway, fair-weather only
  ```

  Width `2`/`4`/`6` with `//` for dual carriageway; type `X` all-weather heavy,
  `Y` all-weather limited, `Z` fair-weather. **Pre-filled from extracted data**
  (OSM `lanes` and highway class) and **always operator-editable** — the
  extraction is a starting point, never an assertion.

### The road graph becomes mutable

**Decided: the graph is mutable.** Terrain updates — a bridge blown, a road
newly found — must be applicable to an existing AO without re-ingesting it.

This reverses the current design. `operational_areas` rows are written once and
never updated (`services/operationalAreaStore.ts`, "a row that exists is a row
that routes"), and that immutability is what makes studies reproducible and
corridor ids stable.

**Keep both properties with revisions.** Each mutation produces a new graph
revision on the area; a study records the revision it ran against. Reproducibility
survives — a study can always say which ground it was computed over — and a
study whose revision is behind can be flagged stale rather than silently wrong.

Consequences to handle deliberately:

- **Corridor ids change when the graph changes.** `_corridor_id` hashes sorted
  edge ids. This is *correct* here — a blown bridge really does change the
  corridors — but operator renames (`corridorEdits`) and learned preference
  (`course_feedback`) attach to those ids. **Decided: re-attach by geometry** —
  match corridors across revisions by shared ground and carry both onto the best
  match.
  - Risk to mitigate: a bad match silently attaches a name, and a learned
    weight, to the wrong approach. Needs a similarity floor below which nothing
    is carried rather than a nearest-match-always rule, and the re-attachment
    should be visible to the operator rather than silent.
  - Scope note: this applies to **corridor** names only. **Axis** names are
    durable by construction — they hang off road identity and survive both
    splits and destruction — so they are never re-attached and never lost.
- **Breaking a portion of an axis, not just a whole edge.** The operator selects
  a stretch along an axis and breaks it. That splits the edge into three —
  before, broken, after — inserting new nodes at the two cut points. Today
  `edgeOverrides` works at whole-edge granularity only, so a bridge halfway
  along a long edge cannot be expressed.
- **Destruction is a state change, never a deletion.** A revision marks an axis
  destroyed; it does not drop it. `PROTON` destroyed is still `PROTON`, so the
  operator can ask how its loss reshaped the theater — and comparing corridor
  shape across revisions is the point of keeping it.
- **Names attach to road identity, not to a segment.** A partial break splits one
  edge into three, all still `PROTON`, with only the middle destroyed. A name
  held against an edge would be lost or triplicated by that split. So the name
  lives on a road/way id and segments reference it. This also means axis names
  are durable across revisions by construction, and need no re-attachment.
- **Operator-added edges need synthetic ids** that cannot collide with the
  OSM-derived `wayId:index` scheme — and so do the segments produced by a split.
- **Two different kinds of "impassable" now exist, and they must not be
  conflated:**

  | Kind | Meaning | Level |
  |---|---|---|
  | Terrain fact | The bridge *is* down | Area / graph revision |
  | Study assumption | *What if* we drop this bridge | Study — the existing `edgeOverrides` |

  The first changes the ground for every study over that AO. The second is one
  study's hypothesis. Today only the second exists.

**Also needed:** `GraphEdge` has no `name` field, and OSM `name` and `lanes`
tags are fetched by Overpass then discarded at `services/roadGraph.ts:96`.
Both are required for naming and for pre-filling the road code.

---

## B. Corridors — correct the grouping rule

Engine only, and far smaller than first scoped. See
[`DOCTRINE.md` §4](DOCTRINE.md).

### The correction

**A corridor is a bundle of axes** — the set of axes forming one approach, from
the same place to the same place through the same gap. An axis is one route.

The engine's bug is not that it looks at roads. It is that
`cluster_into_corridors` (`engine/athena/corridors.py`) groups by
**shared edge length**, so it bundles only axes that literally overlap on the
same roads. Two parallel roads a couple of kilometres apart through the same gap
share no edges at all, so they emerge as two corridors when they are one. A lone
axis with nothing to join becomes its own "corridor", overstating the number of
approaches.

### Scope reversal

Two earlier decisions are **withdrawn**:

- ~~A corridor is a polygon of trafficable terrain~~ — no. The corridor is the
  bundle of axes; terrain only decides which axes group together.
- ~~Build an operational trafficability raster and extract bands from it~~ — no.
  **Only roads and axes are considered.** No landcover, no cost surface, no
  off-road analysis.

Consequently **dropped** from this group: the trafficability raster, the
`/api/operational-area/:id/terrain` endpoint, the ESA WorldCover wiring to
operational areas, band extraction, and the numpy/scipy dependency. None are
needed.

Node elevation stays as it is — sampled at road nodes, used for gradient in
movement rate. That is a property of the axis, not terrain analysis.

### What actually changes

Replace the grouping rule in `cluster_into_corridors`. Axes belong to the same
corridor when they are:

1. laterally close — small straight-line separation
2. ~~directionally aligned — running the same way~~ **Done** — the engine now
   compares start-to-finish travel headings against a configurable 45° limit;
   crossing routes and routes moving in opposite directions remain separate.
3. laterally connected — network distance of the same order as straight-line
   separation

Criterion 3 does the separating, and needs no terrain: two axes across a
reservoir satisfy 1 and 2 but fail 3, because the network has to go around.
Absence of roads *is* the obstacle.

Shared edge length is removed as the criterion. `route_similarity` and
`CORRIDOR_SIMILARITY` (`engine/athena/params.py`) go with it.

### Knock-on

- **Corridor ids.** `_corridor_id` hashes the sorted edge ids of a corridor's
  routes, and operator renames plus the learned preference feedback attach to
  that id. Changing the grouping changes the membership and therefore the ids —
  existing `corridorEdits` and `course_feedback` rows will not match. Needs a
  deliberate decision, not an accident.
- **Choke points.** A choke exists only where every axis in the corridor crosses
  the same ground. Where axes share nothing, the corridor has no single choke
  and must be held axis by axis — which is exactly why coverage beats
  concentration in group D.
- **Inlets.** Each axis is an inlet, its own way in. This is the unit the block
  pass allocates against.

## C. S2 — the reserve model

Sourced from *SAF Training Aggressor 2016*, section 3 (pp. 56–65). The current
`Mark` (`id`, `name`, `lon`, `lat`, `bbox?`) is far too flat for what the
doctrine defines.

### Fields to add

- ~~**Level**, on a fixed escalation ladder~~ **Done** — reserve marks now carry
  an optional fixed K–K4 level; the K-serials are levels of
  commitment, not timestamps:

  | Serial | Commits |
  |---|---|
  | K | Outside Activities |
  | K1 | Local Reinforcement |
  | K2 | Coy Res |
  | K3 | Bn Res |
  | K4 | Div Res |

- ~~**Designation** and owning formation~~ **Done** — the mark's backward-compatible
  `name` is its designation, with a separate owning-formation field.
- ~~**Intelligence status — assessed vs confirmed**~~ **Done** (p.56), with a hard rule:
  - *Assessed* (pink) — Int Assessment only
  - *Confirmed* (red) — two or more sources from collection agencies
    (Bde RSTA / Bn Scout / UAV)

  Nothing in the current model carries this. Arguably the most important S2
  attribute on a mark.
- ~~**Composition as a task organisation**, not a strength integer.~~ **Done** —
  reserve records now hold ordered formation elements, fixed echelons,
  fractional-third modifiers, and structured full-establishment platform counts.
  `Div Res 1` =
  `ABG(-)` + `DRB(-)`, "both task organised as Div Res 1". Splittable:
  `Div Res 1A` = **Anvil** force (`DRB(=)`), `Div Res 1B` = **Hammer /
  Destruction** force (`ABG(-)` + `DRC`), with an explicit **order of move**
  (DRC leads the convoy, then ABG(-)). Platform counts as in the doc's
  `10 x BTR-90`, `9 x 120mm 2B11 Mortar`.
  - **Modifiers are fractional thirds** — each stroke is one third of
    establishment, so `(=)` (two minus strokes) is 1/3, `(-)` is 2/3, `(+)` is
    4/3. Strength is therefore computable from establishment × modifier.
  - **Echelon must never be inferred from strength.** A Coy(=) holds a platoon's
    manpower but is still a company, because the company HQ is present. Anything
    deriving echelon from headcount will misread every reduced formation. See
    [`DOCTRINE.md` §1](DOCTRINE.md).
- ~~**Location as a named terrain reference**~~ **Done** — reserves and
  objectives carry an operator-editable IVO/locality field, auto-suggested from
  the shared place lookup without overwriting operator text.
- ~~**Timing model** (p.62), the largest single gap:~~ **Done** — reserve
  records accept operator-supplied decision, readiness and deployment stages,
  normalized to minutes without invented level defaults. Athena calculates
  commencement from decision + readiness and task completion from commencement
  + routed movement + deployment for every reserve/corridor pairing. Incomplete
  intelligence remains visibly incomplete rather than silently becoming zero.

  > K2 is commencement of movement *(inclusive of Decision Time and Readiness Time)*
  > K2+½ is completion of the Reserve Task *(inclusive of Movement Time and Deployment Time)*

  **Decision + Readiness → commences move; Movement + Deployment → task
  complete.** The engine today computes *only* Movement Time, from routing. The
  other three are doctrinal per-level values. This is what makes "can I block
  this reserve before it arrives" answerable.

  Time units differ by level in the source: Coy Res in minutes, Bn Res in
  fractions of an hour.

### Drop posture — done

~~Remove `posture` from `EnemyIntent`.~~ The enemy is assumed to have control over
whatever objective the operator designates. Touches:

- `engine/athena/intent.py` — `Posture` enum and the `posture` field
- `engine/athena/eca.py:143` — the `Posture:` prompt line
- `server/src/db/studyTypes.ts:116`, `server/src/routes/routeStudies.ts:86`
- `frontend/src/lib/courses.ts` — `POSTURE_LABEL`, `POSTURE_ORDER`, and the
  emptiness check at `:59`
- `frontend/src/components/panels/EnemyCoursesPanel.tsx:77-83` — the selector,
  and the help text at `:129`

(Note: `frontend/src/types/movement.ts` also has a `Posture` — `prone` /
`crouch` / `upright`. Unrelated, leave alone.)

**`objective_ids` stays as-is.** Only `posture` is removed. The operator keeps
the ability to say which objectives the enemy contests (`toggleIntentObjective`),
so `EnemyIntent` becomes `{ objective_ids, narrative }`.

### Overlay mapping

The doc's three overlays map onto passes that already exist — this is the
battle-procedure fit:

| Overlay | App pass |
|---|---|
| Deployment | marks / reserves (Step 3) |
| Enemy Conduct of Battle | courses of action (Step 6) |
| Enemy Reaction to Ops Plan | block forces (Step 8) |

Colour semantics are **overlay-scoped**: assessed/confirmed is pink/red on the
Deployment overlay, while on the Conduct of Battle overlay colour encodes
reserve level instead (Coy Res orange, Bn Res pink, Regt Res brown).

---

## D. S3 — the force model

- **A clear ORBAT of the current unit.** The model is already correct —
  `parent_id` hierarchy, `orbatRows()` flattening the tree into depth-ordered
  rows, plus `descendants`, `ancestors`, `validParents`, `commitsWith` in
  `lib/orbatTree.ts`, mirrored by the engine's validated `Orbat`. Today
  `OrbatPanel` spends that structure on a `parent_id` dropdown rather than
  drawing the tree. Presentation work over existing machinery.
- **REDCON status** per unit. New field — orthogonal to `availability`
  (`uncommitted` / `committed` / `reserve`), which is a *commitment* axis where
  REDCON is a *readiness* axis. A unit can be uncommitted and REDCON 4. Touches
  frontend type, server `studyTypes`, engine `Unit` (adding an optional field
  to that frozen pydantic model is safe).
  - **Display only.** It does not constrain block-force allocation and does not
    feed a timing model. Shown on the ORBAT; the judgement stays with the
    operator.
- **The block force's ORBAT.** `BlockPlan.allocation` is a flat
  `{corridor_id, unit_id, unit_name, distance_meters}` list. The block force as
  an ORBAT is that grouped by corridor and resolved back against the tree —
  task organisation rather than an allocation table. Derived view; all the data
  is already in the response, no engine change.
- **Remove the echelon ceiling entirely.** There is no largest-formation-per-route
  rule. This is the one change so far that needs a **database migration** —
  `ceiling` is a real `text` column on `route_studies` (`db/schema.ts:102`), not
  a jsonb field. Impact is wide but shallow:
  - engine — `blocking.py:102,106,109,148`, `service.py:124,131`; `fits_within`
    in `units.py:59` becomes dead
  - server — `db/schema.ts:102`, `routes/routeStudies.ts:80,207,265,296,304,315,318`,
    `services/engineClient.ts:84,104`
  - frontend — `BlockForcePanel.tsx:4,11,14`, `fitsWithin` in `lib/orbatTree.ts:45`,
    `ceiling`/`setCeiling` in `state/routeStudy.ts`, and the types
- **Change the allocation objective to coverage of every inlet.** Priority is a
  force at *every possible inlet* — each axis is its own way in, so a corridor of
  four axes needs four block positions. Sufficiency is explicitly **not** the
  constraint: we do not require enough at an inlet to destroy what comes down it.
  Today `plan_blocks` is greedy — quickest corridor first, nearest unit by
  straight-line distance, nothing spent twice — which can leave an inlet bare
  that only a distant unit could have held. Maximise inlets held; never strip one
  inlet to reinforce another.
- **Measure block forces in weapons, not manpower.** `strength: int` is a
  headcount (defaults 90/24/7/4) and says nothing about what a force can stop.
  What matters is how many weapons can defeat the reserve's platforms. Replaces
  `strength` on `BlockCandidate` as the ranking quantity.
- **Sealing becomes computable, and non-binary.** With F's structured
  composition and pairing table, block force effective weapons vs reserve
  platforms yields exactly the outcome chain from the Reaction to Ops Plan
  overlay — destroyed at the block, delayed and attrited, or passed. See
  [`DOCTRINE.md` §5](DOCTRINE.md). This is what makes the next item real rather
  than decorative.
- **Reaction outcomes on the block pass.** Per the Reaction to Ops Plan overlay
  (p.63), the doctrinal output per reserve is: commenced D 2100 → contacted by
  block force D 2115 → *delayed ½ hr and attrited from 1 x RRC to 1 x RRP* →
  remnant continued → reached objective D 2200. Today `BlockPlan` says only
  which unit covers which corridor.

---

## E. Document ingestion

**Operators upload a set of documents and the engine pieces together theater
context** — where each force has captured to, locations of reserves, and
surrounding context.

Connections to the rest of the work:

- Extracted location references need to resolve to coordinates — the same place
  lookup as A's AO auto-naming and C's IVO/locality field. One capability,
  three consumers.
- Extraction output should populate C's reserve record directly.
- **The two-source rule becomes computable.** If two independent documents
  report the same reserve position, that reserve is *Confirmed* rather than
  *Assessed*, exactly as p.56 defines it. Document count is the evidence.
- Operator review before extraction becomes marks — extraction proposes, the
  operator confirms.

### Constraints

- **Uploaded content is untrusted.** It must be treated as data and never as
  instructions to the model. The codebase already has the right pattern:
  `eca.py:ground_courses` rejects model output referencing corridors or
  reserves that do not exist in the study, and surfaces the rejections rather
  than swallowing them. Document extraction should be grounded the same way.
- **Material sent to a hosted model provider leaves the machine.** The engine
  resolves `ATHENA_MODEL` as `provider:name` with a single `PROVIDER_API_KEY`
  (`engine/athena/params.py`), so uploading RESTRICTED training material means
  sending it to that provider. The courses-of-action pass was deliberately made
  model-agnostic (commit `109e448`), so pointing at a locally hosted model is a
  change of environment, not of code.

---

## F. Targeting — weapon-to-target matching

Pair a weapon to a target so the required **effect** is achieved without waste.
Three inputs: target hardness, effect required, weapon characteristics. See
[`DOCTRINE.md` §5](DOCTRINE.md) for the effects, hardness classes and the
pairing table, and §6 for the platform catalogue.

- **Platform catalogue** as reference data — platform name → type → hardness,
  seeded from the aggressor ORBAT (BTR-90 hard skin light, Truck soft skin, and
  the weapon systems: DRAGON ATGM, SPG-9, RPG-16/22, AGS-17 AGL, NSV HMG, 2B11
  and 81mm/60mm mortars, SA-16 MANPADS, Dragunov).
- **Hardness is a property of the platform, never typed per unit.** Looked up
  from the catalogue.
- **This settles an open question under C.** Unit and reserve composition must
  be structured as `count × platform`, not free text — otherwise weapon matching
  has nothing to match on. `9xBRT` becomes `{count: 9, platform: "BTR-90"}`.
- **Matching pass** — given a target's hardness and the effect required, return
  which of the force's weapon systems can achieve it, which are acceptable, and
  which would be wasteful or ineffective. Natural home is the engine, alongside
  the block-force pass, since both answer "what can I put on this".
- Nothing in the engine models weapons or platforms today. `engine/athena/units.py`
  covers echelon and command role only; `strength` is a bare integer.

### Attrition — the arithmetic downstream of matching

Matching is a gate (*can* this weapon defeat that target); attrition is the
quantity question that follows (*how much* of the force is left). They must not
be conflated — rifles do not become effective against armour by being numerous.

- **No casualty percentages.** Attrition is expressed as **composition
  reduction**, in the notation of `DOCTRINE.md` §1: `RRC(-)` reduced by a third,
  `RRC(=)` by two thirds, `RRP` when the loss goes far enough to take the HQ and
  genuinely drop an echelon. This is how the source records it — *attrited from
  1 x RRC to 1 x RRP*.
- The calculation is therefore **deterministic and needs no supplied figures**:
  effective weapons counted against reserve platforms, the shortfall continues.
- This reproduces the Reaction to Ops Plan outcome chain directly, and keeps the
  output inside vocabulary already in use.

---

## Shared capability: place lookup

A server-side, Overpass-backed named-place lookup now exists. It returns the
nearest named settlement/locality plus its `place=*` kind, coordinates, and
distance, giving all three consumers one vocabulary:

1. A (Step 1) — auto-title the AO from location data
2. C — the IVO / locality field on reserves
3. E — resolving location references extracted from documents

Implemented with a bounded Overpass `place=*` query, reusing the existing
identified mirror pool and failure handling. AO titles are the first consumer;
the reserve IVO and document-location consumers remain to be wired.

---

## Housekeeping

- ~~`Training Aggressor_v8.pdf` sits untracked in the repo root and is not
  gitignored.~~ **Done** — `*.pdf` added to `.gitignore` and verified. Blanket
  rule; narrow it if a PDF asset ever needs committing.

---

## Open questions

One remains, and it blocks nothing.

| # | Question | Blocks |
|---|---|---|
| 1 | Local weapon designations for `DOCTRINE.md` §7 | Nothing — capability-generic names are the working set |

## Settled

**Ground and corridors**

- A corridor is a **bundle of axes** — not one axis, and not a polygon of terrain.
- **Only roads and axes** are considered. No landcover, no trafficability
  surface, no numpy/scipy. The road network already encodes the obstacles.
- Grouping is lateral proximity + directional alignment + lateral connectivity;
  shared edge length is removed as the criterion.
- Each axis is an **inlet** — its own way in.
- The road graph is **mutable**, with revisions so studies stay reproducible.
- **Destruction is a state change, not a deletion** — a destroyed axis keeps its
  name so its effect on the theater stays askable.
- **Axis names hang off road identity**, so they survive splits and destruction
  and never need re-attaching.
- A break may be applied to **a portion of an axis**, splitting it into before,
  broken and after.
- Corridor renames and learned preference **re-attach by geometry** across a
  revision, with a similarity floor and visible re-attachment.

**Roads**

- Code grammar confirmed: `KRANJI(4 X)`, `BKE(6// X)`, `MANDAI(2 Z)`.
  Pre-filled from extraction, always operator-editable.
- Names are **two syllables**, drawn from a theme the **operator picks per AO**.

**Shell**

- Once the AO is declared, the globe is **blacked out** outside it — reuse
  `lib/clipping.ts`, which already does this.
- Top bar deleted; right sidebar segmented **Ground / S2 / S3**, Ground neutral.
- Always 2D, with a camera-angle tool for depth.

**Force and echelon**

- Own force is a **light battalion** — `DOCTRINE.md` §7.
- Composition is **structured** `count × platform`, for own force and enemy alike.
- Modifiers are **fractional thirds**: `(=)` 1/3, `(-)` 2/3, `(+)` 4/3.
- **Echelon is defined by the HQ, never inferred from strength.** A Coy(=) is a
  company.
- The echelon **ceiling is removed** — no largest-formation-per-route rule.
- REDCON is **display only**.

**S2 and blocking**

- `posture` dropped from `EnemyIntent`; **`objective_ids` stays**.
- Block forces are measured in **weapons, not manpower**.
- Allocation maximises **coverage of every inlet**; sufficiency is reported,
  not optimised for.
- Weapon-to-target matching gates what counts as effective at an inlet.
- **Attrition is composition reduction, not casualty fractions.** No percentages
  anywhere; the calculation is deterministic and needs no supplied figures.

## Order

**B first, then A**, then the rest. Fix the corridor model before building UI
that renders corridors.
