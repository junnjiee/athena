# Athena — Project One-Pager

**One line:** Athena lets a commander sketch a plan on real ground and instantly see the odds it works — *before* anyone steps off.

**The analogy:** Monte Carlo for the infantry commander — a flight simulator for ground tactics.

---

## The problem
When a platoon or company commander plans an attack or defence on a specific piece of ground, they weigh it in their head, on a map, and in a few rehearsals. There is no fast way to ask: *"If we run this exact plan 100 times on this exact terrain, how often does it succeed, and where do we take casualties?"* The big AI wargaming systems answer that question for **theatres and campaigns** — fleets, divisions, whole regions. **Nobody answers it at the tree-line:** the actual ground a section will cross.

## What Athena is
Athena turns a **real location into a playable, probabilistic wargame.** Pick a spot on the map and it builds the terrain, lets you draw your plan, simulates the fight hundreds of times with AI-driven soldiers, and hands you **the odds — not just one animation.**

## How it works
1. **Pick the ground.** Globe → map → a real objective (e.g. a local training area). Athena auto-reads slope, cover, vegetation density, and lines of sight.
2. **Draw the plan.** The commander sketches axes of advance, support positions, and objectives directly on the map — and can just *talk* to it ("add a platoon," "make it night," "drop visibility").
3. **Translate to intent.** The sketch becomes orders for individual AI agents — soldiers with vision, fatigue, weapons, and cover awareness.
4. **Simulate at scale.** Many runs in parallel (Monte Carlo), so terrain and chance produce a *range* of outcomes, not one lucky run.
5. **Read the odds.** Output is a distribution — mission-success %, sector-by-sector control, casualty bands — with an **evals** layer that checks the results are sane and calibrated.

## Why it's different
Funded AI wargaming (Thunderforge, GenWar, WarMatrix) plays at the **theatre level** and mostly uses AI as a planning *assistant*. Athena is the **tactical, ground-level** version: individual soldiers on **auto-generated real terrain**, producing **probabilistic outcomes for a platoon/company plan.**

> **They wargame the theatre. Athena wargames the tree line.**

Three things to point at:
- **Real ground, not a generic map** — satellite → playable terrain in minutes.
- **Answers as odds, not a playthrough** — a success % and casualty spread *per plan.*
- **Commander-native control** — draw it, talk to it, no training required.

## What the September demo shows
- One real training area, **auto-ingested** into a playable map with terrain-driven cover and visibility.
- A commander draws **two competing plans (A vs B).**
- Athena runs *N* simulations of each and returns **side-by-side odds** — success %, casualty bands, and *where each plan breaks.*
- One live **"talk to the sim"** change (e.g. switch to night) that visibly shifts the odds.

*The money shot: two plans in → two probability profiles out, on real ground, changed by voice, live.*

## Why now / who it's for
Defence buyers are already purchasing AI decision-support (DSTA–Mistral, SAFTI City), and the tactical / entity-level niche is still open while the funded players stay at the theatre level. First use: a **training and rehearsal "what-if" sandbox** for small-unit commanders and instructors — the lowest-trust-barrier way in — with a path toward decision support for the SAF / DSTA.
