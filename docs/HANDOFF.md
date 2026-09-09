# Handoff

For the next agent picking up this work. Written 2026-09-10.

Read these three, in order, before touching anything:

| File | What it is |
|---|---|
| [`DOCTRINE.md`](DOCTRINE.md) | **Source of truth** for every doctrinal fact — echelons, reserves, corridors, targeting. Provenance-marked: `[TA]` from the source document, `[CONV]` conventional usage, `[OPEN]` not established. **Never build on `[OPEN]`.** |
| [`planned-changes.md`](planned-changes.md) | The change log. Six groups A–F, what is settled, what is open. |
| `engine/AGENTS.md` | Repo rules for the engine. Read `engine/ENGINE.md` fully at the start of any engine task. |

---

## Where things stand

**Merged, all green:**

| PR | What |
|---|---|
| #94 | Corridor is a bundle of axes — the engine grouping rule |
| #95 | Retractable navigation rail |
| #96 | Planning surface: staff split (Ground/S2/S3) and renames |
| #97 | AO blackout and camera tilt |

**In flight, do not merge as-is:**

- **#98 — draw every detected road black.** Draft. Typecheck and lint pass; it has
  **never been rendered in a browser**. The 27,644-edge Lim Chu Kang graph is the
  whole risk. Branch `feat/road-network-overlay`. The PR lists exactly what is
  left to check.

Suites: `engine` 159 pass, `frontend` 251 pass.

---

## Running things

**Use `bun`, not npm** (`frontend/CLAUDE.md` says so; `bun.lock` is committed).

Bun is **not on PATH** here — call it as `%APPDATA%\npm\bun.cmd`, or from bash:

```bash
"$APPDATA/npm/bun.cmd" test
```

`npx tsc` does **not** work in this repo. Use the local binary:

```bash
cd frontend && ./node_modules/.bin/tsc -b --noEmit
```

Engine is `uv`:

```bash
cd engine && uv run pytest tests/
```

### The database is remote and shared

`server/.env` points at a **hosted Neon Postgres**, not a local one. Docker is not
installed on this machine, so there is no local fallback.

**Reading is free. Writing is not.** Creating an AO triggers a real Overpass ingest
and writes a real row; deleting one cascades to its studies. Do not create or
delete records to test something — ask first.

There is already an ideal read-only fixture:

- AO **Lim Chu Kang** — 23,173 junctions, 27,644 edges
- Study **Lim Chu Kang Route Study**

Its stored result predates PR #94: **5 corridors, four of them a single route**.
That is exactly the single-axis-as-corridor over-counting #94 fixes. Re-running it
would demonstrate the fix — and would write to the shared database, so ask first.

---

## Traps that cost time

**The browser console buffer persists across reloads within a tab.** An HMR
artifact from editing a live page therefore looks like a standing error, and
survives a reload and even a dev-server restart. It cost a full debugging detour
here. **Always verify in a fresh tab.** A React "change in the order of Hooks"
error after editing a live page is almost certainly this.

**React Compiler is enabled** (`babel-plugin-react-compiler` via `@rolldown/plugin-babel`
in `vite.config.ts`). Keep both Babel passes when touching that file. It makes the
HMR hooks-order artifact above more likely.

**`engine/ENGINE.md` and `engine/AGENTS.md` are approval-gated** by `engine/AGENTS.md`
— it says to always ask before editing them. ENGINE.md was updated in #94 under a
blanket "assume yes" from the user covering PRs and merges. **Confirm that still
holds before editing it again.** ENGINE.md must stay true whenever engine
behaviour or modelling changes, so the two rules pull against each other.

**`Training Aggressor_v8.pdf` is RESTRICTED** and now gitignored (`*.pdf`). Keep it
out of the repo. `DOCTRINE.md` carries its content marked `[TA]`; the repo is
private.

**Frontend tests are pure logic only** (`bun:test` over `src/lib`, `src/state`,
`src/types`). There is no component or DOM test infrastructure. TDD the logic;
verify presentational work in the browser.

---

## What to do next

Order is **B → A → rest**; B is done. Finish A.

### 1. Finish the road overlay (#98)
Render it, measure it, check draw order. Fallbacks if 27k instances are too slow
are listed in the PR.

### 2. Road naming and coding — group A, Step 2
All settled, nothing blocking. See `DOCTRINE.md` §4.

- Names are **two syllables**, drawn from a theme the **operator picks per AO**
  (birds of prey, big cats, weather, trees), assigned in sequence without
  collision, always editable.
- Code grammar is confirmed: `KRANJI(4 X)`, `BKE(6// X)`, `MANDAI(2 Z)`.
  Width `2`/`4`/`6`, `//` marks dual carriageway; type `X` all-weather heavy,
  `Y` all-weather limited, `Z` fair-weather only.
- **Pre-fill from OSM** `lanes` + highway class, always operator-editable.
- Two blockers, both real: `GraphEdge` has no `name` field, and OSM `name`/`lanes`
  are fetched then discarded at `server/src/services/roadGraph.ts:96`.

This is genuine pure logic — **TDD it**. A parser and formatter for the code
grammar, and the theme name generator, both belong in `frontend/test/`.

### 3. Mutable road graph — group A
Bigger. The graph becomes mutable with **revisions**; a study pins the revision it
ran against and is flagged stale when behind. Consequences are written up in
`planned-changes.md`, and two matter most:

- **Destruction is a state change, never a deletion.** A destroyed axis keeps its
  name so its effect on the theater stays askable.
- **Names attach to road identity, not to a segment**, because breaking a portion
  of an axis splits one edge into three and all three are still that road.

### 4. AO auto-title — group A, Step 1
Needs a **place lookup**, which does not exist server-side. One capability, three
consumers: AO auto-title, the reserve IVO/locality field (C), and resolving
locations extracted from documents (E). Build it once. Options not yet weighed:
Overpass place query (we already talk to Overpass), Cesium Ion geocoder, Nominatim.

### 5. Then C, D, F, E
S2 reserve model; S3 force model; targeting; document ingestion. All specified in
`planned-changes.md`.

---

## Open questions

Only one is unanswered, and it blocks nothing:

- **Local weapon designations** for `DOCTRINE.md` §7. The capability-generic names
  (ATGM, LAW, 40mm AGL…) are the working set and nothing downstream depends on the
  trade names — the pairing table matches on what a weapon *defeats*.

Everything else in the original nine was answered. Two answers are worth carrying
in your head because they are easy to get wrong:

- **Echelon is defined by the HQ, never inferred from strength.** A Coy(=) holds a
  platoon's manpower but is still a company. Modifiers are fractional thirds:
  `(=)` 1/3, `(-)` 2/3, `(+)` 4/3.
- **Coverage drives block allocation; sufficiency only describes the result.**
  Priority is a force at *every* inlet — each axis is its own way in. Never strip
  one inlet to reinforce another.

## Working agreement in force

The user asked for: build continuously, draft a PR per completed unit, push and
merge to `main` without asking, keep going. Do not ask permission to continue.

That authorisation covers PRs and merges. It has **not** been extended to writing
to the shared database, and it sits awkwardly against `engine/AGENTS.md`'s
approval gate on ENGINE.md — confirm both rather than assuming.
