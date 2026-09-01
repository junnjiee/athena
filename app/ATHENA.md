# Athena's changes to the vendored God's Eye View

This directory is a vendored snapshot of
[bilawalsidhu/gods-eye-view](https://github.com/bilawalsidhu/gods-eye-view),
pinned at upstream commit **`d8f1742783cddd6bbc86033d0db06dc6ec746304`**.

GEV is the **source of truth** for this project: the globe shell, layer
manager, annotation engine, voice agent, sensor modes and module conventions
are canonical, and Athena builds inside them rather than around them. To keep
future upstream merges mechanical, our changes are **new files plus three
small, append-only edits**. Nothing upstream was rewritten or removed.

`docs/media/` (67 MB of capture GIFs) was excluded from the snapshot; nothing
in the app references it.

## New files (all additive)

| Path | Purpose |
|---|---|
| `src/data/sg/sgClient.js` | Shared client for Athena's Singapore data plane at `/api/sg/*`, plus the provenance → `getStats()` mapping |
| `src/data/sg/sgWeather.js` | NEA rain-gauge network (~88 stations) + island wind readout |
| `src/data/sg/sgMobility.js` | LTA taxi availability (~3,000 points) as a crowd proxy |
| `src/data/sg/sgHazard.js` | NEA lightning strikes + PUB flood alerts |

## Modified upstream files (3)

Each edit is marked with an `ATHENA` comment in situ.

1. **`src/main.js`** — three imports and three `dataManager.register(...)`
   calls. Appended to the existing registration block.
2. **`src/data/layerState.js`** — three `LAYER_STATE_REGISTRY` entries.
   `finalizeRegistrations()` throws unless every registered layer has exactly
   one disposition here, so this edit is mandatory, not optional.
3. **`vite.config.js`** — a `server.proxy` entry routing `/api/sg` to the
   Athena server (default `http://localhost:8787`, override with
   `ATHENA_SERVER_URL`).

## Why the SG feeds are proxied rather than fetched directly

data.gov.sg throttles to **6 requests per 10 seconds** without an API key (12
with a dev key, 30 with a production key) — verified by hitting it. Per-tab
fetching would throttle the console the moment a second operator opened it, so
the Athena server owns all polling, caching and the quota budget, and holds the
LTA DataMall key. A layer's `update()` is a cache read.

This is also why the SG layers do **not** use this file's own dev-server
middlewares: those are upstream's, and keeping our feeds out of them means
`vite.config.js` stays a three-line diff.

## Share tokens

GEV's share codec validates layer tokens against `/^[a-z0-9]$/` — a single
character, so the namespace holds 36 and upstream already uses 16. Ours take
`h` (weather), `y` (mobility) and `z` (hazard) from the 20 that were free. See
`PRD.md` §10.10 for the full allocation plan.

## Merging upstream

```bash
git -C /tmp clone --depth 1 https://github.com/bilawalsidhu/gods-eye-view.git gev-new
rsync -a --exclude '.git' --exclude 'docs/media' /tmp/gev-new/ app/
git diff            # re-apply the three ATHENA-marked edits above
```

The four `src/data/sg/*` files are untouched by any upstream change.
