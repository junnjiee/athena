# Athena Engine

Athena is a battlefield simulation in which agent-controlled soldiers move, observe terrain, and engage the opposing force.

Detailed engine behavior and modeling assumptions are documented in [ENGINE.md](ENGINE.md).

## Requirements

- Python 3.11 or newer
- [uv](https://docs.astral.sh/uv/)

## Setup

Install the Python dependencies:

```bash
uv sync
```

## Run with OpenRouter

Create a `.env` file in the project root:

```dotenv
OPENROUTER_API_KEY=your-api-key
```

Run a short five-tick simulation:

```bash
uv run python -m athena.demo --ticks 5
```

This uses the default hosted model, `openai/gpt-oss-120b:nitro`.

The demo runs on a frontend terrain export (`payload.txt` by default), placing
six Blue against two Red about twelve metres apart on mixed forest, urban and
road ground. The export's own laydown is not used: it spreads seven echelons up
to 240 cells apart, so the two sides never make contact. Red decides freely but
is held in place, so Blue advances against a defence that shoots and radios.

Each tick prints the whole map at one character per cell — never aggregated —
followed by a per-soldier panel, and each tick appends below the last so
scrollback keeps the whole run. A 354-wide export therefore needs a terminal at
least **359 columns** wide; the demo warns on startup if yours is narrower, and
rows soft-wrap until you zoom out.

The panel's `F:<bearing>/<distance>` field shows the newest incoming-fire alert
currently known to each hosted agent, for example `F:NW/medium`; `F:-` means none.
Ollama remains current-observation-only, so its demo rows always show `F:-`.

To see the start positions without spending any API calls:

```bash
uv run python -m athena.demo --deployment
```

Add `--no-color` when redirecting to a file — it drops the elevation shading and
about a fifth of the bytes.

To select another OpenRouter model:

```bash
uv run python -m athena.demo --model provider/model-name --ticks 5
```

## Run the hill-assault demo

The second demo places six Blue attackers together at the southern bottom of a
three-level hill and four stationary Red defenders on its summit. Blue's orders
split the initial formation into three-soldier western and eastern assault elements,
while Red's separate orders use the explicit hold action to defend in place.

```bash
uv run python -m athena.demo2 --ticks 20
```

`demo2` uses OpenRouter only. It accepts an optional OpenRouter model ID through the
same `--model provider/model-name` form and supports `--replay-log`.

## Write a replay log

Pass `--replay-log` to write a result-only JSON log for a replay UI:

```bash
uv run python -m athena.demo --ticks 5 --replay-log runs/demo.json
```

Replay schema version 2 contains the static battlefield and communication groups,
the initial soldier state as step zero, and one final soldier-state step per completed
tick. Each tick step also contains executed shots and accepted team messages. A
message in step `N` was sent during the transition from step `N - 1` to step `N`; its
origin is the sender's position in the preceding step, and its recipients are the
members of its static communication group. Agent observations, submitted actions,
rejected moves and broadcasts, rolling communication histories, hit probabilities,
and random rolls are omitted.

## Run with Ollama

Start Ollama and pull a local model:

```bash
ollama serve
ollama pull llama3.1:8b
```

Use the most recently running or pulled model:

```bash
uv run python -m athena.demo --model ollama:auto --ticks 5
```

Or select a specific local model:

```bash
uv run python -m athena.demo --model ollama:llama3.1:8b --ticks 5
```

## Command options

```text
--model MODEL  OpenRouter model ID or an Ollama model prefixed with "ollama:"
--ticks TICKS  Maximum simulation ticks to run (default: 60)
--replay-log PATH  Write result-only replay JSON to this path
```

Show the complete command help:

```bash
uv run python -m athena.demo --help
```

## Run the tests

```bash
uv run pytest
```
