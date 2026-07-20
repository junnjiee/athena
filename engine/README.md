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

This uses the default hosted model, `deepseek/deepseek-v4-flash`.

To select another OpenRouter model:

```bash
uv run python -m athena.demo --model provider/model-name --ticks 5
```

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
```

Show the complete command help:

```bash
uv run python -m athena.demo --help
```

## Run the tests

```bash
uv run pytest
```
