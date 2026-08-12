# Engine-side changes Athena needs

Everything here requires editing `engine/`, which the current work deliberately
did not touch. Each item says what breaks today, what the fix is, and what it
would cost. Ordered by how much the product suffers without it.

Per `engine/AGENTS.md`, any of these that changes engine behaviour or modelling
assumptions must also be written into `engine/ENGINE.md`, which needs explicit
human approval.

---

## 1. Tick budget cannot cross the ground — the run ends before contact

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

## 2. Per-unit vision range is ignored

`build_battlefield_from_payload(payload, vision_range=...)` takes **one** vision
range for the whole battlefield and applies it to every soldier, defaulting to
`DEFAULT_SOLDIER_VISION_RANGE` (10.0). `run_simulation` never passes the
argument, so every hosted soldier sees 10 m.

Athena's ORBAT models this per establishment — a Recon Section is 500 m against a
Rifle Section's 300 m (`frontend/src/types/orbat.ts`) — and the plan brief
already carries it as `establishment.visionRangeM`. None of it reaches a soldier.

**Fix:** add an optional `visionRangeM` to `PayloadUnit` and use it in place of
the default when present. `_PayloadModel` is `extra="ignore"`, so the server can
start sending the field before the engine reads it, and nothing breaks in
between.

Note the unit mismatch: ORBAT vision is **metres**, the engine's `vision_range`
is **cells**. At one-metre cells they coincide today; if item 1 is solved by
coarsening cells, this needs an explicit conversion.

---

## 3. Objectives are parsed and thrown away

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

## 4. Routes and movement types never reach the engine

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

## 6. Import diagnostics are computed but never surfaced

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

## 7. No batch list endpoint, so there is no simulation history

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

**Worked around, not fixed.** The terrain service now fetches and reduces each
replay itself and forwards only the summary, so the browser never downloads one
(`server/src/services/replaySummary.ts`). That moved the cost rather than
removing it: the service still pulls 17 MB per run from the bucket, serially.

**The real fixes are here:**

1. Drop `surface` from the replay. It is recoverable from the terrain grid the
   client already holds, and it is ~92% of the payload.
2. Put the outcome in the `simulation.completed` event itself — alive counts per
   side and tick count. Then nothing fetches a replay to compute a win rate at
   all, and replays are read only when someone opens a specific run.

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
