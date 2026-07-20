import asyncio
import json
import os
import urllib.error
import urllib.request
from typing import Awaitable, Callable

from athena.params import MAX_ACTION_ATTEMPTS, MAX_ELEVATION_CHANGE
from athena.world_state import Battlefield
from athena.resolvers.movement import MovementResolver
from athena.world_state import Soldier
from athena.models import Action, ChosenAction, MoveAction, ObservedSoldier, ShootAction

DEFAULT_OLLAMA_HOST = "http://localhost:11434"
_CHOSEN_ACTION_SCHEMA = ChosenAction.model_json_schema()

def build_system_prompt(max_elevation_change: int) -> str:
    """Describe the effective movement limit to the local agent."""
    elevation_limit = (
        "one level"
        if max_elevation_change == 1
        else f"{max_elevation_change} levels"
    )
    return (
        "You are a soldier-agent in a grid battlefield simulation. "
        "Choose exactly one move action. The available_terrain cells describe every grid cell in your local "
        "range, including elevation, cover, and concealment; use them to navigate. "
        "Return only the structured action."
        "\n\nTeam objectives:"
        "\n- Blue: advance toward the right/east side of the battlefield."
        "\n- Red: advance toward the left/west side of the battlefield."
        "\n\nIllegal actions:"
        "\n- Shooting; this backend supports movement only."
        "\n- Moving outside the battlefield."
        "\n- Moving more than one grid cell."
        "\n- Moving into a cover cell."
        "\n- Moving to a cell whose elevation differs by more than "
        f"{elevation_limit}."
        "\n- Moving into a cell occupied by a casualty or dead soldier."
        "\n- Moving into a cell occupied by a stationary living soldier."
    )


SYSTEM_PROMPT = build_system_prompt(MAX_ELEVATION_CHANGE)


# Ollama base URL from $OLLAMA_HOST (localhost default, scheme optional); read lazily so .env is honored.
def _ollama_host() -> str:
    host = os.environ.get("OLLAMA_HOST", DEFAULT_OLLAMA_HOST).strip()
    if not host.startswith(("http://", "https://")):
        host = f"http://{host}"
    return host.rstrip("/")


class OllamaUnavailable(RuntimeError):
    """Raised when no local Ollama model is available to serve the agent."""


# GET an Ollama model-list endpoint (/api/tags=pulled, /api/ps=running); [] if none, OllamaUnavailable if down.
def _list_models(path: str) -> list[dict]:
    host = _ollama_host()
    try:
        with urllib.request.urlopen(f"{host}{path}", timeout=10) as response:
            body = json.loads(response.read())
    except urllib.error.URLError as exc:
        raise OllamaUnavailable(
            f"Cannot reach Ollama at {host}. Start it with `ollama serve`."
        ) from exc
    return body.get("models") or []


# Resolve the Ollama model to use: a given name must be pulled; None picks the running/most-recent model.
def resolve_local_model(name: str | None = None) -> str:
    if name is not None:
        available = {model["name"] for model in _list_models("/api/tags")}
        if name in available:
            return name
        if ":" not in name and f"{name}:latest" in available:
            return f"{name}:latest"
        raise OllamaUnavailable(f"model '{name}' is not pulled. Run: ollama pull {name}")

    running = _list_models("/api/ps")
    if running:
        return running[0]["name"]

    pulled = _list_models("/api/tags")
    if pulled:
        newest = max(pulled, key=lambda model: model.get("modified_at", ""))
        return newest["name"]

    raise OllamaUnavailable(
        "Ollama is reachable but has no models. Pull one first, "
        "e.g. `ollama pull llama3.1:8b`."
    )


# Call propose() up to max_attempts times, returning the first legal move.
async def _resolve_action(
    propose: Callable[[], Awaitable[ChosenAction]],
    battlefield: Battlefield,
    soldier: Soldier,
    movement_resolver: MovementResolver,
    max_attempts: int,
) -> Action | None:
    for _ in range(max_attempts):
        action = (await propose()).action

        if isinstance(action, MoveAction):
            if movement_resolver.verify_move_action(battlefield, soldier, action):
                return action

        if isinstance(action, ShootAction):
            continue

    return None


async def choose_action_local(
    observed_soldier: ObservedSoldier,
    battlefield: Battlefield,
    soldier: Soldier,
    movement_resolver: MovementResolver,
    max_attempts: int = MAX_ACTION_ATTEMPTS,
    model: str | None = None,
) -> Action | None:
    if model is None:
        model = resolve_local_model()

    async def propose() -> ChosenAction:
        return await asyncio.to_thread(
            _request_local_action,
            observed_soldier,
            model,
            movement_resolver.max_elevation_change,
        )

    return await _resolve_action(
        propose, battlefield, soldier, movement_resolver, max_attempts
    )


# Blocking Ollama /api/chat call (run via to_thread); schema-constrained output needs no parse guard.
def _request_local_action(
    observed_soldier: ObservedSoldier,
    model: str,
    max_elevation_change: int = MAX_ELEVATION_CHANGE,
) -> ChosenAction:
    payload = {
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": build_system_prompt(max_elevation_change),
            },
            {"role": "user", "content": observed_soldier.model_dump_json()},
        ],
        "format": _CHOSEN_ACTION_SCHEMA,
        "stream": False,
    }
    request = urllib.request.Request(
        f"{_ollama_host()}/api/chat",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        body = json.loads(response.read())

    return ChosenAction.model_validate_json(body["message"]["content"])
