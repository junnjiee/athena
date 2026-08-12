# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

Athena lets a commander sketch a plan on real ground and instantly see the odds it works, via Monte Carlo simulation of AI-driven soldiers on auto-generated real terrain. See the root README.md for the full product description and the three-process architecture.

Area selection on the globe triggers `../server` (Fastify + Socket.IO, port 8787, proxied via Vite) which ingests DEM/OSM/weather, classifies terrain into a military grid, and streams progress; this app renders the battlefield (buildings/roads/water/trees + heatmap drapes) inside the same Cesium scene and validates drawn routes against the grid.

Simulation is live too. Run Simulation in the bottom bar posts to `/api/plans/:id/simulate` (the server builds the scenario and brokers the engine's bearer token), then reads results over SSE from `/api/simulations/:batchId/events`. See `src/state/simulation.ts`, `src/lib/simulationStream.ts` and `src/types/replay.ts` — the latter is aggregate batch scoring (`RunResult`/`BatchOutcome`), not a full replay; the browser never downloads one just to compute a win rate. A run needs a *saved* plan: the engine is handed the stored plan and its stored terrain, never the drawing on screen.

A completed run's full replay can still be watched on demand ("View Replay" in `SimulationModal`, or importing one on the Simulations page) — that path is playback only, no live triggering. `src/types/replayLog.ts` is the actual wire contract with `../engine`, mirroring `engine/athena/models/replay.py`'s schema v3 verbatim; keep it in step with that file. `src/state/replay.ts` drives playback (`ReplayController`, `useSoldierEntities`) over whatever battleground is already on screen.

Not everything a commander can draw is simulated yet — routes, per-unit vision range, objectives and H-hour are dropped engine-side. `../ENGINE_CHANGES.md` is the list.

## Commands

This project uses **bun** as the package manager (`bun.lock` is present — do not use npm/yarn/pnpm).

- `bun install` — install dependencies
- `bun run dev` — start the Vite dev server
- `bun run build` — type-check (`tsc -b`) then production-build with Vite
- `bun run lint` — run ESLint over the repo
- `bun run preview` — preview the production build locally

- `bun test` — run the suite in `test/` (bun:test; pure logic in `src/lib`, `src/state` and `src/types`, no DOM rendering)

## Architecture

- **Build tool**: Vite 8, using the Rolldown-based `@vitejs/plugin-react` (Oxc) plugin, not SWC or Babel-only.
- **React Compiler** is enabled via `@rolldown/plugin-babel` + `babel-plugin-react-compiler` in `vite.config.ts` — JSX is compiled through both the Vite React plugin and a separate Babel pass for the compiler. Keep both when touching `vite.config.ts`.
- **Styling**: Tailwind CSS v4 via `@tailwindcss/vite` (not the PostCSS plugin). Tailwind is enabled through `@import "tailwindcss";` at the top of `src/index.css`; there is no `tailwind.config.js` (v4 uses CSS-based config/theme when needed).
- **TypeScript project references**: `tsconfig.json` is a root pointer to two sub-configs — `tsconfig.app.json` (app source in `src/`, targets DOM libs) and `tsconfig.node.json` (Node-side config files like `vite.config.ts`). When adding compiler options, edit the relevant sub-config, not the root.
- Entry point: `index.html` → `src/main.tsx` → `src/App.tsx`.
