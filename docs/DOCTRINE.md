# DOCTRINE

Single source of truth for the doctrinal model Athena implements. Anything in
the codebase that encodes a doctrinal fact — an echelon, a reserve level, a
timing, a road class, a weapon–target pairing — derives from this file. If code
and this file disagree, this file is wrong or the code is; they do not get to
hold different views.

## Provenance and confidence

Material here comes from three sources, and every section says which:

| Mark | Meaning |
|---|---|
| **[TA]** | *SAF Training Aggressor 2016 (caa Sep 2018)*, RESTRICTED. Held locally, not committed to this repository. |
| **[CONV]** | Conventional NATO/Commonwealth usage. Sound, but not traceable to a document held here — confirm against your own manuals before relying on a figure. |
| **[OPEN]** | Not established. A placeholder or an open question. **Do not build on these.** |

Because [TA] is RESTRICTED: this repository is private, and the source PDF is
gitignored. Keep it that way.

---

## 1. Echelons

### Own force [CONV]

Athena models organisation down from a company. A company is always the root of
a faction's tree (`engine/athena/units.py`).

| Echelon | Depth | Commanded by |
|---|---|---|
| Company | 0 | Officer |
| Platoon | 1 | Officer |
| Section | 2 | Sergeant |
| Group | 3 | Man |

A unit's parent must sit at a strictly smaller depth. Because depth strictly
decreases upward and is bounded at zero, that one rule also makes parent cycles
impossible.

### Aggressor formations [TA]

| Abbrev | Meaning |
|---|---|
| RIR | REDLAND Infantry Regiment |
| RAIR | REDLAND Armoured Infantry Regiment |
| ABG | Armoured Battle Group |
| DRB | Div Recce Bn |
| DRC | Div Recce Coy |
| DRP | Div Recce Patrol |
| RRC | Regt Recce Coy |
| RRP | Regt Recce Platoon |
| CAR | Corps Armoured Regt |
| CIAIB | Corps Independent Armoured Infantry Bn |

Structure: Corps (XXX) → Division (XX) → Regiment (III) → Battalion (II) →
Company (I) → Platoon (ooo) → Section (oo).

### Composition modifiers [TA]

**Modifiers are read as minuses or pluses, each worth one third of
establishment.** `=` is two minus strokes, so it is two thirds removed.

| Modifier | Strength | Reading |
|---|---|---|
| `(=)` | 1/3 | two thirds taken away |
| `(-)` | 2/3 | one third taken away |
| *(none)* | 3/3 | full establishment |
| `(+)` | 4/3 | one third added |

The rule generalises: each stroke is a third, in either direction.

### Echelon is defined by the headquarters, not the headcount

**A company(=) is not a platoon.** It holds a platoon's worth of manpower, but
the company HQ is present, so it remains a company — with company-level command,
company-level tasking, and a company symbol.

**This applies at every echelon.** A battalion(=) is a battalion; a regiment(=)
is a regiment.

Two consequences for anything that reasons about force:

1. **Never infer echelon from strength.** They are independent. Deriving one
   from the other will misread every reduced formation on the map.
2. **Strength is computable from the modifier.** Establishment × the fraction
   above. Combined with structured `count × platform` composition (§5), a
   Coy(=) holds one third of the company's establishment weapons — which is
   what the block-force calculation needs.

---

## 2. Reserves

### Levels and the K-serial ladder [TA]

K-serials are **levels of commitment**, not timestamps. The enemy commits
reserves in escalating order.

| Serial | Commits |
|---|---|
| K | Outside Activities |
| K1 | Local Reinforcement |
| K2 | Coy Res |
| K3 | Bn Res |
| K4 | Div Res |

### Timing model [TA]

> K2 is commencement of movement *(inclusive of Decision Time and Readiness Time)*
> K2+½ is completion of the Reserve Task *(inclusive of Movement Time and Deployment Time)*

Four terms:

```
Decision Time + Readiness Time  →  commences movement
Movement Time + Deployment Time →  reserve task complete
```

Athena computes **Movement Time** only, from routing over the road graph. The
other three are doctrinal values per reserve level and must be supplied.

Time is expressed differently by level in the source: Coy Res in minutes, Bn Res
in fractions of an hour (`¼ hr` = 15 min).

### Intelligence status [TA]

| Status | Colour (Deployment overlay) | Basis |
|---|---|---|
| Assessed | Pink | Int Assessment only |
| Confirmed | Red | Two or more sources from collection agencies (Bde RSTA / Bn Scout / UAV) |

The two-source rule is a hard threshold, not a judgement. Where reserve
positions are derived from ingested documents, two independent documents
reporting the same position satisfy it.

### Task organisation [TA]

A reserve is a task organisation, not a single unit. Worked example:

- `Div Res 1` = `ABG(-)` + `DRB(-)` — "both task organised as Div Res 1"
- Splits into:
  - `Div Res 1A` — **Anvil** force, `DRB(=)`
  - `Div Res 1B` — **Hammer / Destruction** force, `ABG(-)` + `DRC`
- Order of move is explicit: DRC leads the convoy, followed by `ABG(-)`

### Location [TA]

Named terrain references, not coordinates: reserves at `TOMA 1b`, objectives at
`MATO 1b`. Rendered in prose as `IVO <locality>`.

---

## 3. Overlays

The three S2 products, and the app pass each corresponds to. [TA]

| Overlay | Content | App pass |
|---|---|---|
| Deployment | Reserve levels and assessed/confirmed positions | Marks / reserves (Step 3) |
| Enemy Conduct of Battle | K-serials, reserve moves and timings | Courses of action (Step 6) |
| Enemy Reaction to Ops Plan | Contact with block forces, outcomes | Block forces (Step 8) |

**Colour is overlay-scoped.** The same colour means different things on
different overlays — this is a trap for any shared rendering code:

| Overlay | Colour encodes |
|---|---|
| Deployment | Intelligence status — assessed pink, confirmed red |
| Enemy Conduct of Battle | Reserve level — Coy Res orange, Bn Res pink, Regt Res brown |

### Reaction outcomes [TA]

Per reserve, the Reaction to Ops Plan overlay records a chain:

```
commenced D 2100 → contacted by block force D 2115
  → delayed ½ hr, attrited 1 x RRC → 1 x RRP
  → remnant continued → reached objective D 2200
```

Outcomes observed in the source: *destroyed at block position*, *delayed and
attrited*, *reached objective*, *did not reach objective*.

---

## 4. Ground

### Axes and corridors [CONV]

**An axis** is one route through the ground — a single path a force can move
along.

**A corridor is a bundle of axes.** It is the set of axes that together
constitute one approach: leading from the same place to the same place, through
the same gap in the terrain.

Worked example: north and south of a reservoir, two bundles of roads each run
from the north-east to the south-west. That is two corridors — a northern and a
southern — not one corridor, and not one corridor per road.

**Only roads and axes are considered.** No landcover, no trafficability surface,
no off-road terrain analysis. Everything is derived from the road graph.

This is sufficient, because the road network already encodes the obstacles:
where ground is impassable there are no roads across it. Two axes either side of
a reservoir are close in straight-line distance but very far apart *through the
network* — you would have to drive around. That ratio is the separator signal,
and it needs no terrain data.

(Node elevation stays. It is sampled at road nodes and used for gradient in
movement rate — a property of the axis itself, not separate terrain analysis.)

Two errors to avoid, both of which have been made here:

| Error | Why it is wrong |
|---|---|
| One axis = one corridor | A corridor is a bundle. A lone road is an axis, and calling it a corridor overstates the number of approaches. |
| A corridor is a polygon of terrain | The corridor is the axes. Terrain decides which axes group together, and nothing more. |

**Grouping rule.** Axes belong to the same corridor when they are:

1. **Laterally close** — small straight-line separation
2. **Directionally aligned** — running the same way through the ground
3. **Laterally connected** — network distance between them is of the same order
   as their straight-line separation

Criterion 3 is what does the separating. Two axes across an obstacle satisfy 1
and 2 but fail 3, because the network has to go around.

**Shared road segments are not required and must not be the criterion.** Two
parallel roads through the same gap share no segments whatever and are plainly
one corridor. This is precisely the error in the current implementation.

### Axis identity and destruction [CONV]

**An axis keeps its name when it is destroyed.** If the axis named `PROTON` is
cut, it remains `PROTON` — marked destroyed, not removed. The commander needs to
be able to ask how the loss of `PROTON` reshaped the theater, and that question
is unanswerable if the axis simply disappears from the record.

So: **destruction is a state change, never a deletion.** A revision of the graph
marks an axis destroyed; it does not drop it. Comparing the shape of the
corridors before and after a break is the point of keeping it.

**A name belongs to the road, not to a segment of it.** A break may be applied to
a *portion* of an axis, which splits it into the stretch before, the broken
stretch, and the stretch after. All three are still `PROTON`; only the middle one
is destroyed. A name held against a segment would either be lost or duplicated by
that split, so names attach to road identity and segments reference it.

### Inlets and choke points [CONV]

**Each axis is an inlet** — its own way in. Blocking one axis does not block the
corridor it belongs to.

This is why coverage beats concentration (§5): a corridor of four axes needs
four block positions, not one strong one.

A **choke point** exists only where every axis in the corridor must cross the
same ground — a defile, a crossing, a bridge. Where the axes share no such
ground, the corridor has no single choke point, and the honest answer is that
it must be held axis by axis rather than at one position.

### Route classification [CONV]

Roads are coded `NAME(<width> <type>)`.

| Element | Values |
|---|---|
| Width | `2` / `4` / `6`, with `//` marking a dual carriageway |
| Type | `X` all-weather heavy · `Y` all-weather limited · `Z` fair-weather only |

Worked examples:

```
KRANJI(4 X)     single carriageway, all-weather heavy
BKE(6// X)      dual carriageway, all-weather heavy
MANDAI(2 Z)     single carriageway, fair-weather only
```

Width and type are **pre-filled from extracted data** — OSM `lanes` and highway
class give a first guess — and are **always operator-editable**. The extraction
is a starting point, never an assertion.

### Road naming [CONV]

Roads are named on a **theme**, using **two-syllable** names. The theme is
chosen per AO; names are drawn from it in sequence so that any road can be
referred to unambiguously over voice.

Two syllables is the operative constraint — it keeps a name distinct over a
degraded net without becoming a mouthful. Examples of the shape required:
`FALCON`, `COBRA`, `RAVEN`, `TIGER`, `VIPER`, `KESTREL`.

---

## 5. Targeting

### Effects [CONV]

What the fire is meant to achieve. The effect required drives the pairing, not
the target alone.

| Effect | Meaning |
|---|---|
| Destroy | Rendered combat-ineffective permanently; must be reconstituted |
| Neutralise | Rendered temporarily ineffective |
| Suppress | Prevented from effective fire while fires continue |
| Harass | Denied rest, movement or reorganisation |

**No casualty percentages.** Conventional planning figures circulate (~30% for
destroy, ~10% for neutralise) but they are deliberately not recorded here, and
nothing is to use them. Attrition is expressed in composition notation instead —
see below.

### Target hardness [CONV]

The axis that governs weapon–target matching.

| Class | Description | Examples |
|---|---|---|
| **Soft skin** | Unarmoured or negligible armour | Trucks, jeeps, logistic vehicles, gun tractors, towed systems |
| **Hard skin — light** | Armoured; proof against small arms and shell splinter | APC, IFV — BTR-90, BMP |
| **Hard skin — heavy** | Main battle tank; frontal protection defeats most man-portable AT | MBT |
| **Personnel** | Sub-classified by protection: in the open, in trench, in building | — |
| **Fortification** | Bunker, hardened position | — |

**Hardness is a property of the platform, not of the unit.** It is looked up
from the platform catalogue (§6), never typed per unit. This requires unit
composition to be structured as `count × platform` rather than free text.

### Weapon–target matching [CONV]

| Target | Preferred | Acceptable | Ineffective or wasteful |
|---|---|---|---|
| Personnel in the open | Artillery / mortar HE, GPMG, AGL | Small arms | ATGM — waste |
| Personnel in trench | Mortar HE (high angle), direct fire into aperture | AGL | Small arms — little effect |
| Soft skin vehicle | HMG, AGL, fragmentation, mines | RPG, small arms at close range | ATGM — waste |
| Hard skin, light | ATGM, RPG, recoilless (SPG-9), autocannon | 14.5mm HMG at close range, flank or rear | Small arms — ineffective |
| Hard skin, heavy | ATGM (top attack), tank main gun, heavy AT mine | RPG at flank or rear only | HMG, small arms — ineffective |
| Fortification | Recoilless, thermobaric, direct HE, engineer demolition | Mortar — suppression only | Small arms — ineffective |
| Helicopter | MANPADS, SPAAG | HMG | — |

Two rules the table encodes:

1. **Never pair a scarce AT weapon with a soft target.** An ATGM expended on a
   truck is an ATGM unavailable for the APC behind it.
2. **Penetration is required for hard skin; fragmentation is not.** Small arms
   and splinter are ineffective against armour regardless of volume.

### Block forces [CONV]

**A block force is measured in weapons, not manpower.** Headcount does not say
what a force can stop. The number of weapons capable of defeating the reserve's
platforms is what determines how many of those platforms it can down.

**There is no largest-formation-per-route rule.** No echelon ceiling governs
what may be committed to a single corridor. The problem is an allocation one:
distribute the available block force across block positions so as to seal as
much as possible.

**The allocation objective is coverage: a force at every possible inlet.**
Sufficiency is *not* the constraint — we do not require enough at an inlet to
destroy what comes down it. An inlet with a force on it is covered; an inlet
with nothing on it is open, and an open inlet is the failure this pass exists
to prevent.

So allocation maximises the number of inlets held, and never concentrates force
at one inlet at the cost of leaving another bare.

Sufficiency is still **reported**, because the commander needs to know which of
the held inlets will actually stop what arrives. Comparing the block force's
effective weapons against the reserve's platforms gives the outcome chain of §3:

| Condition | Outcome |
|---|---|
| Effective weapons ≥ reserve platforms | Reserve destroyed at the block position |
| 0 < effective weapons < reserve platforms | Reserve delayed and attrited; remnant continues |
| No effective weapon against that hardness | Reserve passes essentially unimpeded |

"Effective" is decided by the pairing table above: weapons that cannot defeat
the reserve's hardest platforms do not count, however many there are.

The distinction that matters: **coverage drives allocation, sufficiency
describes the result.** A thinly held inlet is a reported risk, not a reason to
strip another inlet to reinforce it.

### Attrition [CONV]

**Attrition is expressed as composition reduction, never as a casualty
fraction.** This is how the source records it (§3): *attrited from 1 x RRC to
1 x RRP*.

Two distinct questions, and they must not be conflated:

| Question | Answered by |
|---|---|
| *Can* this weapon defeat that target? | Weapon–target matching — the pairing table above. A gate, yes or no. |
| *How much* of the force is left afterwards? | Attrition — the arithmetic downstream of that gate. |

Matching runs first and decides which of the block force's weapons count at all.
Rifles do not become effective against armour by being numerous.

**The calculation is deterministic and needs no percentages.** Effective weapons
are counted against the reserve's platforms; the shortfall is what continues.
The result is written in the notation of §1:

| Result | Written as |
|---|---|
| Reduced by a third | `RRC(-)` |
| Reduced by two thirds | `RRC(=)` |
| Reduced far enough to lose the HQ | `RRP` — a genuine echelon drop |

The last row is why `RRC → RRP` reads as worse than `RRC → RRC(=)`: the same
notation that makes a Coy(=) still a company (§1) makes the loss of the
headquarters the thing that actually drops an echelon.

---

## 6. Platform catalogue [TA]

Aggressor platforms and weapons, with hardness where the platform is a vehicle.
Quantities are establishment figures from the source ORBAT.

| Platform | Type | Hardness | Establishment |
|---|---|---|---|
| BTR-90 | APC | Hard skin — light | 10 x per Recce Coy |
| Truck | Transport | Soft skin | 2 x per Bn Res Inf Pl |
| 2B11 120mm mortar | Indirect fire | — (towed; tractor soft skin) | 9 x per Mortar Coy |
| 81mm mortar | Indirect fire | — | 6 x per Mortar Pl |
| 60mm mortar | Indirect fire | — | 1 x per Mortar Section |
| DRAGON | ATGM | — | 6 x per ATGM Pl; 2 x per Anti-Tank Pl |
| SPG-9 | Recoilless | — | 1 x per Anti-Tank Section |
| RPG-16 | RPG | — | 1 x per Anti-Tank Section |
| RPG-22 | LAW | — | Rifle section |
| AGS-17 | AGL | — | 6 x per AGL Pl; 2 x per Anti-Tank Pl |
| NSV | 12.7mm HMG | — | 4 x per HMG Section |
| SA-16 GIMLET | MANPADS | — | 6 x per SAM Pl |
| Dragunov | 7.62mm sniper | — | 6 x per Sniper Pl |

---

## 7. Own force — the light battalion [CONV]

We think of ourselves as a **light battalion** first. Structure mirrors the
aggressor's `1/901 Inf Bn` closely; weapon names are capability-generic.

### Organisation

```
Light Infantry Battalion
├── HQ Coy
│   ├── Signal Pl
│   └── Pioneer Pl
├── A Coy ─┐
├── B Coy  ├─ Rifle Companies (3)
├── C Coy ─┘
│   ├── 3 x Rifle Pl
│   │   └── 3 x Rifle Section
│   ├── Anti-Tank Section
│   └── Mortar Section
└── Support Coy
    ├── ATGM Pl
    ├── Anti-Tank Pl
    ├── AGL Pl
    ├── Mortar Pl
    ├── HMG Section
    └── Recce Pl
```

### Holdings

| Sub-unit | Holding |
|---|---|
| Support Coy — ATGM Pl | 6 x ATGM |
| Support Coy — Anti-Tank Pl | 2 x ATGM, 2 x AGL |
| Support Coy — AGL Pl | 6 x 40mm AGL |
| Support Coy — Mortar Pl | 6 x 81mm mortar |
| Support Coy — HMG Section | 4 x 12.7mm HMG |
| Support Coy — Recce Pl | 2 x mini UAV |
| Rifle Coy — Anti-Tank Section | 1 x light RR, 1 x LAW |
| Rifle Coy — Mortar Section | 1 x 60mm mortar |
| Rifle Section | 1 x GPMG, 1 x SAW, 1 x LAW, grenadier |

### Weapon catalogue

Names are capability-generic on purpose — the pairing table in §5 works on what
a weapon defeats, not on its trade name.

**The generic names are the working set.** The local designation column is left
open to be filled in later; nothing downstream depends on it, so it blocks
nothing.

| Generic name | Type | Defeats | Local designation |
|---|---|---|---|
| ATGM | Anti-tank guided missile | Hard skin, heavy and light | |
| Light RR | Recoilless, 84mm class | Hard skin light; heavy at flank/rear | |
| LAW | Light anti-armour, disposable | Hard skin light; heavy at flank/rear only | |
| 40mm AGL | Automatic grenade launcher | Soft skin, personnel | |
| 12.7mm HMG | Heavy machine gun | Soft skin, personnel; light armour close/flank | |
| GPMG | General purpose machine gun | Personnel, soft skin | |
| SAW | Section automatic weapon | Personnel | |
| 81mm mortar | Indirect fire | Personnel, soft skin | |
| 60mm mortar | Indirect fire | Personnel, soft skin | |
| mini UAV | Recce | — (observation only) | |

### Anti-armour holding

What the battalion can actually down, since §5 measures a block force in
weapons rather than manpower:

| Source | Weapons capable against hard skin |
|---|---|
| Support Coy ATGM Pl | 6 x ATGM |
| Support Coy Anti-Tank Pl | 2 x ATGM |
| 3 x Rifle Coy Anti-Tank Section | 3 x light RR, 3 x LAW |
| 9 x Rifle Section (per Coy, ×3) | 27 x LAW |
| **Battalion total** | **8 x ATGM, 3 x light RR, 30 x LAW** |

LAW counts against light armour only, and against heavy armour only from flank
or rear — so the battalion's usable figure against an armoured reserve depends
on the hardness it is facing, not on the raw total.

---

## 8. Readiness

### REDCON [CONV]

Readiness condition. **Orthogonal to availability** — a unit can be uncommitted
and REDCON 4 at the same time.

| Axis | Values | Question answered |
|---|---|---|
| Availability | uncommitted / committed / reserve | Is this unit free to be given the task? |
| REDCON | 1–5 | How quickly can it move if given the task? |

REDCON 1 is highest readiness (move immediately); 5 is lowest.

**Display only.** REDCON is shown on the ORBAT so the commander can see it, but
it does not constrain block-force allocation and does not feed the timing model.
The judgement stays with the operator.

---

## Open items

| § | Item |
|---|---|
| 7 | Local weapon designations to fill into the catalogue — generic names are the working set, so this blocks nothing |
