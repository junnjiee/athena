"""The section policy: what a soldier does when it is not the one deciding.

One model call per soldier per tick is what a batch costs, so a seven-man
section spent seven calls to make one decision. Only the section commander keeps
an agent; the rest run this.
"""

import asyncio

from athena.models import (
    AgentContext,
    HoldAction,
    MoveAction,
    ObservedSoldier,
    Position,
    ShootAction,
    SurvivalState,
    Team,
    VisibleSoldier,
)
from athena.policy import follow_section_commander
from athena.resolvers.movement import MovementResolver
from athena.resolvers.shooting import ShootingResolver
from athena.world_state import Battlefield, Soldier


def _observation(soldier: Soldier, visible: list[VisibleSoldier]) -> AgentContext:
    return AgentContext(
        current_observation=ObservedSoldier(
            team=soldier.team,
            position=soldier.position,
            survival_status=soldier.survival_status,
            visible_soldiers=visible,
            available_terrain=[],
        ),
        visibility_history=(),
    )


def _lane(soldiers: list[Soldier], width: int = 40) -> Battlefield:
    return Battlefield(
        width=width,
        height=1,
        soldiers=soldiers,
        surface={Position(x=x, y=0, z=0) for x in range(width)},
    )


def _choose(battlefield: Battlefield, soldier: Soldier, visible=()) -> object:
    return asyncio.run(
        follow_section_commander(
            agent_context=_observation(soldier, list(visible)),
            battlefield=battlefield,
            soldier=soldier,
            movement_resolver=MovementResolver(),
            shooting_resolver=ShootingResolver(),
        )
    )


def test_a_follower_engages_the_nearest_enemy_in_effective_range() -> None:
    follower = Soldier(
        Team.BLUE, Position(x=0, y=0, z=0), section_id="a", is_commander=False
    )
    near = Soldier(Team.RED, Position(x=6, y=0, z=0))
    far = Soldier(Team.RED, Position(x=20, y=0, z=0))
    battlefield = _lane([follower, near, far])

    turn = _choose(
        battlefield,
        follower,
        [
            VisibleSoldier(
                team=Team.RED,
                position=far.position,
                survival_status=SurvivalState.ALIVE,
            ),
            VisibleSoldier(
                team=Team.RED,
                position=near.position,
                survival_status=SurvivalState.ALIVE,
            ),
        ],
    )

    assert turn.action == ShootAction(target_position=Position(x=6, y=0, z=0))


def test_a_follower_closes_on_a_distant_enemy_rather_than_wasting_the_shot() -> None:
    # Past effective range the shooting resolver discounts a shot steeply, so
    # spending the tick on it is worse than closing the gap.
    follower = Soldier(
        Team.BLUE, Position(x=0, y=0, z=0), section_id="a", is_commander=False
    )
    leader = Soldier(
        Team.BLUE, Position(x=30, y=0, z=0), section_id="a", is_commander=True
    )
    enemy = Soldier(Team.RED, Position(x=200, y=0, z=0))
    battlefield = _lane([follower, leader, enemy], width=260)

    turn = _choose(
        battlefield,
        follower,
        [
            VisibleSoldier(
                team=Team.RED,
                position=enemy.position,
                survival_status=SurvivalState.ALIVE,
            )
        ],
    )

    assert isinstance(turn.action, MoveAction)


def test_a_follower_closes_on_its_section_commander() -> None:
    follower = Soldier(
        Team.BLUE, Position(x=0, y=0, z=0), section_id="a", is_commander=False
    )
    leader = Soldier(
        Team.BLUE, Position(x=20, y=0, z=0), section_id="a", is_commander=True
    )
    battlefield = _lane([follower, leader])

    turn = _choose(battlefield, follower)

    assert isinstance(turn.action, MoveAction)
    assert turn.action.direction.value == "east"


def test_a_follower_already_with_its_commander_holds() -> None:
    follower = Soldier(
        Team.BLUE, Position(x=0, y=0, z=0), section_id="a", is_commander=False
    )
    leader = Soldier(
        Team.BLUE, Position(x=2, y=0, z=0), section_id="a", is_commander=True
    )
    battlefield = _lane([follower, leader])

    assert _choose(battlefield, follower).action == HoldAction()


def test_a_follower_whose_commander_is_down_holds_rather_than_wandering() -> None:
    follower = Soldier(
        Team.BLUE, Position(x=0, y=0, z=0), section_id="a", is_commander=False
    )
    leader = Soldier(
        Team.BLUE,
        Position(x=20, y=0, z=0),
        survival_status=SurvivalState.CASUALTY,
        section_id="a",
        is_commander=True,
    )
    battlefield = _lane([follower, leader])

    assert _choose(battlefield, follower).action == HoldAction()


def test_a_follower_ignores_another_section_s_commander() -> None:
    follower = Soldier(
        Team.BLUE, Position(x=0, y=0, z=0), section_id="a", is_commander=False
    )
    other = Soldier(
        Team.BLUE, Position(x=20, y=0, z=0), section_id="b", is_commander=True
    )
    battlefield = _lane([follower, other])

    assert _choose(battlefield, follower).action == HoldAction()


def test_a_follower_never_submits_an_illegal_move() -> None:
    # Its commander is west, off the edge of the battlefield.
    follower = Soldier(
        Team.BLUE, Position(x=0, y=0, z=0), section_id="a", is_commander=False
    )
    leader = Soldier(
        Team.BLUE, Position(x=10, y=0, z=9), section_id="a", is_commander=True
    )
    battlefield = Battlefield(
        width=11,
        height=1,
        soldiers=[follower, leader],
        # A wall of elevation between them: no legal step east.
        surface={
            Position(x=x, y=0, z=0 if x == 0 else 9) for x in range(11)
        },
    )

    assert _choose(battlefield, follower).action == HoldAction()


def test_a_scenario_that_names_no_sections_leaves_everyone_commanding() -> None:
    # Hand-authored scenarios and the demos build soldiers directly, and every
    # one of them should still be an agent.
    assert Soldier(Team.BLUE, Position(x=0, y=0, z=0)).is_commander is True


def test_a_section_promotes_a_survivor_when_its_commander_is_killed() -> None:
    # Without this the section follows a dead man and holds for the rest of the
    # run -- an artefact of tiering rather than a modelling choice.
    from athena.policy import promote_section_commanders

    commander = Soldier(
        Team.BLUE,
        Position(x=0, y=0, z=0),
        survival_status=SurvivalState.CASUALTY,
        section_id="a",
        is_commander=True,
    )
    survivor = Soldier(
        Team.BLUE, Position(x=1, y=0, z=0), section_id="a", is_commander=False
    )
    other = Soldier(
        Team.BLUE, Position(x=2, y=0, z=0), section_id="a", is_commander=False
    )
    battlefield = _lane([commander, survivor, other])

    assert promote_section_commanders(battlefield) == 1
    assert survivor.is_commander is True
    assert other.is_commander is False


def test_a_section_with_a_living_commander_is_left_alone() -> None:
    from athena.policy import promote_section_commanders

    commander = Soldier(
        Team.BLUE, Position(x=0, y=0, z=0), section_id="a", is_commander=True
    )
    follower = Soldier(
        Team.BLUE, Position(x=1, y=0, z=0), section_id="a", is_commander=False
    )
    battlefield = _lane([commander, follower])

    assert promote_section_commanders(battlefield) == 0
    assert follower.is_commander is False


def test_a_wiped_out_section_promotes_nobody() -> None:
    from athena.policy import promote_section_commanders

    dead = [
        Soldier(
            Team.BLUE,
            Position(x=index, y=0, z=0),
            survival_status=SurvivalState.CASUALTY,
            section_id="a",
            is_commander=index == 0,
        )
        for index in range(3)
    ]

    assert promote_section_commanders(_lane(dead)) == 0


def _context(soldier: Soldier, visible=()) -> AgentContext:
    return _observation(soldier, list(visible))


def _signature(soldier: Soldier, visible=()) -> tuple:
    from athena.policy import situation_signature

    return situation_signature(
        _lane([soldier]), soldier, _context(soldier, visible)
    )


def test_an_unchanged_situation_does_not_spend_a_model_call() -> None:
    # The whole cost argument: a commander is executing an order until something
    # changes, and on a long approach almost nothing does.
    from athena.policy import commander_needs_a_decision

    commander = Soldier(
        Team.BLUE,
        Position(x=0, y=0, z=0),
        section_id="a",
        is_commander=True,
        waypoints=(Position(x=30, y=0, z=0),),
    )
    now = _signature(commander)

    assert not commander_needs_a_decision(now, now, 0, 12)


def test_a_commander_that_has_never_been_asked_is_asked() -> None:
    from athena.policy import commander_needs_a_decision

    commander = Soldier(
        Team.BLUE, Position(x=0, y=0, z=0), section_id="a", is_commander=True
    )

    assert commander_needs_a_decision(_signature(commander), None, 0, 12)


def test_an_enemy_appearing_changes_the_situation() -> None:
    commander = Soldier(
        Team.BLUE,
        Position(x=0, y=0, z=0),
        section_id="a",
        is_commander=True,
        waypoints=(Position(x=30, y=0, z=0),),
    )
    seen = [
        VisibleSoldier(
            team=Team.RED,
            position=Position(x=8, y=0, z=0),
            survival_status=SurvivalState.ALIVE,
        )
    ]

    assert _signature(commander) != _signature(commander, seen)


def test_an_enemy_merely_getting_nearer_does_not() -> None:
    # Bucketed on purpose. Re-deciding because the enemy is a metre closer is
    # what made "in contact" cost a model call every single tick.
    commander = Soldier(
        Team.BLUE, Position(x=0, y=0, z=0), section_id="a", is_commander=True
    )
    far = [
        VisibleSoldier(
            team=Team.RED,
            position=Position(x=30, y=0, z=0),
            survival_status=SurvivalState.ALIVE,
        )
    ]
    nearer = [
        VisibleSoldier(
            team=Team.RED,
            position=Position(x=25, y=0, z=0),
            survival_status=SurvivalState.ALIVE,
        )
    ]

    assert _signature(commander, far) == _signature(commander, nearer)


def test_an_enemy_closing_to_grenade_distance_does() -> None:
    commander = Soldier(
        Team.BLUE, Position(x=0, y=0, z=0), section_id="a", is_commander=True
    )
    in_range = [
        VisibleSoldier(
            team=Team.RED,
            position=Position(x=30, y=0, z=0),
            survival_status=SurvivalState.ALIVE,
        )
    ]
    close = [
        VisibleSoldier(
            team=Team.RED,
            position=Position(x=8, y=0, z=0),
            survival_status=SurvivalState.ALIVE,
        )
    ]

    assert _signature(commander, in_range) != _signature(commander, close)


def test_coming_under_fire_changes_the_situation() -> None:
    commander = Soldier(
        Team.BLUE, Position(x=0, y=0, z=0), section_id="a", is_commander=True
    )
    calm = _signature(commander)
    commander.suppressed = True

    assert _signature(commander) != calm


def test_the_heartbeat_bounds_how_stale_a_standing_order_gets() -> None:
    from athena.policy import commander_needs_a_decision

    commander = Soldier(
        Team.BLUE,
        Position(x=0, y=0, z=0),
        section_id="a",
        is_commander=True,
        waypoints=(Position(x=90, y=0, z=0),),
    )
    now = _signature(commander)

    assert not commander_needs_a_decision(now, now, 11, 12)
    assert commander_needs_a_decision(now, now, 12, 12)


def test_a_standing_order_advances_along_the_axis_and_consumes_waypoints() -> None:
    from athena.policy import advance_along_axis

    commander = Soldier(
        Team.BLUE,
        Position(x=0, y=0, z=0),
        section_id="a",
        is_commander=True,
        waypoints=(Position(x=20, y=0, z=0), Position(x=39, y=0, z=0)),
    )
    battlefield = _lane([commander])

    turn = advance_along_axis(battlefield, commander, MovementResolver())

    assert isinstance(turn.action, MoveAction)
    assert turn.action.direction.value == "east"
    assert "no contact" in turn.rationale

    # Standing on the first waypoint drops it and aims at the next.
    commander.position = Position(x=20, y=0, z=0)
    advance_along_axis(battlefield, commander, MovementResolver())
    assert commander.next_waypoint == Position(x=39, y=0, z=0)


def test_a_commander_at_the_end_of_its_axis_holds() -> None:
    from athena.policy import advance_along_axis

    commander = Soldier(
        Team.BLUE,
        Position(x=10, y=0, z=0),
        section_id="a",
        is_commander=True,
        waypoints=(Position(x=10, y=0, z=0),),
    )

    turn = advance_along_axis(_lane([commander]), commander, MovementResolver())

    assert turn.action == HoldAction()
    assert "end of the assigned axis" in turn.rationale


def test_a_column_fans_out_instead_of_jamming_behind_itself() -> None:
    # The failure this exists for: a section all pushing one way blocks itself.
    # Only the leading soldier has free ground, every other path stops on an
    # occupied cell, and the whole section stands still for the entire run.
    from athena.policy import best_move_toward

    mover = Soldier(Team.BLUE, Position(x=0, y=5, z=0), section_id="a")
    blocker = Soldier(Team.BLUE, Position(x=1, y=5, z=0), section_id="a")
    battlefield = Battlefield(
        width=12,
        height=12,
        soldiers=[mover, blocker],
        surface={Position(x=x, y=y, z=0) for x in range(12) for y in range(12)},
    )

    move = best_move_toward(
        battlefield, mover, Position(x=11, y=5, z=0), MovementResolver()
    )

    # East is blocked after one cell, so it takes an open diagonal instead.
    assert move is not None
    assert move.direction.value in {"northeast", "southeast"}


def test_the_direct_bearing_is_preferred_when_it_is_open() -> None:
    from athena.policy import best_move_toward

    mover = Soldier(Team.BLUE, Position(x=0, y=5, z=0), section_id="a")
    battlefield = Battlefield(
        width=12,
        height=12,
        soldiers=[mover],
        surface={Position(x=x, y=y, z=0) for x in range(12) for y in range(12)},
    )

    move = best_move_toward(
        battlefield, mover, Position(x=11, y=5, z=0), MovementResolver()
    )

    assert move is not None
    assert move.direction.value == "east"


def test_a_follower_that_has_caught_up_marches_the_section_axis() -> None:
    # A follower that holds because it has caught up blocks the commander behind
    # it, which is how the section deadlocked.
    leader = Soldier(
        Team.BLUE,
        Position(x=2, y=0, z=0),
        section_id="a",
        is_commander=True,
        waypoints=(Position(x=30, y=0, z=0),),
    )
    follower = Soldier(
        Team.BLUE, Position(x=1, y=0, z=0), section_id="a", is_commander=False
    )
    battlefield = _lane([leader, follower])

    turn = _choose(battlefield, follower)

    assert isinstance(turn.action, MoveAction)


def test_a_stalled_commander_gets_its_decision_back() -> None:
    # The failure this exists for: a standing order that stops making progress
    # changes nothing, so nothing is asked, and the scaffolding quietly decides
    # the battle instead of the agent.
    from athena.policy import commander_needs_a_decision, situation_signature

    commander = Soldier(
        Team.BLUE,
        Position(x=0, y=0, z=0),
        section_id="a",
        is_commander=True,
        waypoints=(Position(x=30, y=0, z=0),),
    )
    battlefield = _lane([commander])
    context = _context(commander)

    moving = situation_signature(battlefield, commander, context, stalled=False)
    stuck = situation_signature(battlefield, commander, context, stalled=True)

    assert moving != stuck
    assert commander_needs_a_decision(stuck, moving, 0, 12)


def test_a_section_routes_round_water_rather_than_stopping_at_it() -> None:
    from athena.navigation import Navigator
    from athena.policy import best_move_toward
    from athena.models import TerrainClass

    water = {(x, 5) for x in range(0, 9)}
    terrain = [
        TerrainClass.WATER if (x, y) in water else TerrainClass.OPEN_GROUND
        for y in range(11)
        for x in range(10)
    ]
    mover = Soldier(Team.BLUE, Position(x=0, y=0, z=0), section_id="a")
    battlefield = Battlefield(
        width=10,
        height=11,
        soldiers=[mover],
        surface={Position(x=x, y=y, z=0) for x in range(10) for y in range(11)},
        terrain=terrain,
    )

    move = best_move_toward(
        battlefield,
        mover,
        Position(x=0, y=10, z=0),
        MovementResolver(),
        Navigator(),
    )

    # South is straight into the river; the route heads east toward the gap.
    assert move is not None
    assert "east" in move.direction.value
