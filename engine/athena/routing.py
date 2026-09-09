"""Finding the ways a mounted force can get from one place to another.

The output is not "the best route" but a small set of genuinely different
approaches, because an S2 wants the options an enemy has rather than the one an
optimiser likes. That distinction drives the whole module: a plain k-shortest
search returns k near-identical paths, which describes one approach k times.
"""

import heapq
from dataclasses import dataclass

from athena.graph import Edge, Node, RoadGraph
from athena.params import (
    GRADIENT_SPEED_PENALTY,
    MAX_MOUNTED_GRADIENT,
    MAX_SEARCH_ITERATIONS,
    MAX_SHARING,
    MAX_STRETCH,
    MOUNTED_SPEEDS_KPH,
    PENALTY_FACTOR,
    ROUTES_PER_PAIR,
)


@dataclass(frozen=True)
class EdgeGoal:
    """A boundary point that can be approached part-way along a live edge.

    ``edge_fraction`` is measured from the edge's stored ``from`` endpoint.
    Keeping the original edge identity lets corridor edits and block plans
    continue to refer to stable graph ground even though the traversal stops
    before the next junction.
    """

    edge: Edge
    approach_node: int
    lon: float
    lat: float
    edge_fraction: float

    @property
    def reverse(self) -> bool:
        return self.approach_node == self.edge.to_node

    @property
    def traversed_fraction(self) -> float:
        return 1 - self.edge_fraction if self.reverse else self.edge_fraction


@dataclass(frozen=True)
class RouteTerminal:
    """The exact point where a route stops part-way along its final edge."""

    edge_id: str
    lon: float
    lat: float
    edge_fraction: float
    traversed_fraction: float


@dataclass(frozen=True)
class Route:
    """One way through the graph, with the cost that ranked it."""

    edges: tuple[Edge, ...]
    nodes: tuple[int, ...]
    seconds: float
    length_meters: float
    terminal: RouteTerminal | None = None

    @property
    def edge_ids(self) -> frozenset[str]:
        return frozenset(edge.id for edge in self.edges)


def edge_travel_seconds(
    edge: Edge,
    nodes: dict[int, Node],
    reverse: bool = False,
    max_gradient: float = MAX_MOUNTED_GRADIENT,
    gradient_penalty: float = GRADIENT_SPEED_PENALTY,
) -> float | None:
    """Time to drive one edge, or ``None`` if a column cannot.

    Cost is time rather than distance: four kilometres of trunk road beats two
    of track. Climbing slows the column; descending does not speed it up, since
    a loaded vehicle brakes rather than making up time.
    """
    gradient = edge.gradient(nodes, reverse=reverse)
    if gradient > max_gradient:
        return None

    speed_kph = MOUNTED_SPEEDS_KPH[edge.road_class]
    if gradient > 0:
        speed_kph /= 1 + gradient_penalty * gradient
    return edge.length_meters / (speed_kph * 1000 / 3600)


def _search(
    graph: RoadGraph,
    start: int,
    goals: frozenset[int],
    penalties: dict[str, float],
    excluded: frozenset[str] = frozenset(),
    edge_goals: tuple[EdgeGoal, ...] = (),
) -> Route | None:
    """Dijkstra over travel time, with per-edge penalties folded into the cost.

    Ties break on node id so the same graph always yields the same route --
    corridor identity downstream depends on that.
    """
    nodes = graph.nodes_by_id()
    valid_goals = goals & nodes.keys()
    edge_goals_by_node: dict[int, list[EdgeGoal]] = {}
    for goal in edge_goals:
        if (
            goal.edge.destroyed
            or goal.edge.id in excluded
            or goal.approach_node not in (goal.edge.from_node, goal.edge.to_node)
            or not 0 < goal.traversed_fraction < 1
        ):
            continue
        edge_goals_by_node.setdefault(goal.approach_node, []).append(goal)
    for candidates in edge_goals_by_node.values():
        candidates.sort(key=lambda item: (item.edge.id, item.edge_fraction))

    if start not in nodes or (not valid_goals and not edge_goals_by_node):
        return None
    if start in valid_goals:
        return Route(edges=(), nodes=(start,), seconds=0.0, length_meters=0.0)

    links = graph.adjacency()
    best: dict[int, float] = {start: 0.0}
    came: dict[int, tuple[int, Edge]] = {}
    queue: list[tuple[float, int]] = [(0.0, start)]
    seen: set[int] = set()
    reached: int | None = None
    reached_terminal: EdgeGoal | None = None
    best_goal_cost = float("inf")
    best_goal_key: tuple[int, int, str, float] | None = None

    def consider_goal(
        total: float,
        key: tuple[int, int, str, float],
        node_id: int,
        terminal: EdgeGoal | None,
    ) -> None:
        nonlocal best_goal_cost, best_goal_key, reached, reached_terminal
        if total < best_goal_cost - 1e-12 or (
            abs(total - best_goal_cost) <= 1e-12
            and (best_goal_key is None or key < best_goal_key)
        ):
            best_goal_cost = total
            best_goal_key = key
            reached = node_id
            reached_terminal = terminal

    while queue:
        cost, current = heapq.heappop(queue)
        if cost > best_goal_cost + 1e-12:
            break
        if current in seen:
            continue
        seen.add(current)
        if current in valid_goals:
            consider_goal(cost, (0, current, "", 0.0), current, None)

        for terminal in edge_goals_by_node.get(current, ()):
            seconds = edge_travel_seconds(
                terminal.edge, nodes, reverse=terminal.reverse
            )
            if seconds is None:
                continue
            terminal_cost = (
                seconds
                * terminal.traversed_fraction
                * penalties.get(terminal.edge.id, 1.0)
            )
            consider_goal(
                cost + terminal_cost,
                (1, current, terminal.edge.id, terminal.edge_fraction),
                current,
                terminal,
            )

        if cost >= best_goal_cost - 1e-12:
            continue

        for neighbour, edge, reverse in links[current]:
            if edge.id in excluded:
                continue
            seconds = edge_travel_seconds(edge, nodes, reverse=reverse)
            if seconds is None:
                continue
            step = cost + seconds * penalties.get(edge.id, 1.0)
            if step < best.get(neighbour, float("inf")) - 1e-12:
                best[neighbour] = step
                came[neighbour] = (current, edge)
                heapq.heappush(queue, (step, neighbour))

    if reached is None:
        return None

    edges: list[Edge] = []
    path: list[int] = [reached]
    cursor = reached
    while cursor != start:
        previous, edge = came[cursor]
        edges.append(edge)
        path.append(previous)
        cursor = previous
    edges.reverse()
    path.reverse()

    terminal_out: RouteTerminal | None = None
    if reached_terminal is not None:
        edges.append(reached_terminal.edge)
        terminal_out = RouteTerminal(
            edge_id=reached_terminal.edge.id,
            lon=reached_terminal.lon,
            lat=reached_terminal.lat,
            edge_fraction=reached_terminal.edge_fraction,
            traversed_fraction=reached_terminal.traversed_fraction,
        )

    # Reported cost is the true one: penalties steer the search, they are not
    # part of how long the route actually takes.
    seconds = 0.0
    length_meters = 0.0
    for index, (edge, tail) in enumerate(zip(edges, path)):
        fraction = (
            terminal_out.traversed_fraction
            if terminal_out is not None and index == len(edges) - 1
            else 1.0
        )
        seconds += (
            edge_travel_seconds(edge, nodes, reverse=edge.to_node == tail) or 0.0
        ) * fraction
        length_meters += edge.length_meters * fraction

    return Route(
        edges=tuple(edges),
        nodes=tuple(path),
        seconds=seconds,
        length_meters=length_meters,
        terminal=terminal_out,
    )


def shortest_route(
    graph: RoadGraph,
    start: int,
    goal: int,
    excluded: frozenset[str] = frozenset(),
) -> Route | None:
    """The quickest way through, ignoring diversity."""
    return _search(graph, start, frozenset({goal}), {}, excluded)


def shortest_route_to_any(
    graph: RoadGraph,
    start: int,
    goals: frozenset[int],
    excluded: frozenset[str] = frozenset(),
    edge_goals: tuple[EdgeGoal, ...] = (),
) -> Route | None:
    """The quickest route to any named goal, stopping at the first reached."""
    return _search(graph, start, goals, {}, excluded, edge_goals)


def shared_fraction(route: Route, other: Route) -> float:
    """How much of ``route`` runs along ``other``, by length."""
    if route.length_meters <= 0:
        return 0.0
    overlap = other.edge_ids
    shared = sum(
        edge.length_meters
        * (
            route.terminal.traversed_fraction
            if route.terminal is not None and index == len(route.edges) - 1
            else 1.0
        )
        for index, edge in enumerate(route.edges)
        if edge.id in overlap
    )
    return shared / route.length_meters


def find_diverse_routes(
    graph: RoadGraph,
    start: int,
    goal: int,
    k: int = ROUTES_PER_PAIR,
    max_stretch: float = MAX_STRETCH,
    max_sharing: float = MAX_SHARING,
    penalty_factor: float = PENALTY_FACTOR,
    max_iterations: int = MAX_SEARCH_ITERATIONS,
    excluded: frozenset[str] = frozenset(),
) -> list[Route]:
    """Up to ``k`` genuinely different routes to one goal, fastest first."""
    return find_diverse_routes_to_any(
        graph,
        start,
        frozenset({goal}),
        k=k,
        max_stretch=max_stretch,
        max_sharing=max_sharing,
        penalty_factor=penalty_factor,
        max_iterations=max_iterations,
        excluded=excluded,
    )


def find_diverse_routes_to_any(
    graph: RoadGraph,
    start: int,
    goals: frozenset[int],
    k: int = ROUTES_PER_PAIR,
    max_stretch: float = MAX_STRETCH,
    max_sharing: float = MAX_SHARING,
    penalty_factor: float = PENALTY_FACTOR,
    max_iterations: int = MAX_SEARCH_ITERATIONS,
    excluded: frozenset[str] = frozenset(),
    edge_goals: tuple[EdgeGoal, ...] = (),
) -> list[Route]:
    """Up to ``k`` genuinely different approaches, fastest first.

    Iterative penalty search: take the quickest route, make its edges
    expensive, search again. Each candidate is admitted only if it is within
    ``max_stretch`` of the fastest and overlaps every accepted route by less
    than ``max_sharing`` of its length.

    That pair of bounds is the guarantee the S2 product rests on, and it is
    deliberately narrow: complete within these limits, silent outside them.
    """
    fastest = _search(graph, start, goals, {}, excluded, edge_goals)
    if fastest is None:
        return []

    accepted = [fastest]
    penalties: dict[str, float] = {}
    limit = fastest.seconds * max_stretch

    for _ in range(max_iterations):
        if len(accepted) >= k:
            break
        for edge in accepted[-1].edges:
            penalties[edge.id] = penalties.get(edge.id, 1.0) * penalty_factor

        candidate = _search(graph, start, goals, penalties, excluded, edge_goals)
        if candidate is None:
            break
        if candidate.seconds > limit:
            # Penalties only ever push the search further out, so once the
            # cheapest remaining option is too slow, nothing better follows.
            break
        if any(shared_fraction(candidate, route) >= max_sharing for route in accepted):
            continue
        if candidate.edge_ids in {route.edge_ids for route in accepted}:
            continue
        accepted.append(candidate)

    accepted.sort(key=lambda route: (route.seconds, [edge.id for edge in route.edges]))
    return accepted[:k]
