# Athena Engine

TO AGENTS:

- Always document the behaviour of new features here
- If this document disagrees with actual implementation, it should always be brought up

This doc records Athena engine's

- behavior
- modeling assumptions around combat

The document distinguishes three kinds of values and behavior:

1. **Configurable today** -> code already accepts the value through a
   constructor or function parameter.
2. **Scenario input** -> value describes one battlefield or simulation run,
   rather than a universal engine rule.
3. **Hardcoded rule** -> behavior is implemented directly and cannot yet be
   changed through configuration.

## Authority and information boundaries

- `Battlefield` and its mutable `Soldier` objects hold authoritative global state.

- Agents do not receive that global state. They receive an `AgentContext`
  containing the soldier's current local observation and a bounded history
  of earlier local visibility.

- Python action chooser also receives the live `Battlefield` and `Soldier` so it
  can validate a proposed action before returning it to the loop. This is an internal
  engine boundary; objects are not serialized into the prompt.

Agents propose actions, while the engine owns adjudication and state mutation:

1. `LoopEngine` derives local observations from global truth.
2. The action chooser returns at most one proposed action per soldier.
3. Resolvers validate and resolve the complete action batch.
4. `LoopEngine` commits accepted movement and casualty effects.

The ordering of `battlefield.soldiers` is an implicit identity system. Soldier
indices align actions, observations, visibility histories, snapshots, and shot
outcomes. There is no independent soldier identifier in the current model.

## Battlefield and terrain

### Coordinate system

- The battlefield is a rectangular grid with `width` and `height`.
- Valid horizontal coordinates satisfy `0 <= x < width` and
  `0 <= y < height`.
- North decreases `y`, east increases `x`, south increases `y`, and west decreases
  `x`.
- Every `Position` requires integer `x`, `y`, and `z` fields.
- Positions identify grid cells, rather than continuous points inside cells.

### Height-field surface

- Every in-bounds XY coordinate has exactly one ground elevation `z`.
- `Battlefield.surface` is a collection of `Position(x, y, z)` values, where each
  `Position` defines the ground elevation `z` at one XY coordinate.
- This collection must contain exactly one `Position` for every in-bounds XY
  coordinate. Missing cells or multiple elevations at one XY coordinate make
  battlefield construction fail.
- If the `surface` argument is omitted, `Battlefield` creates one
  `Position(x, y, z=0)` for every XY coordinate.
- Every soldier position and every cover or concealment `Position` supplied at
  construction must equal the battlefield's ground `Position` at that XY coordinate.
- Elevation may be any integer. The engine does not impose sea level, minimum
  elevation, or maximum elevation.

The default flat-ground elevation is hardcoded as `z = 0`. Width, height, and a
custom collection of ground `Position` values are scenario inputs.

### Cover, concealment, and initial occupancy

- Cover and concealment are independent sets of exact ground `Position` values.
- One cell may contain both cover and concealment.
- Battlefield construction permits multiple soldiers to start in one cell.
- Battlefield construction permits a soldier to start on cover, even though normal
  movement cannot enter cover.
- Cover and concealment remain mutable after construction. Mutating either set does
  not rerun battlefield validation.
- Soldiers do not block vision as physical objects.

## Soldier model

A soldier currently has four properties:

- team;
- exact XYZ surface position;
- survival state; and
- vision range.

The current soldier assumptions are:

- Teams are limited to Blue and Red.
- Survival states are `alive`, `casualty`, and `dead`.
- Soldiers begin alive unless another state is supplied.
- Default vision range is `10.0`.
- Only an alive soldier can see other soldiers, move, or shoot.
- A rifle hit changes an alive soldier to casualty.
- Repeated hits do not change an existing casualty.
- The engine never advances a casualty to dead.
- There is no recovery or treatment transition.

Default vision range is configurable today per soldier. Default survival state and
the rifle hit transition are hardcoded defaults.

## Agent-local observations

Before action selection, `LoopEngine` builds one `ObservedSoldier` value for every
soldier. It contains:

- the observer's team
- the observer's exact position
- the observer's current survival state
- visible soldiers
- visible terrain cells with cover and concealment flags.

### Visible soldiers

- An observer never sees itself.
- A casualty or dead observer sees no soldiers.
- An alive observer may see friendly soldiers in any survival state after range and
  terrain line-of-sight checks pass.
- An enemy must be alive to appear in an observation.
- Visible soldiers reveal exact team, XYZ position, and survival state.
- Soldier visibility is currently computed by checking every observer-target pair,
  making this part of observation construction quadratic in soldier count.

### Available terrain

- Terrain cells are included when they pass the observer's 3D range check and
  terrain line-of-sight check.
- The observer's current cell is included.
- Terrain entries contain exact XYZ, `has_cover`, and `has_concealment`.
- Entries are produced in `y`-then-`x` order.
- Hard cover does not independently hide terrain cells; only terrain elevation
  blocks terrain visibility.
- Concealment does not hide terrain cells.
- Casualties and dead soldiers still receive terrain observations because terrain
  observation construction does not filter by survival state.

The terrain scan is limited to a square window derived from the lower of the
soldier's vision range and the global vision cap. Every candidate still goes through
the full 3D range and terrain line-of-sight checks.

## Vision and detection

### Tunable vision parameters

| Parameter                     | Current default | Current owner                  |
| ----------------------------- | --------------: | ------------------------------ |
| Soldier vision range          |          `10.0` | `Soldier`                      |
| Maximum vision range          |         `100.0` | `VisionResolver`               |
| Soldier eye height            |           `1.0` | module constant in `vision.py` |
| Concealment detection penalty |           `0.0` | `VisionResolver`               |

Soldier vision range, maximum vision range, and concealment penalty are configurable
today. Eye height is currently a hardcoded constant.

### Range

Vision uses full 3D Euclidean distance:

$$
d^2 = (x_t-x_o)^2 + (y_t-y_o)^2 + (z_t-z_o)^2.
$$

The effective range is:

$$
R_{\text{effective}} = \min(R_{\text{soldier}}, R_{\text{maximum}}).
$$

A target is in range when:

$$
d^2 \leq R_{\text{effective}}^2.
$$

The boundary is inclusive. Elevation difference contributes distance, so high ground
does not extend nominal vision range. Its current advantage comes from clearing
intervening terrain.

The code assumes non-negative vision ranges and caps. It does not currently validate
that assumption.

### Terrain line of sight

- An observer's eye is one elevation level above its ground position.
- The target sight point is also one elevation level above its ground position.
- The sightline runs between cell centers.
- Only intervening grid cells are checked; observer and target cells are excluded.
- At each intervening cell, terrain height is compared with the interpolated
  eye-to-eye sightline height.
- Terrain blocks sight when its ground elevation meets or exceeds the sightline.
- Terrain occlusion applies to friendly and enemy soldiers alike.
- When the sightline crosses a grid corner exactly, traversal advances diagonally
  and does not add both side-adjacent cells.

The distance metric, eye-to-eye interpolation, blocking threshold, and grid traversal
are hardcoded algorithms.

### Hard cover

- Intervening cover blocks visibility to an enemy after range and terrain checks.
- Cover is a binary blocker. Its own elevation relative to the sightline does not
  matter.
- Cover in the observer or target cell does not block visibility because endpoints
  are excluded.
- Friendly soldiers ignore hard cover after passing range and terrain checks.
- Cover does not modify rifle hit probability once a shot is accepted.

The friendly-cover exception is a hardcoded information-model shortcut.

### Concealment

- Concealment affects detection only when an alive enemy occupies a concealment
  cell.
- Intervening concealment has no effect.
- Friendly soldiers ignore concealment.
- Concealed-enemy detection probability is:

$$
P(\text{detect}) = \operatorname{clamp}
\left(1-p_{\text{concealment penalty}}, 0, 1\right).
$$

- Detection succeeds when `roll <= P(detect)`.
- The default penalty is zero, so concealment has no practical effect unless a
  non-zero value is configured.
- Detection is rerolled whenever visibility is recomputed.
- Detection is not remembered, shared between soldiers, or stored in battlefield
  snapshots.
- Concealment does not modify rifle hit probability after detection.

The concealment resolver accepts an injectable random generator.

## Movement

### Tunable movement parameters

| Parameter                |     Current default | Current owner      |
| ------------------------ | ------------------: | ------------------ |
| Maximum elevation change |                 `1` | `MovementResolver` |
| Conflict randomness      | unseeded `Random()` | `MovementResolver` |

Both values can be injected today, although there is no central run-level random
seed.

### Individual move legality

A move selects one of eight directions:

| Direction |   XY delta |
| --------- | ---------: |
| North     |  `(0, -1)` |
| Northeast |  `(1, -1)` |
| East      |   `(1, 0)` |
| Southeast |   `(1, 1)` |
| South     |   `(0, 1)` |
| Southwest |  `(-1, 1)` |
| West      |  `(-1, 0)` |
| Northwest | `(-1, -1)` |

A proposed move is individually legal when all of the following hold:

1. The soldier is alive.
2. The destination is in bounds.
3. The destination is the exact surface position for its XY coordinate.
4. The destination is exactly one horizontal Chebyshev step away.
5. Absolute elevation change does not exceed the configured limit.
6. The destination is not a cover cell.

The destination `z` is always read from the battlefield surface. Uphill and downhill
use the same elevation limit.

Diagonal moves check only the destination. For a move from `(1,1)` to `(2,0)`, cells
`(1,0)` and `(2,1)` are ignored, allowing corner-cutting.

Movement distance, direction set, diagonal cost, corner-cutting, and cover
impassability are hardcoded rules.

### Simultaneous movement conflicts

Individual validation does not check destination occupancy. `LoopEngine` resolves
occupancy across the complete action batch using the pre-execution snapshot:

- When multiple soldiers propose the same destination, one contender is selected
  uniformly at random and every other contender is rejected.
- The selected contender may still be rejected when a pre-tick occupant fails to
  vacate the destination.
- A move into an occupied cell succeeds only when every pre-tick occupant has an
  accepted move out.
- Rejections cascade backward through dependent movement chains.
- Rejected contenders are not reconsidered if the initially selected winner is later
  blocked.
- Two-soldier swaps and fully moving cycles are valid.
- Friendly and opposing soldiers use the same conflict rules.
- Crossing paths, including crossing diagonal paths, do not collide in transit.

The random-winner policy, swap behavior, and absence of transit collision are
hardcoded rules.

## Weapon and shooting model

The engine currently implements one abstract rifle model. There is no weapon object
or weapon inventory; rifle assumptions live directly in `ShootingResolver` and the
soldier casualty transition.

### Tunable rifle parameters

| Parameter                    |     Current default | Current owner      |
| ---------------------------- | ------------------: | ------------------ |
| Base hit probability         |              `0.90` | `ShootingResolver` |
| Elevation modifier per level |              `0.02` | `ShootingResolver` |
| Minimum hit probability      |              `0.50` | `ShootingResolver` |
| Maximum hit probability      |              `0.99` | `ShootingResolver` |
| Hit randomness               | unseeded `Random()` | `ShootingResolver` |

### Shoot-action legality

A shoot action targets exact XYZ coordinates rather than a soldier identifier.
During normal hosted-agent action selection, a shot is legal when:

1. The shooter is alive.
2. Exactly one visible soldier occupies the requested coordinates.
3. The visible soldier is alive.
4. The visible soldier belongs to the opposing team.

These rules prohibit deliberate friendly fire and reject hidden, casualty, dead, or
ambiguous targets.

`execute_actions()` is an internal batch-resolution step. `tick()` passes it actions
already validated against each soldier's local observation, so it resolves targets
from the shared snapshot without repeating range or line-of-sight checks.

### Target binding and timing

- A target is bound using exact pre-tick coordinates from the shared battlefield
  snapshot.
- Zero or multiple living enemies at the requested coordinate produce no shot
  outcome.
- A target with an accepted move completes that move even when hit in the same tick.
- A shooter hit in the same tick still resolves its accepted shot.
- Reciprocal shots may make both soldiers casualties.
- Multiple shots against one target roll independently.

These are consequences of snapshot-based simultaneous execution.

### Hit probability and effect

For an accepted rifle shot:

$$
P(\text{hit}) = \operatorname{clamp}
\left(
p_{\text{base}} + m_{\text{elevation}}(z_s-z_t),
p_{\min},
p_{\max}
\right).
$$

High ground increases probability by two percentage points per level with current
defaults, while low ground decreases it by the same amount. A uniformly distributed
random roll in `[0, 1)` produces a hit when `roll < P(hit)`.

## Agent action-selection loop

### Tunable loop and provider parameters

| Parameter                |              Current default | Current owner                                 |
| ------------------------ | ---------------------------: | --------------------------------------------- |
| Maximum action attempts  |                          `3` | `LoopEngine`, OpenRouter and Ollama functions |
| Visibility history limit |                         `10` | `LoopEngine`                                  |
| Hosted model             | `deepseek/deepseek-v4-flash` | `agent.py`                                    |
| Ollama host              |     `http://localhost:11434` | `ollama_agent.py` or `OLLAMA_HOST`            |
| Ollama discovery timeout |                 `10` seconds | `ollama_agent.py`                             |
| Ollama action timeout    |                `120` seconds | `ollama_agent.py`                             |

Maximum attempts is duplicated across multiple function defaults. History length is
also stated literally in the OpenRouter prompt, so either value can drift from the
behavior described to the model.

### Action schema and retries

- The action schema supports only move and shoot.
- There is no explicit wait, communicate, observe, take-cover, treat, or plan action.
- OpenRouter may propose movement or shooting.
- Ollama is intentionally movement-only and rejects every shoot proposal.
- The chooser requests up to `max_attempts` proposals and returns the first
  individually legal action.
- Every retry uses the same observation.
- Exhausting retries returns `None`, causing no action during execution.
- Each retry is another model request.
- The structured-output boundary accepts a nested action that some models return as
  JSON encoded inside a string. Other malformed output still fails validation.

### Prompt assumptions

Both prompts currently embed scenario and engine rules directly:

- Blue advances east and Red advances west.
- Movement is one cell.
- Maximum elevation change is one level.
- Cover is impassable.
- Occupied stationary cells are unavailable.
- OpenRouter may shoot visible living enemies.
- Ollama may not shoot.
- The OpenRouter history description says the limit is ten.

The team objectives are scenario assumptions, while the movement, shooting, and
history statements duplicate engine behavior. Changing the engine parameters without
updating the prompt can mislead the agent.

### Scheduling and failure behavior

- `LoopEngine` schedules one action-chooser call for every soldier, including
  casualties and dead soldiers.
- All chooser calls run concurrently through `asyncio.gather`.
- Concurrency is not capped.
- Result order remains aligned with soldier order.
- If any chooser raises, action collection raises and execution does not commit a
  state change for that tick.
- OpenRouter has no explicit request timeout in Athena's code.
- There is no retry policy for transport failures distinct from invalid actions.

Scheduling non-alive soldiers, unbounded concurrency, fail-the-tick behavior, and the
absence of an OpenRouter timeout are current operational assumptions.

### Visibility history

- History is maintained separately for each soldier index.
- The current observation is sent separately from history.
- Each completed tick appends the exact pre-action visibility that informed that
  tick's decision.
- History contains visible soldiers and available terrain, but omits the observer's
  own position, team, and survival state.
- Entries are kept oldest to newest.
- The default rolling limit is ten.
- Ollama receives only the current observation and does not receive history.

## Tick and execution semantics

A normal tick has two phases:

1. Build local observations and collect at most one individually valid action per
   soldier.
2. Capture a global before-snapshot, resolve all actions against that state, commit
   accepted effects, and capture an after-snapshot.

The execution assumptions are:

- Every soldier acts from the same pre-action world state.
- Movement and shooting resolve independently from the same snapshot.
- Accepted positions are committed before casualty transitions.
- Same-tick casualties do not cancel accepted movement or shooting.
- There is no initiative, reaction, interrupt, or within-tick team ordering.
- A `None` action leaves that soldier unchanged.
- An `ExecutionResult` records submitted actions, shot outcomes, pre-action
  observations, and immutable before/after snapshots.
- `execute_actions()` assumes one action-list entry per soldier but does not validate
  the list length.
- The core loop has no automatic victory condition

## Internal contracts and validation assumptions

The following behavior is enforced through normal construction and `tick()` usage,
but lower-level APIs can bypass it:

TO AGENTS: This is okay, no need to fix unless it has been proven to break something

- `Soldier.move_to()` does not validate surface membership or movement legality.
- Direct mutation of cover and concealment is not revalidated.
- `execute_actions()` assumes its actions have already passed observation-based
  validation.
- Initial soldier overlap and soldier-on-cover placement are allowed.
- Cover and concealment overlap is allowed.
- Positive battlefield dimensions are assumed rather than explicitly validated.
- Vision ranges and resolver parameters are assumed to be sensible and non-negative.
- Probability parameter ordering and bounds are not validated.
- Action-list length is assumed to match soldier count.
- RNG state is absent from snapshots.
