"""Routing over ground a soldier can actually walk on.

Deterministic movement used to be greedy: take the bearing to the target, and if
that is blocked try a couple of neighbouring directions. That cannot get round
an obstacle. On real ground it fails badly and visibly -- a river across the axis
stopped a whole force at the bank, where it stood and traded fire across the
water for the rest of the run. The plan was never tested; the pathfinder was.

A distance field fixes it. One breadth-first sweep out from the target across
every cell a soldier may legally enter gives the true remaining distance from
everywhere, so any soldier can read its next step straight off. It is computed
once per target and reused by every soldier on every tick, which is what makes
it affordable: the alternative, a search per soldier per tick, is not.

The field also answers the question the greedy version could not: whether a
route exists at all. A soldier whose target is unreachable is told so, and that
is a decision for an agent rather than something to walk into.
"""

from collections import deque

from athena.models import Position
from athena.params import MAX_ELEVATION_CHANGE
from athena.world_state import Battlefield

UNREACHABLE = -1

_NEIGHBOURS = (
    (0, -1),
    (1, -1),
    (1, 0),
    (1, 1),
    (0, 1),
    (-1, 1),
    (-1, 0),
    (-1, -1),
)


class Navigator:
    """Distance fields toward targets, computed once and shared.

    Cached per target cell for the life of a run. Ground does not change during
    a simulation, so a field never needs recomputing, and the number of distinct
    targets is small -- an objective per side and a handful of route waypoints.
    """

    def __init__(self, max_elevation_change: int = MAX_ELEVATION_CHANGE) -> None:
        self.max_elevation_change = max_elevation_change
        self._fields: dict[tuple[int, int], list[int]] = {}

    def field(self, battlefield: Battlefield, target: Position) -> list[int]:
        key = (target.x, target.y)
        cached = self._fields.get(key)
        if cached is None:
            cached = self._build(battlefield, target)
            self._fields[key] = cached
        return cached

    def _passable(self, battlefield: Battlefield, x: int, y: int) -> Position | None:
        position = battlefield.position_at(x, y)
        if position is None:
            return None
        if not battlefield.profile_for(position).passable:
            return None
        return position

    def _build(self, battlefield: Battlefield, target: Position) -> list[int]:
        """Breadth-first distance from ``target`` over legally enterable cells.

        Steps are checked exactly as the movement resolver checks them -- the
        cell must be passable and within the elevation limit of the one before
        it -- so a route the field promises is a route a soldier can walk.
        """
        width, height = battlefield.width, battlefield.height
        distance = [UNREACHABLE] * (width * height)

        start = self._passable(battlefield, target.x, target.y)
        if start is None:
            return distance

        distance[target.y * width + target.x] = 0
        queue = deque([start])

        while queue:
            current = queue.popleft()
            here = distance[current.y * width + current.x]
            for dx, dy in _NEIGHBOURS:
                nx, ny = current.x + dx, current.y + dy
                if not (0 <= nx < width and 0 <= ny < height):
                    continue
                index = ny * width + nx
                if distance[index] != UNREACHABLE:
                    continue
                step = self._passable(battlefield, nx, ny)
                if step is None:
                    continue
                if abs(step.z - current.z) > self.max_elevation_change:
                    continue
                distance[index] = here + 1
                queue.append(step)

        return distance

    def distance_to(
        self,
        battlefield: Battlefield,
        position: Position,
        target: Position,
    ) -> int:
        """Steps from ``position`` to ``target``, or ``UNREACHABLE``."""
        field = self.field(battlefield, target)
        return field[position.y * battlefield.width + position.x]

    def route(
        self,
        battlefield: Battlefield,
        start: Position,
        target: Position,
        limit: int,
    ) -> list[Position]:
        """Up to ``limit`` cells along the shortest route, nearest first.

        Empty when the target cannot be reached, which the caller should treat
        as something to decide about rather than something to walk into.
        """
        width = battlefield.width
        field = self.field(battlefield, target)
        if field[start.y * width + start.x] in (UNREACHABLE, 0):
            return []

        path: list[Position] = []
        current = start
        for _ in range(limit):
            here = field[current.y * width + current.x]
            best: Position | None = None
            for dx, dy in _NEIGHBOURS:
                nx, ny = current.x + dx, current.y + dy
                if not (0 <= nx < battlefield.width and 0 <= ny < battlefield.height):
                    continue
                nearer = field[ny * width + nx]
                if nearer == UNREACHABLE or nearer >= here:
                    continue
                step = self._passable(battlefield, nx, ny)
                if step is None or abs(step.z - current.z) > self.max_elevation_change:
                    continue
                best = step
                break
            if best is None:
                break
            path.append(best)
            current = best
            if field[current.y * width + current.x] == 0:
                break

        return path
