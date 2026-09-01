"""A deterministic action chooser for soldiers who are not making decisions.

Every soldier being an agent is what a batch actually costs: one model call per
soldier per tick, so `soldiers x ticks x runs` requests. A platoon-on-platoon
plan at the run dialog's maximum settings is millions of calls, which is not a
tuning problem but a reason not to run the thing.

A rifle section does not contain seven independent decision-makers. It contains
a commander making a decision and six soldiers executing it. This module is that
second group: it follows the section commander, engages what is in front of it,
and never touches the provider. For a seven-man section it removes six model
calls in seven -- and it is the section commander, the soldier whose judgement
the simulation is actually testing, that keeps its agent.

The policy is intentionally simple and legible. It is not trying to be clever;
it is trying to be a defensible floor for "what a soldier does when nobody has
told it anything new this tick".
"""

from athena.geometry import bearing_toward, squared_distance
from athena.models import (
    AgentContext,
    MoveDirection,
    Position,
    ChosenTurn,
    HoldAction,
    MoveAction,
    ShootAction,
    SurvivalState,
    VisibleSoldier,
)
from athena.params import (
    CLOSE_CONTACT_DISTANCE,
    FOLLOWER_COHESION_DISTANCE,
    MAX_ACTION_ATTEMPTS,
    MAX_MOVE_DISTANCE,
    RIFLE_EFFECTIVE_RANGE,
    WAYPOINT_REACHED_DISTANCE,
)
from athena.resolvers.movement import MovementResolver
from athena.resolvers.shooting import ShootingResolver
from athena.navigation import Navigator
from athena.world_state import Battlefield, Soldier


# Directions to try when the ideal bearing is blocked, as offsets in the
# eight-point compass. A section all pushing the same way jams itself: the man
# in front is not moving yet, a path stops on an occupied cell, and everyone
# behind is stuck for the whole run. Fanning out around the bearing is what lets
# a column flow.
_FANOUT = (0, 1, -1, 2, -2)

_COMPASS = (
    MoveDirection.NORTH,
    MoveDirection.NORTHEAST,
    MoveDirection.EAST,
    MoveDirection.SOUTHEAST,
    MoveDirection.SOUTH,
    MoveDirection.SOUTHWEST,
    MoveDirection.WEST,
    MoveDirection.NORTHWEST,
)


def best_move_toward(
    battlefield: Battlefield,
    soldier: Soldier,
    target: Position,
    movement_resolver: MovementResolver,
    navigator: Navigator | None = None,
) -> MoveAction | None:
    """The legal move that gets furthest toward ``target``.

    Routes with a distance field when one is available, which is what lets a
    soldier get round an obstacle rather than into it. The greedy fallback below
    could not: it took the bearing to the target and tried a couple of
    neighbouring directions, so a river across the axis stopped a whole force at
    the bank, where it stood and traded fire across the water for the rest of
    the run.

    The route is followed as a straight run: the first direction it takes, held
    for as long as the route keeps going that way. The next tick picks up the
    turn. That keeps a move to one direction and one distance, which is all the
    action schema carries, without giving up the route.
    """
    if navigator is not None:
        route = navigator.route(
            battlefield, soldier.position, target, MAX_MOVE_DISTANCE
        )
        if route:
            direction = bearing_toward(soldier.position, route[0])
            if direction is not None:
                run = 1
                previous = route[0]
                for step in route[1:]:
                    if bearing_toward(previous, step) is not direction:
                        break
                    run += 1
                    previous = step
                candidate = MoveAction(direction=direction, distance=run)
                if movement_resolver.resolve_move_path(
                    battlefield, soldier, candidate
                ):
                    return candidate

    bearing = bearing_toward(soldier.position, target)
    if bearing is None:
        return None

    occupied = {
        (other.position.x, other.position.y)
        for other in battlefield.soldiers
        if other is not soldier
    }
    origin = _COMPASS.index(bearing)
    best: tuple[tuple[int, int], MoveAction] | None = None

    for offset in _FANOUT:
        candidate = MoveAction(
            direction=_COMPASS[(origin + offset) % len(_COMPASS)],
            distance=MAX_MOVE_DISTANCE,
        )
        path = movement_resolver.resolve_move_path(battlefield, soldier, candidate)
        if not path:
            continue

        end = path[-1]
        score = (0 if (end.x, end.y) in occupied else 1, len(path))
        if best is None or score > best[0]:
            best = (score, candidate)

    return best[1] if best else None


def _nearest_enemy(
    soldier: Soldier,
    visible: list[VisibleSoldier],
) -> VisibleSoldier | None:
    enemies = [
        other
        for other in visible
        if other.team != soldier.team
        and other.survival_status == SurvivalState.ALIVE
    ]
    if not enemies:
        return None
    return min(
        enemies,
        key=lambda enemy: squared_distance(soldier.position, enemy.position),
    )


def _commander(battlefield: Battlefield, soldier: Soldier) -> Soldier | None:
    """The living commander of this soldier's section, if it has one."""
    if soldier.section_id is None:
        return None
    for candidate in battlefield.soldiers:
        if (
            candidate.is_commander
            and candidate.section_id == soldier.section_id
            and candidate.survival_status == SurvivalState.ALIVE
        ):
            return candidate
    return None


def promote_section_commanders(battlefield: Battlefield) -> int:
    """Give any leaderless section its next commander, and report how many.

    Without this a section whose commander is killed holds position for the rest
    of the run: its members are following someone who is no longer there, which
    is both wrong and an artefact of tiering rather than a modelling choice.

    The lowest-indexed living member takes over, which is stable across ticks and
    matches the order the frontend expands a marker in.
    """
    sections: dict[str, list[Soldier]] = {}
    for soldier in battlefield.soldiers:
        if soldier.section_id is None:
            continue
        sections.setdefault(soldier.section_id, []).append(soldier)

    promoted = 0
    for members in sections.values():
        living = [
            member
            for member in members
            if member.survival_status == SurvivalState.ALIVE
        ]
        if not living or any(member.is_commander for member in living):
            continue
        living[0].promote()
        promoted += 1
    return promoted


async def follow_section_commander(
    agent_context: AgentContext,
    battlefield: Battlefield,
    soldier: Soldier,
    movement_resolver: MovementResolver,
    max_attempts: int = MAX_ACTION_ATTEMPTS,
    visibility_history_limit: int = 0,
    communication_history_limit: int = 0,
    shooting_resolver: ShootingResolver | None = None,
    navigator: Navigator | None = None,
) -> ChosenTurn | None:
    """Engage what is in front of you, otherwise stay with your commander.

    Same signature as `choose_action`, so a caller can route soldier by soldier
    without the loop knowing which of them is an agent.

    Order of preference:

    1. Shoot the nearest living enemy inside effective rifle range. Beyond that
       range the shooting resolver discounts the shot steeply, so a follower
       closes instead of wasting the tick.
    2. Move toward its section commander when it has drifted past the cohesion
       distance, travelling as far as its allowance permits.
    3. Hold.

    Every candidate action is validated exactly as an agent's would be, so this
    can never put an illegal action into the tick.
    """
    shooting_resolver = shooting_resolver or ShootingResolver()
    observation = agent_context.current_observation

    enemy = _nearest_enemy(soldier, observation.visible_soldiers)
    if enemy is not None:
        distance = squared_distance(soldier.position, enemy.position) ** 0.5
        if distance <= RIFLE_EFFECTIVE_RANGE:
            shot = ShootAction(target_position=enemy.position)
            if shooting_resolver.validate_shoot_action(
                observation, soldier, shot
            ).valid:
                return ChosenTurn(action=shot)

    leader = _commander(battlefield, soldier)
    if leader is not None and leader is not soldier:
        gap = squared_distance(soldier.position, leader.position) ** 0.5
        if gap > FOLLOWER_COHESION_DISTANCE:
            move = best_move_toward(
                battlefield, soldier, leader.position, movement_resolver, navigator
            )
            if move is not None:
                return ChosenTurn(action=move)

        # Close enough to the commander, so march the section's own axis rather
        # than standing still. A follower that holds because it has caught up
        # blocks the commander behind it, and the whole section stops for the
        # rest of the run.
        target = leader.next_waypoint
        if target is not None:
            move = best_move_toward(
                battlefield, soldier, target, movement_resolver, navigator
            )
            if move is not None:
                return ChosenTurn(action=move)

    return ChosenTurn(action=HoldAction())


def situation_signature(
    battlefield: Battlefield,
    soldier: Soldier,
    agent_context: AgentContext,
    stalled: bool = False,
) -> tuple:
    """A coarse description of what this commander is looking at.

    Deliberately coarse. What warrants a fresh decision is the enemy appearing,
    crossing into weapon range, closing to grenade distance, opening fire, or
    the section taking a casualty -- not the enemy being one metre nearer than
    it was last tick. Bucketing distance is what turns "in contact" from a
    per-tick model call into a handful of them.

    ``stalled`` is the exception to the coarseness, and the important one. A
    commander whose standing order has stopped making progress is a commander
    whose situation the deterministic layer has failed to handle -- ground it
    cannot route round, or an enemy it cannot get past. That is precisely when
    the decision should go back to the agent, and precisely when the old design
    did the opposite: nothing changed, so nothing was asked, and the scaffolding
    quietly decided the battle.
    """
    observation = agent_context.current_observation
    enemy = _nearest_enemy(soldier, observation.visible_soldiers)

    if enemy is None:
        band = 0
    else:
        distance = squared_distance(soldier.position, enemy.position) ** 0.5
        if distance <= CLOSE_CONTACT_DISTANCE:
            band = 3
        elif distance <= RIFLE_EFFECTIVE_RANGE:
            band = 2
        else:
            band = 1

    section_strength = sum(
        1
        for member in battlefield.soldiers
        if member.section_id == soldier.section_id
        and member.survival_status == SurvivalState.ALIVE
    )
    return (
        band,
        soldier.suppressed,
        section_strength,
        soldier.next_waypoint is None,
        stalled,
    )


def commander_needs_a_decision(
    signature: tuple,
    previous: tuple | None,
    ticks_since_last: int,
    heartbeat: int,
) -> bool:
    """Whether this commander's situation warrants spending a model call.

    A commander is executing an order until something changes. Asking a model
    every tick to repeat itself was most of what a batch cost: on a long
    approach almost every tick has no enemy and nothing to choose between, and
    even in contact the situation is usually the same one it decided about a
    tick ago.

    It is asked when its situation signature changes, when it has never been
    asked, or when the heartbeat elapses -- which bounds how stale a standing
    order can get.
    """
    if previous is None:
        return True
    if signature != previous:
        return True
    return ticks_since_last >= heartbeat


def advance_along_axis(
    battlefield: Battlefield,
    soldier: Soldier,
    movement_resolver: MovementResolver,
    navigator: Navigator | None = None,
) -> ChosenTurn:
    """Execute the standing order: keep moving along the drawn axis.

    Waypoints are consumed as they are reached, so a route is followed in order
    rather than aimed at as a single point. A soldier standing on its final
    waypoint holds -- it has arrived, and deciding what to do there is exactly
    the situation that earns a model call.
    """
    target = soldier.next_waypoint
    if target is None:
        return ChosenTurn(action=HoldAction(), rationale="No axis to follow.")

    if squared_distance(soldier.position, target) <= (
        WAYPOINT_REACHED_DISTANCE * WAYPOINT_REACHED_DISTANCE
    ):
        soldier.reach_waypoint()
        target = soldier.next_waypoint
        if target is None:
            return ChosenTurn(
                action=HoldAction(),
                rationale="Reached the end of the assigned axis; holding.",
            )

    move = best_move_toward(
        battlefield, soldier, target, movement_resolver, navigator
    )
    if move is None:
        return ChosenTurn(
            action=HoldAction(),
            rationale=f"No route open toward ({target.x},{target.y}).",
        )

    return ChosenTurn(
        action=move,
        rationale=(
            f"Marching {move.direction.value} toward ({target.x},{target.y}); "
            "no contact."
        ),
    )
