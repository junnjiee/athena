# Athena Engine

TO AGENTS:

- THIS IS A READ-ONLY FILE FOR AGENTS. YOU MUST OBTAIN EXPLICIT APPROVAL BEFORE WRITING TO THIS FILE
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

Tunable engine defaults and the OpenRouter system-prompt template are centralized in
`athena/params.py`. Constructors and function parameters may still override defaults
for a particular simulation. Scenario data and provider-specific transport settings
remain with their existing owners.

## Authority and information boundaries

- `Battlefield` and its mutable `Soldier` objects hold authoritative global state,
  including scenario-defined communication groups and soldier memberships.

- Agents do not receive that global state. They receive an `AgentContext`
  containing the soldier's current local observation, a bounded history of earlier
  local visibility with the soldier's own position and submitted action, their
  bounded incoming-fire history, their available communication groups, and a
  bounded history of messages they sent or received.

- Python action chooser also receives the live `Battlefield` and `Soldier` so it
  can validate a proposed action before returning it to the loop. This is an internal
  engine boundary; objects are not serialized into the prompt.

Agents propose actions, while the engine owns adjudication and state mutation:

1. `LoopEngine` derives local observations from global truth.
2. The action chooser returns at most one proposed physical action (`hold`, `move`,
   or `shoot`) and one optional broadcast per soldier.
3. Resolvers validate and resolve the complete action and broadcast batch.
4. `LoopEngine` commits accepted movement, casualty, and message-history effects.

The ordering of `battlefield.soldiers` is an implicit identity system. Soldier
indices align actions, observations, visibility histories, communication histories,
message senders, snapshots, and shot outcomes. There is no independent soldier
identifier in the current model.

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
- Every soldier position supplied at construction must equal the battlefield's
  ground `Position` at that XY coordinate.
- Elevation may be any integer. The engine does not impose sea level, minimum
  elevation, or maximum elevation.

The default flat-ground elevation is hardcoded as `z = 0`. Width, height, and a
custom collection of ground `Position` values are scenario inputs.

### Terrain classes

- Every in-bounds cell has exactly one terrain class, drawn from a fixed set of
  ten.
- Terrain class is a scenario input. Cells left unspecified are open ground.
- Terrain does not change during a simulation. The engine models no fire, no
  demolition, and no weather effect on ground.
- One cell holds one class. A cell cannot be both forest and structure; a mixed
  cell must be approximated by whichever class dominates it.

Each class carries a profile of five independent properties. Independence is the
point: a cell can be slow without being opaque, opaque without being solid, or
solid without being opaque. A single cover/concealment flag pair could not express
those combinations, which is why it was replaced.

| Class         | Glyph | Passable | Move cost | Opacity/m | Concealment | Protection |
| ------------- | :---: | :------: | --------: | --------: | ----------: | ---------: |
| Open Ground   |  `.`  |   yes    |       1.0 |      0.00 |        0.00 |       0.00 |
| Grassland     |  `,`  |   yes    |       1.1 |      0.01 |        0.10 |       0.00 |
| Scrub / Bush  |  `;`  |   yes    |       1.6 |      0.03 |        0.45 |       0.05 |
| Dense Forest  |  `^`  |   yes    |       2.0 |      0.05 |        0.70 |       0.15 |
| Wetland       |  `_`  |   yes    |       2.5 |      0.01 |        0.15 |       0.00 |
| Water         |  `~`  |    no    |       4.0 |      0.00 |        0.00 |       0.00 |
| Urban Area    |  `o`  |   yes    |       1.2 |      0.10 |        0.60 |       0.40 |
| Structure     |  `#`  |    no    |       4.0 |      1.00 |        0.00 |       0.90 |
| Road          |  `=`  |   yes    |       0.8 |      0.00 |        0.00 |       0.00 |
| Barren / Rock |  `%`  |   yes    |       1.4 |      0.08 |        0.20 |       0.30 |

These are tunable simulation assumptions rather than measured values. Opacity is
calibrated against one-metre cells so that dense forest blocks sight at roughly
twenty metres while a structure blocks immediately.

Move cost is recorded but has no effect today. Every legal move costs the same
regardless of the terrain entered. The property states an intended model that the engine does not yet honour.

### Initial occupancy

- Battlefield construction permits multiple soldiers to start in one cell.
- Battlefield construction permits a soldier to start on impassable terrain, even
  though normal movement cannot enter it. Such a soldier can move off the cell but
  never back onto it.
- Soldiers do not block vision as physical objects.

### Imported terrain

A battlefield may be built from real ground exported by the frontend. That import
carries its own modeling assumptions:

- One grid cell is one metre, and one elevation level is one metre. Real metre
  elevations are rounded to integer levels with the lowest cell at zero.
- Rounding real ground to whole metres can create steps steeper than a soldier may
  climb, stranding soldiers behind terrain that is gentle in reality. The engine
  reports how many such steps a given import contains rather than smoothing them.
- Weather is not modeled. Exported visibility runs to thousands of metres, far
  beyond any vision range the engine uses, and no day or night penalty is applied.
- Imported units are placed on the nearest free passable cell to their real
  position. Two imported units never share a cell, unlike hand-authored scenarios.
- Exported objectives are described in grid coordinates but are not given to any
  agent. Which team receives an objective is a scenario decision.

## Soldier model

A soldier currently has five properties:

- team
- exact XYZ surface position
- survival state
- vision range
- communication group IDs

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

Communication group membership is a scenario input supplied per soldier. Battlefield
construction validates that every referenced group exists and belongs to the same
Blue or Red team as the soldier.

## Agent-local observations

Before action selection, `LoopEngine` builds one `ObservedSoldier` value for every
soldier. It contains:

- the observer's team
- the observer's exact position
- the observer's current survival state
- visible soldiers
- visible terrain cells with their terrain class.

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

- Terrain cells are included when they pass the observer's 3D range check, the
  terrain elevation line-of-sight check, and the accumulated opacity check. These
  are the same tests that decide whether an enemy standing on the cell would be
  seen. Terrain is perceived, not recalled from a map.
- The observer's current cell is included.
- Terrain entries contain exact XYZ and the cell's terrain class, named rather
  than numbered.
- Entries are produced in `y`-then-`x` order.
- Intervening opacity does hide terrain cells. A cell behind enough dense forest,
  or behind a single structure, is not observed.
- Concealment does not hide terrain cells. It models a soldier actively avoiding
  being picked out, which ground cannot do, and it is a per-tick random roll, so
  applying it would make terrain flicker in and out between ticks.
- Casualties and dead soldiers still receive terrain observations because terrain
  observation construction does not filter by survival state.

The terrain scan is limited to a square window derived from the lower of the
soldier's vision range and the global vision cap. Every candidate still goes through
the full 3D range and terrain line-of-sight checks.

## How terrain reaches an agent

An agent receives its terrain as a drawn map rather than as a list of cells. This
is an information-model decision, not a formatting one, so it belongs to the
engine's behavior:

- The map is one character per cell, oriented north-up and east-right, matching the
  battlefield's own axes. A bearing read off the map is the bearing the soldier
  moves on.
- Cells the soldier cannot see are blank. The shape of a soldier's vision, and the
  shape of whatever blocks it, are therefore visible to the agent rather than
  implied.
- Elevation is given per cell, expressed relative to the lowest cell the soldier
  can see. That baseline and the soldier's own elevation are stated in absolute
  metres, so true elevations remain recoverable.
- The agent and a human operator watching the run read the same map, so the two
  cannot hold different pictures of the same ground.
- Earlier ticks are summarized as the soldier's own track: where it stood and what
  it submitted, without the terrain it saw at the time.

The last point is a deliberate limit on memory. A soldier is not given a
remembered map: ground seen earlier and no longer in sight is simply gone from its
context, and only currently visible terrain informs a decision.

## Vision and detection

### Tunable vision parameters

| Parameter            |   Current default | Runtime owner       |
| -------------------- | ----------------: | ------------------- |
| Soldier vision range |            `10.0` | `Soldier`           |
| Maximum vision range |           `100.0` | `VisionResolver`    |
| Soldier eye height   |             `1.0` | `VisionResolver`    |
| Terrain opacity      |         per class | `TERRAIN_PROFILES`  |
| Terrain concealment  |         per class | `TERRAIN_PROFILES`  |
| Detection randomness | unseeded `Random()` | `VisionResolver`   |

All defaults come from `athena/params.py`. Soldier vision range remains a
per-soldier scenario input; range cap, eye height, and the random generator can be
overridden when constructing a `VisionResolver`. Opacity and concealment are
properties of the ground rather than of the observer, so they vary by cell and
cannot be set per run.

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

- Observer and target sight points are the configured soldier eye height above
  their ground positions. The current default is one elevation level.
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

### Terrain opacity

- Opacity accumulates along a sightline instead of blocking outright. Each
  intervening cell contributes its opacity per metre multiplied by the metres of
  sightline crossing it, and sight is blocked once the running total reaches
  `1.0`.
- The sightline's full 3D length is divided evenly across the cells it crosses,
  which keeps the threshold direction-independent: a diagonal sightline covers
  more ground per cell and is obscured proportionally.
- Cells are one metre, so at `0.05` per metre dense forest blocks sight at roughly
  twenty metres, while a structure at `1.00` blocks on the first cell entered.
- Observer and target cells are excluded, so a soldier standing in forest is not
  blinded by its own cell.
- Friendly soldiers ignore opacity entirely. A soldier always sees its own side
- Terrain itself is obscured by opacity for every observer, with no friendly
  exception.

The friendly-opacity exception is a hardcoded information-model shortcut. Opacity
does not modify rifle hit probability; terrain protection is a separate profile
field.

### Concealment

- Concealment affects detection only when an alive enemy occupies a concealment
  cell.
- Intervening concealment has no effect.
- Friendly soldiers ignore concealment.
- The probability that concealment hides its occupant is the concealment value of
  the terrain class the occupant stands on:

$$
P(\text{hidden}) = \min\left(1, c_{\text{terrain}}\right).
$$

- The occupant stays hidden when `roll < P(hidden)`; otherwise detection succeeds.
- Concealment is live by default. Six of the ten classes conceal, led by dense
  forest at `0.70`, urban at `0.60`, and scrub at `0.45`.
- Detection is rerolled whenever visibility is recomputed.
- Detection is not remembered, shared between soldiers, or stored in battlefield
  snapshots.
- Concealment does not modify rifle hit probability after detection. Concealment
  governs being seen and protection governs being hit; they are independent
  profile fields, and a class may have one without the other.

The concealment resolver accepts an injectable random generator.

## Movement

### Tunable movement parameters

| Parameter                |     Current default | Runtime owner      |
| ------------------------ | ------------------: | ------------------ |
| Maximum elevation change |                 `1` | `MovementResolver` |
| Conflict randomness      | unseeded `Random()` | `MovementResolver` |

The elevation default comes from `athena/params.py`. Both values can be injected
today, although there is no central run-level random seed.

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
6. The destination's terrain class is passable. With current profiles that
   excludes Water and Structure. A soldier told why its move failed is told which
   class blocked it.

The destination `z` is always read from the battlefield surface. Uphill and downhill
use the same elevation limit.

Diagonal moves check only the destination. For a move from `(1,1)` to `(2,0)`, cells
`(1,0)` and `(2,1)` are ignored, allowing corner-cutting.

Movement distance, direction set, diagonal cost, corner-cutting, and cover
impassability are hardcoded rules.

Terrain does not slow movement. A soldier crosses wetland and road at the same
rate, and the profile's move cost has no effect on the simulation today.

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

| Parameter                    |     Current default | Runtime owner      |
| ---------------------------- | ------------------: | ------------------ |
| Base hit probability         |              `0.90` | `ShootingResolver` |
| Elevation modifier per level |              `0.02` | `ShootingResolver` |
| Minimum hit probability      |              `0.50` | `ShootingResolver` |
| Maximum hit probability      |              `0.99` | `ShootingResolver` |
| Terrain protection           |           per class | `TERRAIN_PROFILES` |
| Hit randomness               | unseeded `Random()` | `ShootingResolver` |

The four probability defaults come from `athena/params.py` and can be overridden
when constructing a `ShootingResolver`. Terrain protection is a property of the
target's ground and cannot be overridden per run.

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
- Terrain protection is taken from where the target stood before the tick, so a
  target that runs from a structure into the open is still sheltered against that
  tick's fire, and one running the other way gains nothing.
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
\right)
\times
\left(1 - \operatorname{clamp}(c_{\text{protection}}, 0, 1)\right).
$$

High ground increases probability by two percentage points per level with current
defaults, while low ground decreases it by the same amount. A uniformly distributed
random roll in `[0, 1)` produces a hit when `roll < P(hit)`.

Terrain protection is applied **after** the marksmanship clamp, so an accepted
shot can fall below `p_min`. The floor and ceiling describe how well a soldier can
shoot, not how sheltered the target is. A target in a structure at protection
`0.90` is hit with probability `0.09` against the `0.90` base, well under the
`0.50` floor.

### Incoming-fire awareness

- Every resolved shot creates an incoming-fire alert whether it hits or misses.
  An action that cannot bind one living enemy target creates no shot outcome and no
  alert.
- A recipient must have been alive in the shared pre-tick snapshot, must not be the
  shooter, and must be within the configured radius of the target's pre-tick
  position. The default radius is ten metres and includes its boundary.
- Recipient team does not matter. Friendly and enemy soldiers near the targeted
  zone hear the same shot.
- The proximity check uses full 3D Euclidean distance. Terrain, opacity, protection,
  concealment, and line of sight do not attenuate or block sound.
- Each recipient gets a bearing calculated from its own pre-tick position toward
  the shooter's pre-tick position. The bearing is rounded to the nearest of the
  eight movement directions. A colocated source is described as being in the
  recipient's immediate vicinity.
- Each recipient gets its own coarse source-distance band using full 3D Euclidean
  distance: `near` through five metres, `medium` through ten metres, and `far`
  beyond ten metres. The shooter identity and exact position are not revealed.
- Alerts created during tick `N` first reach an alive soldier's OpenRouter context
  during tick `N + 1`, so no agent reacts inside the simultaneous tick that created
  them.
- Incoming-fire history is maintained separately per soldier index and keeps every
  alert from the last ten completed ticks, oldest first. Multiple shots can create
  multiple entries for one soldier in one tick.
- Incoming-fire history is loop state. It is absent from battlefield snapshots and
  replay logs; replay already records the resolved shots themselves.

The radius, distance thresholds, and history window come from `athena/params.py`
and can be overridden when constructing `LoopEngine`.

## Agent action-selection loop

### Tunable loop and provider parameters

| Parameter                  |              Current default | Runtime owner                      |
| -------------------------- | ---------------------------: | ---------------------------------- |
| Maximum action attempts    |                          `3` | `LoopEngine` and agent functions   |
| Visibility history limit   |                         `10` | `LoopEngine`                       |
| Communication history limit |                        `10` | `LoopEngine`                       |
| Incoming-fire radius       |                     `10.0 m` | `LoopEngine`                       |
| Incoming-fire near band    |                      `<= 5 m` | `LoopEngine`                       |
| Incoming-fire medium band  |                     `<= 10 m` | `LoopEngine`                       |
| Incoming-fire history      |                   `10 ticks` | `LoopEngine`                       |
| Team message length         |           `280` characters | communication models               |
| OpenRouter prompt template |             tunable template | `params.py`                        |
| Hosted model               |   `openai/gpt-oss-120b:nitro` | `agent.py`                         |
| Ollama host                |     `http://localhost:11434` | `ollama_agent.py` or `OLLAMA_HOST` |
| Ollama discovery timeout   |                 `10` seconds | `ollama_agent.py`                  |
| Ollama action timeout      |                `120` seconds | `ollama_agent.py`                  |

The action-attempt, incoming-fire, and history defaults come from `athena/params.py`.
The OpenRouter prompt is rendered from the effective history limit and movement
resolver, so constructor overrides remain aligned with the behavior described to
the model.
The OpenRouter prompt template is tunable in `params.py`; Ollama retains its separate
movement-only prompt in `ollama_agent.py`. Provider model, host, and timeout defaults
remain in their provider modules.

### Action schema and retries

- The physical-action schema supports hold, move, and shoot.
- `HoldAction` has no parameters. It is accepted without a resolver and produces no
  movement, shot, or battlefield-state mutation. A valid broadcast attached to the
  same turn is still delivered.
- There is no explicit observe, take-cover, treat, or plan action.
- OpenRouter may propose holding, movement, or shooting plus one optional
  communication-group broadcast in the same turn.
- Ollama is intentionally movement-only and rejects every shoot proposal.
- Ollama does not receive communication context or propose broadcasts.
- The chooser requests up to `max_attempts` proposals and returns the first
  individually legal action.
- Every retry uses the same observation. After an individually illegal action, the
  next OpenRouter request also receives the rejected action and a short reason from
  the movement or shooting resolver. Detailed movement reasons are included only
  when the determining terrain is present in the current observation; otherwise the
  retry receives a generic movement-rule rejection.
- Exhausting retries returns `None`, causing no action during execution.
- Each retry is another model request.
- The action schema is binding rather than advisory. A model that returns
  something merely shaped like an action has its turn rejected as a schema
  failure rather than treated as a proposal.
- The structured-output boundary accepts a nested action that some models return as
  JSON encoded inside a string. Pydantic schema failures wrapped by the OpenRouter
  output parser are retried with concise validation feedback that excludes the raw
  malformed action value. Bare Pydantic errors and other parser failures propagate
  and fail action collection.
- An inaccessible broadcast group is dropped without rejecting an otherwise legal
  physical action.

### Prompt assumptions

The prompts currently embed scenario and engine rules directly:

- The default OpenRouter objectives and the Ollama objectives say Blue advances east
  and Red advances west. An OpenRouter caller may replace the complete team-objective
  section for a scenario or team without changing the structural engine rules.
- Movement is one cell.
- Maximum elevation change is rendered from the active movement resolver.
- Impassable classes are named from the profile table rather than written out.
- Occupied stationary cells are unavailable.
- The map format itself is described: one character per cell, a legend, an
  elevation grid beneath, blank for cells with no line of sight, and the
  soldier's own coordinates marked.
- OpenRouter may hold position.
- OpenRouter may shoot visible living enemies.
- Ollama may not shoot.
- The OpenRouter history description is rendered from the active loop limit.
- OpenRouter is told that broadcasts must target one of the communication groups in
  its context and arrive on the next tick.
- OpenRouter is told that incoming-fire entries give an approximate bearing and
  distance to a shot's source without revealing the shooter's identity or exact
  position.

Team-objective text is a scenario assumption. OpenRouter renders a caller-supplied
objective when present and otherwise retains its default objectives. Structural hold,
movement, and shooting statements still mirror hardcoded engine behavior, while the
tunable elevation and history values are inserted from the effective runtime values.

Terrain guidance is derived from the profile table rather than written out, so
what an agent is told about terrain cannot contradict what the resolvers do with
it. Only classes whose effect is strong enough to matter tactically are named;
concealment and protection are described only for classes a soldier can stand on.

Ollama receives the same terrain guidance. It remains movement-only and still
receives no communication or incoming-fire context.

### Scheduling and failure behavior

- `LoopEngine` schedules action-chooser calls only for alive soldiers. Casualties
  and dead soldiers receive `None` without invoking the chooser.
- All alive-soldier chooser calls run concurrently through `asyncio.gather`.
- Result order remains aligned with soldier order.
- If any chooser raises, action collection raises and execution does not commit a
  state change for that tick.
- OpenRouter has no explicit request timeout in Athena's code.
- There is no retry policy for transport failures distinct from invalid actions.

### Visibility history

- History is maintained separately for each soldier index.
- The current observation is sent separately from history.
- Each completed tick appends the exact pre-action visibility and own position that
  informed that tick's decision, together with the action submitted for resolution.
- A historical submitted action is a hold, a move with its direction, a shot with
  its exact target coordinates, or `None` when no action was submitted.
- The submitted action does not report its resolved outcome. In particular, history
  does not say whether a move was accepted or rejected or whether a shot hit or
  missed.
- History omits the observer's historical team and survival state.
- Entries are kept oldest to newest.
- The default rolling limit is ten.
- An entry records the terrain visible at that tick, but an agent is not shown it.
  Only the soldier's own track reaches the agent, so past terrain is engine
  bookkeeping rather than agent memory. See How terrain reaches an agent.
- Ollama receives only the current observation and does not receive history.

## Team communication

### Communication groups and membership

- `Team` still means the Blue or Red faction. A `CommunicationGroup` is a separate,
  scenario-defined broadcast group with a unique ID, display name, and owning team.
- A soldier may belong to zero, one, or multiple communication groups.
- A soldier may only join communication groups owned by its Blue or Red team.
- Membership grants both send and receive access. Roles such as rifleman, sergeant,
  or commander are not modeled; scenarios express their communication access through
  group membership.
- Groups do not relay messages automatically. A soldier belonging to two groups must
  deliberately repeat information from one group into the other.

### Broadcast and delivery semantics

- An OpenRouter turn contains one required hold, move, or shoot action and at most one
  optional `BroadcastDraft` with a group ID and message content.
- A valid broadcast is sent only when the soldier was alive in the shared pre-tick
  snapshot and belonged to the selected group.
- A soldier alive before the tick still transmits when made a casualty during the
  same tick, matching the snapshot-based movement and shooting semantics.
- Broadcasts are resolved in soldier-index order. Every member of the selected group,
  including the sender, records the resulting `TeamMessage` in that order.
- Messages sent during tick `N` first appear in agent context during tick `N + 1`.
- A message records the sent tick, communication group ID, sender soldier index, and
  content. It does not automatically reveal the sender's position.
- Message content must contain at least one character and no more than 280 characters.
- The engine currently has no communication range, loss, delay beyond one tick,
  interception, jamming, recipient selection, or send-only/receive-only permissions.

### Communication history

- History is maintained separately for each soldier index and contains messages the
  soldier sent or received through its communication groups.
- Messages from all accessible groups share one chronological history.
- The default rolling limit is ten messages, ordered oldest to newest.
- `AgentContext` includes the soldier's available group descriptions and current
  communication history. Both are rendered into each OpenRouter request as a
  radio-nets list and a radio-traffic log, so these messages consume model
  context-window tokens.
- Communication history is loop state and is not included in battlefield snapshots.
- Ollama receives no communication groups or communication history.

### Replay representation

- Replay schema version is **3**. Version 3 replaces the `cover` and
  `concealment` position tuples with `terrain_classes`, a row-major class grid
  holding one entry per width x height cell. A client written against version 2
  cannot read a version 3 log.
- Replay records communication groups once as static battlefield
  data, including each group's ID, display name, team, and soldier member indices.
- Every completed replay step records each accepted team message once, in
  sender-index resolution order. A replay message contains its sender soldier index,
  communication group ID, and content.
- A message in replay step `N` was sent during the transition from step `N - 1` to
  step `N`. Replay clients derive its origin from the sender's position in the
  preceding step and its recipients from the communication group's member indices.
- The initial step has no messages. Rejected broadcast drafts and per-soldier rolling
  communication histories are not included in replay logs.

## Tick and execution semantics

A normal tick has two phases:

1. Build local observations and collect at most one individually valid action per
   soldier.
2. Capture a global before-snapshot, resolve all actions and broadcasts against that
   state, commit accepted effects and message histories, and capture an after-snapshot.

The execution assumptions are:

- Every soldier acts from the same pre-action world state.
- Movement and shooting resolve independently from the same snapshot.
- Accepted positions are committed before casualty transitions.
- Same-tick casualties do not cancel accepted movement or shooting.
- Same-tick casualties do not cancel a broadcast proposed while the sender was alive.
- There is no initiative, reaction, interrupt, or within-tick team ordering.
- A `HoldAction` records an explicit decision to stay in place and leaves battlefield
  state unchanged, although its optional broadcast can still update communication
  history.
- A `None` action leaves that soldier unchanged.
- An `ExecutionResult` records submitted actions, shot outcomes, accepted team
  messages, pre-action observations, and immutable before/after snapshots.
- A snapshot carries the terrain grid, so terrain effects during resolution are
  read from the same frozen world state as positions and survival, never from live
  state mid-tick.
- `execute_actions()` assumes one action-list entry per soldier but does not validate
  the list length.
- The core loop has no automatic victory condition

## Internal contracts and validation assumptions

The following behavior is enforced through normal construction and `tick()` usage,
but lower-level APIs can bypass it:

TO AGENTS: This is okay, no need to fix unless it has been proven to break something

- `Soldier.move_to()` does not validate surface membership or movement legality.
- `execute_actions()` assumes its actions have already passed observation-based
  validation.
- Initial soldier overlap and soldier-on-impassable-terrain placement are allowed.
- Positive battlefield dimensions are assumed rather than explicitly validated.
  except on the imported-terrain path.
- Vision ranges and resolver parameters are assumed to be sensible and non-negative.
- Probability parameter ordering and bounds are not validated.
  values are likewise unchecked and only clamped at the point of use.
- Terrain effects are global. Changing one class's profile changes movement
  legality, sight, and gunfire at once, and also changes how already-recorded
  replays are interpreted, because a replay stores which class each cell was
  rather than what that class did.
- Action-list length is assumed to match soldier count.
- RNG state is absent from snapshots.

## Hosted batch execution

The hosted engine adds a transport and scheduling boundary around the same engine
loop. It does not change combat resolution.

- `POST /v1/simulation-batches` accepts a multipart `payload` file, a positive
  `simulationCount`, a positive tick limit, and an optional OpenRouter model ID.
  The payload may be JSON or gzip-compressed JSON and is validated through the
  existing imported-terrain payload model before any jobs are queued.
- One independent job is created per requested simulation. Every job constructs
  its own battlefield and loop state from the payload. Hosted runs use the units
  supplied by the frontend export; they do not use the demo's hardcoded deployment
  or its rule that pins Red movement.
- Each run stops at its tick limit or when either Blue or Red has no living
  soldiers. The resulting replay uses schema version 3.
- Redis is the job queue. The worker's `WORKER_CONCURRENCY` setting bounds the
  number of simulations in flight in one worker service. Within each simulation,
  living-soldier chooser calls retain the loop's existing concurrent scheduling.
- Postgres stores batch, simulation, and ordered completion-event state. The API
  creates the required tables and index on startup.
- Submitted payloads and gzip-compressed replay logs are private bucket objects.
  `GET /v1/simulation-batches/{batch_id}/events` is a reconnectable server-sent
  event stream. A completed-simulation event receives a newly generated presigned
  replay URL whenever the event is read, including after reconnection.
- An engine or provider exception marks that simulation failed and emits
  `simulation.failed`; the remaining simulations continue. A job interrupted by
  worker shutdown may be reclaimed once after restart. The batch completes after
  every simulation reaches completed or failed state, and its final status is
  failed when any simulation failed.
