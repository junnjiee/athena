# Athena Planning Engine

Finds the routes an enemy reserve can reinforce along, and groups them into the
approaches a commander would name. See [ENGINE.md](ENGINE.md) for behaviour and
modelling assumptions.

The engine holds no state. It pulls an operational area's road graph from the
terrain service, runs a deterministic search, and returns the result.

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

## Tests

```bash
uv run pytest
```
