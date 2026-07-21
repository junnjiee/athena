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

To select another OpenRouter model:

```bash
uv run python -m athena.demo --model provider/model-name --ticks 5
```

## Write a replay log

Pass `--replay-log` to write a result-only JSON log for a replay UI:

```bash
uv run python -m athena.demo --ticks 5 --replay-log runs/demo.json
```

The log contains the static battlefield, the initial soldier state as step zero,
and one final soldier-state step per completed tick. Each tick step also contains
executed shots with their pre-tick source and target positions and whether they hit.
Agent observations, submitted actions, rejected moves, hit probabilities, and random
rolls are omitted.

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
