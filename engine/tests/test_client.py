"""The graph client preserves study-to-ground identity across revisions."""

import asyncio
import gzip
import json

import httpx
import pytest

from athena.client import fetch_graph


def test_fetches_an_explicit_graph_revision(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[httpx.Request] = []
    raw = gzip.compress(json.dumps({"nodes": [], "edges": []}).encode())

    async def send(self: httpx.AsyncClient, request: httpx.Request, **_: object) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, content=raw, request=request)

    monkeypatch.setattr(httpx.AsyncClient, "send", send)

    graph = asyncio.run(fetch_graph("http://terrain.test/", "ao-1", revision=7))

    assert graph.nodes == ()
    assert str(seen[0].url) == "http://terrain.test/api/operational-area/ao-1/graph?revision=7"
