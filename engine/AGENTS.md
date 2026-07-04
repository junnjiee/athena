# Athena Engine Picture

This directory is for the simulation engine and agent harness, not the frontend.

## Product Identity

Athena is a force-on-force battlefield simulation lab for human-authored ops plans.
Planners author both Blue and Red plans. Soldier-agents execute those plans inside a
rules-governed milsim-style environment. Athena runs many simulation branches and
produces a breakdown report showing where plans fail under explicit assumptions.

Athena is not an AI commander, plan recommender, plan generator, or validated combat
prediction system. It must not rewrite a plan, recommend a course of action, claim
real casualty predictions, or present outputs as operational truth.

The core promise is:

> Show where a human-authored plan breaks when executed repeatedly by soldier-agents
> under battlefield constraints.

## MVP Scope

- Section-level force-on-force simulation.
- First scenario shape: attack versus defence.
- First force size: 5 attackers versus 3 defenders.
- First terrain: synthetic, not real-world terrain ingestion.
- First weapon model: rifle only.
- Both sides' ops plans are human-authored through visual plan authoring.
- Each agent represents exactly one soldier.
- Agents are equally competent by default.
- Multiple runs vary agent decisions, timings, and starting positions.
- Output is a breakdown report backed by logs and replay data.

## System Boundary

Athena has two core runtime layers.

### Agent Harness

Agents act as soldiers inside the simulation. An agent:

- receives its own side's ops plan;
- knows the plan and any assigned contingencies;
- has memory within a single simulation run;
- perceives through vision, range-limited radio, and line-of-sight shouting;
- does not receive global battlefield truth;
- follows contingencies before deviating from the plan;
- may deviate only when the plan and contingencies do not cover the local situation;
- submits attempted actions to the engine.

Initial action set:

- `move`
- `observe`
- `communicate`
- `engage`
- `take_cover`
- `wait`
- `withdraw`

### Simulation Engine

The engine is the authoritative world. It owns ground truth and adjudication.
Agents do not mutate world state directly. They propose actions; the engine validates
and resolves them.

The engine is responsible for:

- time progression;
- position and movement;
- line of sight;
- visibility and detection;
- cover and obstruction;
- communication reach;
- rifle engagement resolution;
- casualty state;
- event logging;
- replay state;
- run-level outcome classification;
- breakdown extraction.

The correct mental model is a milsim game: agents are players, and the engine is the
game server.

## Information Model

There are two separate views of the world:

- global truth, held by the engine for adjudication and replay;
- agent-local knowledge, held by each soldier-agent.

Agent knowledge comes from:

- what the agent can see;
- what the agent receives over range-limited radio;
- what the agent receives through line-of-sight shouting;
- memory from earlier in the same run.

Future implementation should preserve this separation strictly. If an agent uses
hidden global information, that is a simulation failure.

## Run Semantics

A simulation run is one execution of the authored Blue and Red plans under one set of
run-specific variations. Repeated runs exist to surface both common and plausible
breakdowns.

Known run-variation sources:

- agent decision variance;
- timing variance;
- starting-position variance.

Open question: whether deterministic seeds must reproduce an entire run exactly when
LLM agents are involved. The engine should still log enough state to replay observed
runs exactly after they occur.

## Combat Model

The first combat model is rifle-only. Seeing an enemy does not force an automatic
engagement; the agent chooses whether to engage. Once an engagement action is
submitted, the engine decides the result using the declared visibility, cover,
distance, and casualty rules.

Known first soldier states:

- `alive`
- `casualty`
- `dead`

Suppression, morale, fatigue, complex ballistics, weather, and richer weapon effects
are not first-principle MVP requirements unless explicitly added later.

## Breakdown Report

Athena's output is a breakdown report, not a recommendation. A breakdown report should
be trace-backed. It should point to the logs, actions, rule checks, and replay moments
that explain why the breakdown happened.

Examples of breakdowns Athena should eventually surface:

- enemy spots attackers earlier than expected;
- attackers fail to seize key terrain;
- support fails to cover movement;
- a timing gap isolates a soldier or team;
- a fallback contingency triggers;
- a route exposes soldiers to observation or fire;
- comms assumptions fail;
- objective conditions are not met.

Recurring breakdowns across runs are especially valuable because they reveal plan
fragility rather than a one-off branch.

## Current Unknowns

These are intentionally not settled yet:

- exact tick or time model;
- exact mission success and failure conditions;
- exact visual representation of contingencies;
- exact detection, cover, and vegetation formulas;
- exact run ranking and breakdown taxonomy;
- exact report layout;
- exact seed/reproducibility contract for LLM-controlled agents.

When making implementation choices before these are resolved, prefer explicit,
inspectable assumptions over hidden cleverness. Log every assumption that affects a
run.
