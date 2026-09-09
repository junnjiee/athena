# Athena Planning Engine

Finds the routes an enemy reserve can reinforce along, groups them into the
approaches a commander would name, assesses how the enemy would use them, and
says what could block each one. See [ENGINE.md](ENGINE.md) for behaviour and
modelling assumptions.

The engine holds no state. It pulls an operational area's road graph from the
terrain service, computes, and returns the result. Everything is deterministic
except the courses-of-action pass, which is the one place a model reasons.

## Requirements

- Python 3.11+
- [uv](https://docs.astral.sh/uv/)

## Run

```bash
uv sync
cp .env.example .env          # fill in a model and its key
uv run --env-file .env uvicorn athena.service:app --port 8000
```

The engine reads `os.environ` directly and loads no file of its own, so
`--env-file` is what puts `.env` into its environment. A plain `uv run` ignores
that file and falls back to whatever the shell already exports — which looks
exactly like a key that was set but did not work.

`TERRAIN_SERVICE_URL` points at the terrain service (default
`http://localhost:8787`).

`ATHENA_MODEL` names the model that reasons about enemy intent, as
`provider:name` — `openai:gpt-5.6-sol` (the default), `anthropic:claude-opus-5`,
`google:gemini-2.5-pro`, `ollama:llama3.3`, or anything else pydantic-ai
resolves.

`PROVIDER_API_KEY` carries the key for whichever provider that names. One
variable, not one per vendor: the engine takes no position on who supplies the
judgement, and a variable named after a company states a position in the one
place an operator has to look. Which client the key reaches follows from
`ATHENA_MODEL` alone, so swapping provider is a change of those two lines.

Left unset, key resolution falls to pydantic-ai, which reads whatever
conventional variable that provider expects — so a deployment already exporting
`OPENAI_API_KEY` or similar keeps working untouched.

These are needed only for the enemy courses-of-action pass. Route studies and
block forces are deterministic and run without any of them.

## Tests

```bash
uv run pytest
```
