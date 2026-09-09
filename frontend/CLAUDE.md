# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

Athena lets a commander sketch a plan on real ground and see whether it works. See the root README.md for the full product description and the two-process architecture.

Area selection on the globe triggers `../server` (Fastify + Socket.IO, port 8787, proxied via Vite) which ingests DEM/OSM/weather, classifies terrain into a military grid, and streams progress; this app renders the battlefield (buildings/roads/water/trees + heatmap drapes) inside the same Cesium scene and validates drawn routes against the grid.

Athena previously ran a force-on-force simulation of LLM-driven soldiers over this terrain, and this app carried the surfaces for it — a run dialog, batch scoring over SSE, and replay playback. That engine has been removed; the replacement is a planning aid for enemy reinforcement routes and block forces, specified in `../docs/superpowers/specs/2026-09-08-route-substrate-design.md`. `RouteStudiesPage` is its surface: corridors over marked ground, enemy courses of action, the order of battle available today, and the block forces that could be put on each corridor. It reaches the planning engine only through `../server`, never directly.

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
