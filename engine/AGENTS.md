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

- force-on-force simulation.
- First terrain: synthetic, not real-world terrain ingestion.
- First weapon model: rifle only.
- Each agent represents exactly one soldier.
- Agents are equally competent by default.

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

### Simulation Engine

The engine is the authoritative world. It owns ground truth and adjudication.
Agents do not mutate world state directly. They propose actions; the engine validates
and resolves them.

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

## Implementation Notes

Append learnings here in point form.

- Document non-obvious modeling choices in the code where they appear. For example,
  if a Pydantic model is configured as frozen/immutable, explain why mutation is
  restricted and how state should be updated instead.
- Write high-impact product code that moves Athena forward. Operate like a
  startup: prefer direct, useful implementation over defensive scaffolding,
  speculative abstractions, or code paths that do not serve the current product
  need. Do not add defensive code or abstractions unless they protect a real
  boundary, encode a real domain rule, or make the current implementation clearer.
  - Example: do not add `from __future__ import annotations` unless the code can't work without it
- Before implementing engine behavior, think through the model with the user until
  the scope is concrete and explicitly confirmed. Correctness is critical in this
  engine; do not turn a rough design conversation into code without a confirmed
  implementation scope.
