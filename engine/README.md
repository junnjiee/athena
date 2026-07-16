# Athena Engine

Minimal Python height-field grid simulation where soldiers occupy XYZ positions on
the battlefield surface.
Each soldier-agent chooses actions through an LLM — a hosted model via LangChain using
OpenRouter, or a local model via Ollama — and the resolvers validate whether each
movement is legal.

## Elevation Rules

- Every `(x, y)` battlefield cell has exactly one ground `z` elevation.
- A soldier can move one horizontal grid cell when the elevation changes by at most
  one level.
- Effective vision range changes by one cell per level of relative elevation: higher
  observers see farther downhill, while lower observers see less far uphill.
- Terrain at or above the interpolated eye-to-eye sightline blocks visibility for
  both friendly and opposing soldiers.
- Rifle shots have a 90% base hit probability, adjusted by two percentage points per
  relative elevation level and clamped between 50% and 99%.
- Each soldier observation contains every elevation-adjusted in-range terrain cell,
  including its XYZ position and cover/concealment flags, for local navigation.

## Setup

Install `uv` if it is not already installed:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Install project dependencies:

```bash
uv sync
```

Athena runs its agents on either a cloud model (OpenRouter) or a local model
(Ollama). Set up whichever backend you plan to use — you can configure both.

### OpenRouter (cloud)

Create a `.env` file with your OpenRouter key:

```bash
OPENROUTER_API_KEY=your_key_here
```

### Ollama (local)

Install [Ollama], then start it and pull at least one model:

By default Athena talks to Ollama at `http://localhost:11434`. To use a remote or
non-default server, set `OLLAMA_HOST` in your shell or `.env` (a bare `host:port`
without a scheme is accepted).

## Run Tests

```bash
uv run pytest
```

## Run Demo

```bash
uv run python -m athena.demo
```

The demo prints the grid, sends each soldier's local observation to a model (OpenRouter
or Ollama), gets one action back, and asks the world to apply that action.

### Choosing the agent model

The backend is selected with `--model`. Routing to hosted or local is the only thing
it changes — the loop, rendering, and output are identical either way.

```bash
uv run python -m athena.demo                                    # pinned hosted default (OpenRouter)
uv run python -m athena.demo --model deepseek/deepseek-v4-flash # a specific OpenRouter model
uv run python -m athena.demo --model ollama:auto               # local Ollama, auto-detected
uv run python -m athena.demo --model ollama:llama3.1:8b        # local Ollama, specific model
```

- Omit `--model` for the pinned hosted default (a reproducible baseline). Any value
  without an `ollama:` prefix is treated as an OpenRouter model id.
- `ollama:` routes to a locally-hosted model — no API key or network needed:
  - `ollama:auto` uses the currently running model (`ollama run <model>`), falling
    back to the most recently pulled one.
  - `ollama:<name>` uses that specific model; it must already be pulled, otherwise
    the demo exits telling you which `ollama pull` to run.

The resolved provider/model is printed to stderr at startup so each run is attributable.

Grid symbols:

- `A`: agent
- `E`: living enemy
- `#`: hard-cover cell
- `!`: concealment cell
- `.`: empty cell
