# Athena Engine Rules and Assumptions

This document records the rules the Athena engine currently implements, the
assumptions those rules encode, and the product constraints that future engine work
must preserve. It describes the live code in this directory; it is not a claim that
the model is tactically complete, empirically calibrated, or predictive of real
combat.

When this document and the implementation disagree, the implementation and its tests
describe current runtime behavior. The disagreement should then be resolved by either
changing the code or updating this document deliberately.

## Product boundary

Athena is a force-on-force simulation lab for testing human-authored Blue and Red ops
plans. Soldier-agents execute those plans inside a rules-governed environment, while
the engine owns global truth and adjudicates attempted actions. The intended output is
an explanation of where a plan breaks under explicit assumptions across repeated
simulation branches.

Athena is not an AI commander, plan generator, plan rewriter, course-of-action
recommender, or validated combat prediction system. Engine probabilities are
inspectable simulation parameters, not real-world casualty or weapon-effect claims.

The MVP product assumptions are:

- The scenario is force-on-force.
- Terrain is synthetic rather than ingested from real-world terrain data.
- The only weapon model is a rifle.
- Each soldier-agent represents exactly one soldier.
- Soldiers are equally competent by default.

Some of this product boundary is not implemented in the current minimal engine. The
implemented and unimplemented parts are distinguished below.

## Authority and information boundaries

The `Battlefield` and `LoopEngine` hold authoritative global state. Agents do not
mutate that state directly: they return attempted `MoveAction` or `ShootAction`
values, and engine resolvers determine whether and how those actions take effect.

The engine maintains two conceptual views:

- **Global truth** contains the battlefield dimensions and surface, every soldier,
  cover, and concealment. Immutable before-and-after snapshots capture this view for
  each execution.
- **Agent-local observation** contains the observing soldier's own team, exact XYZ
  position, survival state, visible soldiers, and locally available terrain. Normal
  hosted-agent shooting validation uses this observation rather than hidden global
  state.

The current observation does not contain a soldier identifier, the observer's
configured vision range, plans, contingencies, messages, prior observations, or a
persistent memory. Visible soldiers are described only by team, exact XYZ position,
and survival state.

## Battlefield and terrain

### Coordinate system

- The battlefield is a rectangular grid with width and height.
- Valid horizontal coordinates satisfy `0 <= x < width` and
  `0 <= y < height`.
- North decreases `y`, east increases `x`, south increases `y`, and west decreases
  `x`.
- Every `Position` has integer `x`, `y`, and `z` fields after Pydantic validation.
  XYZ is mandatory; a position with only XY is invalid.
- The engine treats positions as grid-cell addresses, not continuous points.

### Height-field surface

- Every XY cell has exactly one ground elevation `z`.
- A supplied surface must cover every in-bounds XY coordinate exactly once. Missing
  cells or multiple elevations at one XY coordinate make battlefield construction
  fail.
- If no surface is supplied, the engine creates a flat surface with `z = 0`.
- Elevation is part of the ground cell. There are no stacked walkable cells, free
  vertical movement, airborne positions, or voxel-space movement.
- A soldier, cover position, or concealment position supplied at construction must
  equal the exact XYZ surface position at its XY coordinate.
- Elevation may be any integer; the engine does not impose a sea level, upper bound,
  or non-negative constraint.

### Terrain features and initial occupancy

- Cover and concealment are independent flags attached to exact surface positions.
  A cell may currently carry both flags.
- Battlefield construction does not prevent multiple soldiers from starting in one
  cell.
- Battlefield construction does not prevent a soldier from starting on a cover cell.
  Normal movement cannot enter cover, but initial placement is less restrictive.
- Cover and concealment collections remain mutable after construction. Code that
  mutates them directly is responsible for preserving the surface-position invariant.

## Soldier model

- The only teams are Blue and Red.
- A soldier has a team, an exact surface position, a survival state, and a base vision
  range.
- The default base vision range is `10.0` horizontal grid cells, but it is configurable
  per soldier.
- The survival states are `alive`, `casualty`, and `dead`.
- Only an alive soldier can see other soldiers, move, or shoot, and only an alive
  soldier is an eligible rifle target.
- A rifle hit changes an alive soldier to `casualty`. Repeated hits do not change an
  existing casualty, and the implemented engine never advances a casualty to `dead`.
- There is no implemented recovery, treatment, evacuation, morale, fatigue, posture,
  facing, inventory, ammunition, armor, health-point, or skill model.

The mutable `Soldier` objects are authoritative live state. Core positions, actions,
observations, snapshots, and outcomes are frozen Pydantic models so resolver results
are replaced intentionally rather than mutated in place.

## Observation rules

Before agents choose actions, the loop constructs one observation per soldier from the
same battlefield state.

### Visible soldiers

- An observer never sees itself in `visible_soldiers`.
- A non-alive observer sees no soldiers.
- An alive observer may see friendly soldiers in the `alive`, `casualty`, or `dead`
  state, subject to range and terrain line of sight. Their exact survival state is
  included in the observation.
- Opposing casualties and dead soldiers are not included; opposing targets must be
  alive and pass the remaining vision rules below.
- Observation generation is currently an all-pairs check, so its soldier-visibility
  cost is quadratic in the number of soldiers.

### Available terrain

- The observation includes every surface cell inside the observer's
  elevation-adjusted vision range, including the observer's current cell.
- Each terrain entry contains exact XYZ plus `has_cover` and `has_concealment` flags.
- Terrain cells are ordered by `y` and then `x`.
- Terrain availability is range-based only. Hills, cover, and concealment do not hide
  in-range topology, so an agent receives cells behind a terrain-blocked sightline for
  local navigation.
- Terrain availability is produced even for a casualty or dead soldier because this
  helper currently does not filter on survival state. Such a soldier still cannot
  perform a valid engine action.
- Building terrain observations scans the surface for every soldier, with cost
  proportional to soldiers times surface cells.

## Vision and detection

Vision is directional: whether A sees B can differ from whether B sees A because each
observer has its own base range and relative elevation changes effective range.

### Range

Distance is horizontal Euclidean distance:

$$
d = \sqrt{(x_t-x_o)^2 + (y_t-y_o)^2}.
$$

Vertical distance does not contribute to `d`. Instead, relative elevation changes the
observer's effective range:

$$
R_{\text{effective}} = \max\left(1,
R_{\text{base}} + z_o - z_t\right).
$$

The target is in range when `d <= R_effective`, so the boundary is inclusive. Each
level of observer height above the target adds one cell of range, each level below the
target removes one cell, and effective range never falls below one cell.

The same formula determines which terrain cells appear in `available_terrain`.

### Terrain line of sight

- Soldier eye height is fixed at `1.0` elevation level above the soldier's ground
  `z`.
- The sightline is a straight eye-to-eye line projected from the center of the
  observer cell to the center of the target cell.
- The grid traversal checks intervening cells only; the observer and target cells are
  excluded.
- At each intervening cell, the engine interpolates the eye-to-eye sightline height.
  Terrain blocks sight when its ground `z` is greater than or equal to that height.
  Merely meeting the line is therefore enough to block it.
- Terrain occlusion applies equally to friendly and opposing soldiers.
- When a ray passes exactly through a grid corner, traversal advances diagonally and
  does not add the two side-adjacent cells.

### Hard cover

- After range and terrain checks pass, any cover cell traversed between an observer
  and an opposing target blocks detection.
- Intervening cover blocks an opposing target regardless of the cover cell's height
  relative to the sightline; cover is a binary blocker rather than a geometric
  object with its own height.
- Cover in the observer's cell or target's cell does not block sight because endpoint
  cells are excluded.
- Friendly soldiers ignore cover after range and terrain checks. This is an explicit
  current information-model shortcut, not physical visibility.
- Soldiers do not occlude one another.

### Concealment

- Concealment affects detection only when an opposing target occupies a concealment
  cell.
- Intervening concealment has no effect, and friendly soldiers ignore concealment.
- Detection probability for a concealed opposing target is:

$$
P(\text{detect}) = \operatorname{clamp}
\left(1 - p_{\text{concealment penalty}}, 0, 1\right).
$$

- Detection succeeds when a random roll is less than or equal to that probability.
- The default concealment penalty is `0.0`, so concealment has no practical detection
  effect unless a scenario configures a non-zero penalty.
- Detection is rolled again whenever visibility is recomputed. Detection state is not
  remembered across observations, shared between soldiers, or persisted in a
  snapshot.
- Once a target is detected, concealment does not modify rifle hit probability.

### Vision limitations

The current model has no weather, illumination, smoke, optics, facing, field of view,
posture, movement-induced detection, target size, observation delay, identification
uncertainty, or false contacts. A visible soldier's team and exact XYZ are known
immediately.

## Movement

### Individual move legality

A move action selects one of eight directions:

| Direction | XY delta |
| --- | ---: |
| North | `(0, -1)` |
| Northeast | `(1, -1)` |
| East | `(1, 0)` |
| Southeast | `(1, 1)` |
| South | `(0, 1)` |
| Southwest | `(-1, 1)` |
| West | `(-1, 0)` |
| Northwest | `(-1, -1)` |

The destination `z` is always looked up from the battlefield surface. A proposed move
is individually legal only when all of the following hold:

1. The soldier is alive.
2. The destination exists in bounds and is the exact surface position for that XY.
3. The destination is one horizontal Chebyshev step away, meaning
   `max(abs(dx), abs(dy)) == 1`.
4. Absolute elevation change does not exceed `max_elevation_change`, whose default is
   one level. The same limit applies uphill and downhill.
5. The destination is not a cover cell.

Orthogonal and diagonal moves both consume one action and have the same cost. The
engine does not prevent diagonal corner-cutting, check the two side-adjacent cells, or
model transit through the space between cell centers. Concealment is traversable and
does not change movement cost. There is no speed, gait, terrain-cost, acceleration,
formation, or pathfinding rule in the engine.

### Simultaneous movement conflicts

Individual move validation does not reject an occupied destination. Occupancy is
resolved across the whole action batch from the pre-execution state:

- If two or more soldiers propose the same destination, the movement resolver selects
  one contender uniformly at random and rejects the others, regardless of team.
- The selected contender can still be rejected if the destination's pre-tick occupant
  does not successfully vacate the cell. Rejected contenders are not reconsidered.
- A move into an occupied cell succeeds only if every pre-tick occupant has its own
  accepted move out of that cell.
- Rejections cascade backward through movement chains. If a downstream soldier cannot
  vacate, every dependent move into that soldier's cell is also rejected.
- A two-soldier swap is valid, as is a fully moving cycle, because every occupied cell
  is vacated within the same batch.
- Opposing and friendly soldiers use the same collision rules.
- The engine checks destination occupancy, not crossing paths, so swaps and crossing
  diagonal paths do not collide in transit.

## Shooting

### Shoot-action legality

A shoot action specifies an exact XYZ `target_position`; it does not target by soldier
identifier.

On the normal hosted-agent path, the action is legal only when:

1. The shooter is alive.
2. Exactly one soldier in the shooter's current local observation occupies the exact
   target position.
3. That visible soldier is alive and belongs to the opposing team.

These checks prevent the hosted agent from shooting a friendly soldier or acting on a
hidden enemy coordinate. If more than one eligible visible soldier shares the target
position, the coordinate is ambiguous and the action is rejected.

The lower-level `execute_actions` API does not repeat a range or line-of-sight check.
It binds the coordinate to exactly one living enemy in global pre-execution state.
Normal `tick()` usage relies on observation-based action validation before execution,
but callers that inject actions directly are responsible for preserving the visibility
rule. This is a current enforcement gap, not permission for agents to use global truth.

### Target binding and timing

- The target is bound using the pre-execution snapshot and exact pre-tick XYZ.
- A target that also has an accepted move still completes that move. A hit then makes
  it a casualty at its new position.
- A shooter hit during the same tick still resolves its own accepted shot.
- Reciprocal shots can therefore make both soldiers casualties in one tick.
- If zero or multiple living enemies occupy the requested coordinate in the snapshot,
  no shot outcome is produced.

### Hit probability

For a bound rifle shot, hit probability is:

$$
P(\text{hit}) = \operatorname{clamp}
\left(p_{\text{base}} + m_{\text{elevation}}(z_s-z_t),
p_{\min}, p_{\max}\right).
$$

The defaults are:

| Parameter | Default |
| --- | ---: |
| Base hit probability | `0.90` |
| Modifier per relative elevation level | `0.02` |
| Minimum hit probability | `0.50` |
| Maximum hit probability | `0.99` |

High ground increases hit probability by two percentage points per level and low
ground decreases it by the same amount, subject to the bounds. Horizontal distance,
target movement, shooter movement, cover, concealment, posture, skill, and prior shots
do not modify probability after the shot has been accepted.

The resolver draws one random value in `[0, 1)` and records a hit when
`roll < P(hit)`. Every valid shot produces a `ShotOutcome` containing shooter index,
target index, probability, roll, and hit result. Multiple shots at one target roll
independently, but applying one or more hits changes that target to casualty only once.
A miss does not mutate the target.

### Shooting limitations

There is no ammunition, reload, rate-of-fire, burst, projectile travel time, caliber,
penetration, armor, suppression, near miss, cover damage, body region, wound severity,
friendly-fire accident, or direct transition from alive to dead. A soldier may choose
at most one action per tick, so shooting consumes that tick's action.

## Action selection

- The action schema contains only `move` and `shoot`. There is no explicit wait,
  communicate, take-cover, observe, treat, or plan action.
- The hosted OpenRouter prompt allows either movement or shooting.
- The hosted chooser requests up to `max_attempts` proposals, defaulting to three, and
  returns the first individually legal action. Every retry uses the same observation.
- If all attempts are invalid, the soldier contributes `None` and does nothing during
  execution.
- Some models return the nested action as JSON encoded inside a string. The agent
  boundary parses that specific shape before Pydantic validation; malformed JSON still
  fails.
- All soldier action choices are requested concurrently with `asyncio.gather`, while
  result order remains aligned with `battlefield.soldiers`.
- If an action chooser raises, collection raises before `execute_actions` is called, so
  the tick does not commit world-state changes.

The current Ollama path is intentionally different: its prompt lists shooting as
illegal, and its local action resolver rejects every `ShootAction`. Ollama-backed
soldiers can currently move only, while OpenRouter-backed soldiers can move or shoot.
This backend asymmetry is an implementation limitation rather than an engine-domain
rule.

The loop currently requests an action even for a casualty or dead soldier. Normal
resolvers reject any move or shot they propose, but the model request itself is not
skipped.

## Tick and execution semantics

One normal tick has two phases:

1. Build local observations and collect at most one individually valid action per
   soldier.
2. Capture an immutable global `before` snapshot, resolve the complete action batch
   against that state, commit accepted effects, and capture an immutable `after`
   snapshot.

All action-list indices map directly to the ordering of `battlefield.soldiers`. The
caller contract is one entry per soldier; `execute_actions` does not currently validate
the list length.

Movement destinations and rifle shots are resolved from the same pre-execution state.
The engine commits accepted positions first and casualty states second, but the result
is simultaneous in the sense that a same-tick casualty does not cancel an already
accepted move or shot. There is no initiative, reaction, interrupt, or within-tick
ordering by team or soldier index.

`ExecutionResult` records:

- the submitted action or `None` for each supplied action index;
- every globally bindable shot outcome, including misses;
- the immutable battlefield state before execution; and
- the immutable battlefield state after all accepted effects.

Random generators can be injected into movement, vision, and shooting resolvers for
deterministic tests. RNG state is not stored in battlefield snapshots, although the
actual shooting roll and outcome are stored in `ShotOutcome`. Re-running from a
snapshot is therefore not deterministic unless the caller also controls resolver RNG
state. Contested destinations draw from the movement RNG in destination insertion
order. Valid shots draw from the shooting RNG in soldier-list order, so changing
soldier ordering can associate the same random sequence with different outcomes.

## Demo-only scenario rules

The command-line demo is an example scenario rather than a universal engine rule. Its
current setup uses:

- a `12 x 8` synthetic height-field battlefield;
- two Blue and two Red soldiers;
- vision range `6` for each demo soldier;
- fixed cover and concealment cells;
- default movement, vision, concealment, and shooting resolver parameters; and
- a maximum of 60 ticks unless `--ticks` overrides it.

The demo stops early when either Blue or Red has no `alive` soldiers. Casualties and
dead soldiers do not count as living for this termination check. The core `LoopEngine`
itself has no victory condition or automatic run loop.

## Intended rules not yet implemented

The product model requires the following behavior, but the current engine and agent
observation schema do not implement it yet:

- Each soldier-agent receives its own side's human-authored ops plan and assigned
  contingencies.
- An agent follows applicable contingencies before deviating from the plan, and may
  deviate only when the plan and contingencies do not cover its local situation.
- Agent knowledge persists as memory within one simulation run but does not cross into
  other runs.
- Agents communicate through range-limited radio and line-of-sight shouting.
- Agents never receive global battlefield truth or the opposing side's hidden plan.
- Athena runs many branches of the same human-authored plans and reports where they
  fail under stated assumptions.

These requirements should remain separate from current behavior until implemented and
tested. In particular, the existing terrain observation is range-limited but reveals
topology behind LOS blockers, and no communications or memory layer exists yet.

## Current modeling omissions and enforcement gaps

For clarity, the engine currently does not model:

- real-world terrain ingestion or geospatial coordinates;
- plans, contingencies, formations, objectives, or rules of engagement;
- radio, shouting, message delay, interception, or communication failure;
- persistent per-run agent knowledge;
- time duration, action duration, initiative, or reactions inside a tick;
- weapons other than the single abstract rifle model;
- logistics, ammunition, medical treatment, morale, fatigue, command, or training
  differences;
- empirically calibrated detection, hit, casualty, or death probabilities;
- branching simulation orchestration or breakdown-report generation.

The following invariants are enforced at battlefield construction or through the
normal loop, but low-level mutation APIs can bypass them:

- `Soldier.move_to()` itself does not validate surface membership or movement
  legality; normal movement must go through `MovementResolver` and `LoopEngine`.
- Direct mutation of cover or concealment after construction is not revalidated.
- Direct `execute_actions()` calls bypass local-observation shooting validation.
- Initial soldier overlap, soldier-on-cover placement, and cover/concealment overlap
  are allowed.
- Positive battlefield dimensions and action-list length are caller assumptions rather
  than explicitly validated contracts.

These are descriptions of present behavior, not recommended future rules. Any decision
to preserve or close one of these gaps should be made explicitly and accompanied by
tests and an update to this document.

## Implementation source map

| Concern | Primary implementation | Behavioral tests |
| --- | --- | --- |
| Types, actions, immutable snapshots, observations | `athena/types.py` | `tests/test_battlefield.py`, `tests/test_shooting.py` |
| Surface and battlefield invariants | `athena/battlefield.py` | `tests/test_battlefield.py` |
| Soldier state transitions | `athena/soldier.py` | `tests/test_execution.py` |
| Vision, terrain LOS, cover, concealment | `athena/resolvers/vision.py` | `tests/test_vision.py` |
| Individual movement legality | `athena/resolvers/movement.py` | `tests/test_movement.py` |
| Target validation and rifle outcomes | `athena/resolvers/shooting.py` | `tests/test_shooting.py` |
| Observation, concurrent choice, conflicts, tick execution | `athena/loop.py` | `tests/test_execution.py` |
| Hosted and local agent behavior | `athena/agent.py`, `athena/ollama_agent.py` | `tests/test_shooting.py` |
| Example scenario and termination | `athena/demo.py` | `tests/test_demo.py` |
