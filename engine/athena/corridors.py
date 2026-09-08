"""Turning a set of routes into the approaches a commander would name.

A corridor is not asked of the graph directly -- "mobility corridor" has no
clean definition as a graph query. It is derived: routes that run down much of
the same ground *are* one approach, and the grouping falls out of measuring
that. What the operator later renames or splits sits on top of this.
"""

import hashlib
from dataclasses import dataclass

from athena.params import CORRIDOR_SIMILARITY
from athena.routing import Route


@dataclass(frozen=True)
class Corridor:
    """One approach, and the ground every route through it must cross."""

    id: str
    routes: tuple[Route, ...]
    choke_edge_ids: tuple[str, ...]
    fastest_seconds: float


def route_similarity(one: Route, other: Route) -> float:
    """Shared length as a fraction of the two routes together.

    Symmetric on purpose: a short route running entirely inside a long one is
    not thereby the same approach, and an asymmetric measure would say it was.
    """
    total = one.length_meters + other.length_meters
    if total <= 0:
        return 0.0
    shared_ids = one.edge_ids & other.edge_ids
    shared = sum(edge.length_meters for edge in one.edges if edge.id in shared_ids)
    shared += sum(edge.length_meters for edge in other.edges if edge.id in shared_ids)
    return shared / total


def _corridor_id(routes: tuple[Route, ...]) -> str:
    """Derived from the ground covered, never generated.

    An operator's renaming and categorisation attach to this id, and the
    feedback loop needs it stable across runs, so re-running the search over
    unchanged ground must reproduce it exactly.
    """
    edge_ids = sorted({edge.id for route in routes for edge in route.edges})
    digest = hashlib.sha256("|".join(edge_ids).encode()).hexdigest()
    return f"cor_{digest[:16]}"


def cluster_into_corridors(
    routes: list[Route],
    similarity: float = CORRIDOR_SIMILARITY,
) -> list[Corridor]:
    """Groups routes into corridors by how much ground they share.

    Single-link agglomerative: two routes join the same corridor when they are
    similar enough, and similarity is transitive through the group. That suits
    an approach that bends -- the two ends of a long corridor may share little
    with each other while both clearly belong to the middle.
    """
    if not routes:
        return []

    parent = list(range(len(routes)))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i in range(len(routes)):
        for j in range(i + 1, len(routes)):
            if route_similarity(routes[i], routes[j]) >= similarity:
                parent[find(i)] = find(j)

    groups: dict[int, list[Route]] = {}
    for index, route in enumerate(routes):
        groups.setdefault(find(index), []).append(route)

    corridors: list[Corridor] = []
    for members in groups.values():
        ordered = tuple(sorted(members, key=lambda r: (r.seconds, sorted(r.edge_ids))))
        shared: frozenset[str] = ordered[0].edge_ids
        for route in ordered[1:]:
            shared &= route.edge_ids
        # Ordered along the fastest route, so the choke reads in the direction
        # of travel rather than as an arbitrary set.
        choke = tuple(edge.id for edge in ordered[0].edges if edge.id in shared)
        corridors.append(
            Corridor(
                id=_corridor_id(ordered),
                routes=ordered,
                choke_edge_ids=choke,
                fastest_seconds=ordered[0].seconds,
            )
        )

    corridors.sort(key=lambda c: (c.fastest_seconds, c.id))
    return corridors
