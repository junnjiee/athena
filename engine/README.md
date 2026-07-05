# Athena Engine

Minimal Python 2D grid simulation where one agent moves inside an environment.
The agent chooses actions through LangChain using OpenRouter. The resolvers validate
whether each movement is legal.

## Setup

Install `uv` if it is not already installed:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Install project dependencies:

```bash
uv sync
```

Create a `.env` file with your OpenRouter key:

```bash
OPENROUTER_API_KEY=your_key_here
```

## Run Tests

```bash
uv run pytest
```

## Run Demo

```bash
uv run python -m athena.demo
```

The demo prints the grid, sends the agent's local observation to OpenRouter, gets
one action back, and asks the world to apply that action.

Grid symbols:

- `A`: agent
- `E`: living enemy
- `#`: hard-cover cell
- `!`: concealment cell
- `.`: empty cell
