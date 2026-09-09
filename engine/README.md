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
uv run uvicorn athena.service:app --port 8000
```

`TERRAIN_SERVICE_URL` points at the terrain service (default
`http://localhost:8787`).

`ANTHROPIC_API_KEY` is needed only for the enemy courses-of-action pass. Route
studies and block forces run without it.

## Tests

```bash
uv run pytest
```
