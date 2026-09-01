# Engine-side changes Athena needs

Each item says what breaks today, what the fix is, and what it would cost.
Ordered by how much the product suffers without it.

Per `engine/AGENTS.md`, any of these that changes engine behaviour or modelling
assumptions must also be written into `engine/ENGINE.md`, which needs explicit
human approval.

## Status

| # | item | state |
| - | ---- | ----- |
| 1 | Tick budget cannot cross the ground | **done** — multi-cell movement on a terrain-cost allowance |
| 2 | Per-unit vision range ignored | **done** — cap raised, terrain rendering bounded separately from detection |
| 3 | Objectives parsed and thrown away | **done** — `athena/hosted/orders.py` |
| 4 | Routes and movement types never reach the engine | **done** — routes as an axis of advance, gait sets the movement allowance |
| 5 | Fortifications are soldiers, not works | **done** — a Trench terrain class delivered as per-cell overrides |
| 6 | Import diagnostics computed but never surfaced | **done** — reported on submit |
| 7 | No batch list endpoint, so no simulation history | **done** — engine + service + page |
| 8 | H-hour and weather dropped | **done for daylight** — night halves vision; weather beyond that is still out |
| 9 | A replay is ~17 MB, almost all the same battlefield | **done** — outcomes ride the completion event, and schema 4 drops `surface` |

`engine/ENGINE.md` has been updated for all of the above.

## Done since: making the answer trustworthy

- **Suppression and ammunition.** A soldier under fire shoots at 35% of its
  normal chance for one tick, and a magazine is thirty rounds with a one-tick
  reload. Measured on the same 28-soldier scenario: before, 68 shots / 66 hits
  over five ticks with one side annihilated; after, 95 shots / 45 hits over nine
  ticks with a decided winner and survivors on both sides.
- **Seeded runs.** Every random draw comes from a seed derived from the batch id
  and the simulation index, reported with the outcome. A win rate now carries a
  95% Wilson interval.
- **Commander succession.** A section whose commander is killed promotes its
  lowest-indexed living member before it is next asked to decide.
- **Recorded reasoning.** Every agent turn carries a short rationale, recorded
  per tick in the replay and surfaced on the conclusion page.

## Done since: making a long approach affordable

Forces drawn far apart could not be simulated: at a fighting pace the approach
outran any tick budget, and every tick of it was a model call spent walking.

- **Contact-dependent movement.** A soldier with no living enemy in vision range
  and no incoming fire marches; otherwise it moves at its gait.
- **Event-driven decisions.** A commander gets a model call when its situation
  signature changes, when it has never been asked, or on a heartbeat. Otherwise
  it advances along its drawn axis (out of contact) or repeats its last decision
  (in contact).
- **Routes as data.** Waypoints and the objective are projected onto the soldier,
  so a standing order has something concrete to execute rather than prose in a
  prompt.
- **Fan-out around blocked bearings**, because a section all pushing one way
  jammed itself and stood still for an entire run.

Measured, 28 soldiers 135 m apart over 120 ticks: 3,360 calls under the old model,
105 made. The same plan now fights instead of stalling.

## Done since: making the agents competent, and the plan checkable

Watching a run showed both a routing failure and a reporting one.

- **Distance-field routing.** Deterministic movement was greedy — bearing plus a
  couple of offsets — which cannot get round an obstacle. A river across the axis
  stopped a whole force at the bank, where it stood and traded fire across the
  water for the rest of the run. Movement now follows a breadth-first distance
  field computed once per target.
- **Stall detection.** A standing order that stops making progress now counts as
  a change of situation and hands the decision back to the agent. Previously
  nothing changed, so nothing was asked, and the scaffolding decided the battle.
- **Reachability, checked before the batch.** The run above was not a hard plan,
  it was an impossible one: the objective was on the far side of a river with no
  crossing anywhere on the ground. `POST /v1/payload-diagnostics` answers that
  for free and instantly, and the run dialog refuses to let it pass silently.

## What is still open

- **Weather beyond daylight.** Exported visibility runs to thousands of metres,
  far past any vision range, so only `isDay` is modelled.
- **Re-running a specific seed.** Seeds are recorded and reproduce a run inside
  the engine, but a batch cannot yet be re-submitted with a chosen seed from the
  UI, so reproduction is not operator-reachable.
- **No user model.** Anyone who can reach the service reads any plan by id.
- **No component or E2E tests.** The frontend suite is pure logic; nothing
  renders a component.
- **Formation.** A section moves as a loose blob that fans out when blocked.
  There is no bounding overwatch, no fire-and-manoeuvre, no spacing doctrine —
  the thing a viewer most readily reads as "they are not moving like a platoon".
- **A standing order can still be stale by up to the heartbeat.** Twelve ticks is
  a guess; nothing has measured what an operator would consider responsive.
- **Calibration.** Every constant here — terrain profiles, the range curve, gait
  budgets, the suppression multiplier, the night multiplier — is a chosen
  assumption. Nothing validates the model against anything external.

---

## 1. Tick budget cannot cross the ground — the run ends before contact — **DONE**

> Fixed by multi-cell movement. A `MoveAction` now carries a distance, and the
> move is walked cell by cell: entering a cell spends its `move_cost` against a
> per-tick allowance, and the walk stops at the first cell that cannot be
> entered rather than rejecting the whole move. The allowance comes from the
> route's gait, which is also what finally gives `move_cost` an effect.
>
> Measured on the same ground: two forces drawn **40 m apart**, fifteen ticks.
> Before, blue advanced one cell a tick and never arrived. After, blue covered
> seven cells a tick, closed in six ticks, and fought at the objective — seven
> shots, three hits, casualties on both sides. Original text follows.

**Severity: blocking.** This is why most batches come back `inconclusive`.

Cells are one metre and a soldier moves one cell per tick, so 60 ticks moves a
soldier 60 m. Selections run to 800 m a side. Two forces drawn 300 m apart never
meet inside any reasonable tick budget, and the batch reports "both sides alive"
— which reads as a modelling failure but is just the clock.

`engine/athena/demo.py` already works around exactly this: it discards the
export's own laydown and hand-places six Blue against two Red *twelve metres
apart*, because the real laydown "spreads seven echelons up to 240 cells apart,
so the two sides never make contact" (its own docstring).

Options, cheapest first:

- **Multi-cell movement.** Let `MoveAction` carry a distance, or resolve a move
  as N cells along a direction with per-cell legality. One tick becomes a bound
  rather than one metre. Touches `MovementResolver`, the conflict resolution in
  `LoopEngine._resolve_move_destinations`, and the prompt's "Moving more than one
  grid cell" illegality line.
- **Coarser cells.** Have the loader downsample the imported grid, e.g. 5 m
  cells. Cheap, but it also multiplies vision range in cells and changes what
  opacity per metre means — `TERRAIN_PROFILES` is calibrated to one-metre cells.
- **Start-of-run closure.** Advance both sides toward each other before tick 1.
  Fastest to build, least honest: it discards the commander's drawn deployment,
  which is the thing being evaluated.

Until this lands, the frontend warns the operator when over half of a batch came
back inconclusive (`SimulationModal`).

---

## 2. Per-unit vision range is ignored — **DONE**

> Done the expensive way the note below argues for, not the cheap way the
> original text proposed. The vision cap is raised to 600 so an ORBAT range
> survives it, and `visionRangeM` reaches each soldier. Terrain *rendering* is
> bounded separately by `MAX_RENDERED_TERRAIN_RADIUS` (12 cells), which is what
> keeps the scan and the prompt from exploding — the map an agent reads is small
> while its detection is not.
>
> Detection itself is unbounded within vision range, and a soldier may engage
> anything it sees. That is safe because the rifle now has a range falloff: the
> base probability holds to 50 m, decays to a 5% floor at 400 m. An earlier pass
> bounded engagement to the drawn map instead, as a workaround for a hit model
> with no range term; the range model replaced it. Original text follows.

`build_battlefield_from_payload(payload, vision_range=...)` takes **one** vision
range for the whole battlefield and applies it to every soldier, defaulting to
`DEFAULT_SOLDIER_VISION_RANGE` (10.0). `run_simulation` never passes the
argument, so every hosted soldier sees 10 m.

Athena's ORBAT models this per establishment — a Recon Section is 500 m against a
Rifle Section's 300 m (`frontend/src/types/orbat.ts`) — and the plan brief
already carries it as `establishment.visionRangeM`. None of it reaches a soldier.

**Fix — and it is not the cheap one this originally described.** Adding an
optional `visionRangeM` to `PayloadUnit` is five lines, and it would be a lie.
Three things block it:

1. `VisionResolver.is_in_vision_range` clamps to `MAX_VISION_RANGE` (100.0), so
   Recon's 500 m and a Rifle Section's 300 m both silently become 100.
2. `LoopEngine.nearby_terrain_map` scans `(2r+1)²` cells per soldier per tick,
   each with a sightline walk. r=10 is 441 cells; r=100 is 40,401.
3. `context_view` renders every visible cell into the prompt as two character
   grids. The perf work measured 313 visible cells at ~1,360 input tokens; at
   r=100 the bounding box is 201×201, which is roughly 20k input tokens per
   soldier per tick.

So the honest change is to the observation channel first: keep the drawn map to a
near window and give long-range vision a separate summarised form — "enemy
contact, bearing NE, ~180 m" — on `ObservedSoldier`. Then per-unit vision means
something. Do that before adding the field, not after.

Note the unit mismatch: ORBAT vision is **metres**, the engine's `vision_range`
is **cells**. At one-metre cells they coincide today; if item 1 is solved by
coarsening cells, this needs an explicit conversion.

---

## 3. Objectives are parsed and thrown away — **DONE**

> Implemented in `engine/athena/hosted/orders.py`. `run_simulation` wraps its
> chooser so each soldier receives orders built from the payload: an objective
> its side owns is "move to it and hold it", one the other side owns is "stop
> them holding it", and a side with no objective keeps the compass default.
> `PayloadObjective` gained `side`, and the terrain service sends it.
>
> Measured on the same ground, five soldiers, fifteen ticks: without orders both
> sides walked apart on the east/west default and fired **0 shots**; with a drawn
> objective they closed and fired, one blue casualty. Original text follows.

`fetch_plan` and the payload loader both populate `payload.objectives`, and
`objective_briefing()` renders them as grid coordinates. Nothing calls it on the
hosted path — only `demo2.py` and tests.

So a commander marks OBJ BRAVO, and every hosted soldier is told the default:
*"Blue: advance toward the right/east side of the battlefield."*
(`DEFAULT_TEAM_OBJECTIVES` in `params.py`.) The objective they drew has no effect
on behaviour.

**Fix:** in `run_simulation`, build team objectives from the payload's objectives
and pass them through `partial(choose_action, team_objectives=...)`. The
machinery already exists — `choose_action` accepts `team_objectives`, and
`demo2.py` shows the pattern, including differing objectives per side. The only
open question is which team owns an objective; the engine currently calls that "a
scenario decision", so the payload needs a `side` on each objective, or the
convention that objectives belong to Blue.

---

## 4. Routes and movement types never reach the engine — **PARTLY DONE**

> The plumbing half is done: `PayloadUnit` gained `route` and `movementType`, the
> terrain service sends the drawn arrow (inherited by every soldier expanded from
> the marker), and `orders.py` renders it as an axis of advance in cell
> coordinates, thinned to six waypoints. Gait becomes a line of guidance.
>
> The modelling half landed too, with item 1: a gait now sets the soldier's
> per-tick movement allowance (prowl 2.0, patrol 5.0, charge 8.0), and
> `move_cost` is what that allowance is spent on, so the same allowance buys six
> cells of road or two of wetland. Original text follows.

A commander draws a movement arrow with a type (`prowl` / `patrol` / `charge`)
and a carried-load loadout. `PayloadUnit` has no route field and the engine has no
concept of a planned path, so the arrow is decoration: soldiers pick their own
direction from the prompt's compass objective.

This is the largest gap between what the UI lets a commander express and what is
actually simulated.

**Fix** is genuinely new modelling, not plumbing — a waypoint or axis-of-advance
the agent is told to follow, and some notion of posture affecting speed or
detection. Worth designing rather than bolting on. Related: `move_cost` is in
`TERRAIN_PROFILES` but "has no effect today" (`ENGINE.md`), so movement type has
nothing to modulate yet either.

---

## 5. Fortifications are soldiers, not works

`trench` and `preparedTrench` markers are ground, not troops. The engine has no
representation for field works, so the server currently sends each as **one
soldier** standing on that cell — a defender in the trench. That soldier gets no
protection bonus from the trench, because protection is a property of the
terrain class and the class is whatever the classifier decided.

**Fix:** let a payload override a cell's terrain class or protection value, so a
prepared trench raises the protection of the cells it covers. The plan brief
already computes the objective/route footprints that would be needed to express
which cells are involved.

Until then, a plan whose defence is entirely trenches is under-modelled — the
works do nothing.

---

## 6. Import diagnostics are computed but never surfaced — **DONE**

> `import_diagnostics()` in the payload loader now runs at payload validation in
> `hosted/api.py`, exactly where this text suggested, and the count rides out on
> the 202 response through the terrain service to the run dialog. Reported rather
> than rejected: a steep import is still runnable and how much blocked ground is
> too much is the operator's call. Original text follows.

`count_unclimbable_transitions()` counts adjacent cell pairs a soldier cannot
step between after real elevation is rounded to integer metres. `ENGINE.md`
states the engine "reports how many such steps a given import contains rather
than smoothing them" — but nothing on the hosted path calls it. It has only test
callers.

A steep import therefore manifests as agents that mysteriously cannot advance,
which is exactly the failure the function was written to pre-empt.

**Fix:** call it in `run_simulation` (or at payload validation in
`hosted/api.py`, which is better — it fails the submission rather than a hundred
workers) and return the count so the operator sees it before spending a batch.

---

## 7. No batch list endpoint, so there is no simulation history — **DONE**

> The engine stores each run's outcome (`simulations.outcome`) and serves
> `GET /v1/simulation-batches` and `GET /v1/simulation-batches/{id}`. The terrain
> service keeps only the batch → plan mapping the engine cannot know, and joins
> the two on read; the Simulations nav item is a real page. Original text follows.

The engine exposes `POST /v1/simulation-batches` and
`GET /v1/simulation-batches/{id}/events`. There is no way to ask "what batches
exist" or "what were the results of batch X" after the stream has been consumed.
Postgres holds all of it (`simulation_batches`, `simulations`,
`simulation_events`).

Consequence: the Simulations nav item in the frontend is still a dead stub, and
closing the browser loses a completed batch's results.

**Fix:** `GET /v1/simulation-batches` (paginated) and
`GET /v1/simulation-batches/{id}` returning stored per-simulation status plus
fresh presigned replay URLs. Both are reads over tables that already exist.

---

## 8. H-hour and weather are dropped

The plan carries a mission start (`hHour`) and the battleground carries weather.
`build_battlefield_from_payload` documents ignoring weather deliberately —
exported `visibilityM` is in the thousands, far beyond any vision range, and a
night penalty is "a balance decision rather than a loading one".

That reasoning holds for weather. It does not cover `isDay`: a plan drawn for an
0300 approach simulates identically to a midday one, which makes the Mission
Window panel purely decorative.

**Fix:** accept an optional day/night flag in the payload and apply a vision
multiplier. Needs a balance decision on the multiplier first.

---

## 9. A replay is ~17 MB, almost all of it the same battlefield

`ReplayBattlefield.surface` is one JSON object per cell. On an 800×800 ground:

| part | size |
| ---- | ---: |
| `surface` | 16.0 MB |
| `terrain_classes` | 1.3 MB |
| all 60 steps | 0.2 MB |
| **per replay** | **17.4 MB** uncompressed |

The battlefield is byte-identical in every run of a batch, so a 100-run batch
writes ~1.7 GB of which ~1.69 GB is the same grid repeated.

**Fix 2 is done; fix 1 is still open.**

1. **Open.** Drop `surface` from the replay. It is recoverable from the terrain
   grid the client already holds, and it is ~92% of the payload.
2. **Done.** The outcome is in the `simulation.completed` event —
   `RunOutcome` in `hosted/runner.py`, computed where the run ends. Nothing
   fetches a replay to compute a win rate any more; the terrain service's
   `summarizeRun` fetch remains only as a fallback for batches queued by an
   engine that does not report outcomes. Replays are read only when someone
   opens a specific run.

---

## Not a change, but worth knowing

**`fetch_plan` trusts an unauthenticated endpoint.** `GET /api/plans/:id` on the
terrain service has no authentication, and `fetch_plan` calls it with a bare
`urllib.request.urlopen` — no header. Using it requires making the terrain
service publicly routable, which would make every saved plan readable by anyone
who guesses a UUID.

**Not exploitable through Athena as shipped**: the server submits an uploaded
payload rather than a plan id (so establishment can be expanded), and nothing
sets `TERRAIN_SERVICE_URL`. The cleanest resolution is to delete `fetch_plan`
and the `planId` submission branch now that neither has a caller.

**Fixed on the server side since this document was written:**

- CORS is configurable via `CORS_ORIGINS`; a deployed frontend is no longer
  blocked by a hardcoded localhost regex.
- Battleground terrain is written to Postgres when the pipeline produces it, so
  saving a plan no longer depends on an in-memory cache entry surviving.
- `POST /api/battleground` is rate limited, capping the one endpoint that spends
  third-party API quota.
- Replay fetching goes through the terrain service, so the engine's bucket needs
  no CORS policy naming the frontend.
