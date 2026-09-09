"""Pulling an operational area's graph from the terrain service.

The engine holds no state of its own. A study names an area; the graph itself
is fetched, used, and discarded. Pulling rather than being handed the graph
keeps request bodies small -- a real area is tens of thousands of edges.
"""

import httpx

from athena.graph import RoadGraph, decode_graph

DEFAULT_TIMEOUT_SECONDS = 60.0


async def fetch_graph(
    terrain_service_url: str,
    area_id: str,
    revision: int | None = None,
    timeout: float = DEFAULT_TIMEOUT_SECONDS,
) -> RoadGraph:
    """Fetches and inflates one area's road graph.

    Raises on anything other than a complete graph: a study built on a partial
    network would report approaches that do not exist and, worse, miss ones
    that do.
    """
    url = f"{terrain_service_url.rstrip('/')}/api/operational-area/{area_id}/graph"
    params = {"revision": revision} if revision is not None else None
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.get(url, params=params)
        response.raise_for_status()
        return decode_graph(response.content)
