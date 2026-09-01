from athena.world_state import Battlefield
from athena.loop import LoopEngine
from athena.resolvers.movement import MovementResolver
from athena.resolvers.vision import VisionResolver
from athena.world_state import Soldier
from athena.models import MoveAction, MoveDirection, Position, Team


def battlefield_with_elevations(
    elevations: list[int],
    soldier: Soldier,
) -> Battlefield:
    return Battlefield(
        width=len(elevations),
        height=1,
        soldiers=[soldier],
        surface={
            Position(x=x, y=0, z=elevation)
            for x, elevation in enumerate(elevations)
        },
    )


def test_move_resolves_destination_z_from_battlefield_surface() -> None:
    soldier = Soldier(Team.BLUE, Position(x=0, y=0, z=0))
    battlefield = battlefield_with_elevations([0, 1], soldier)
    resolver = MovementResolver()
    action = MoveAction(direction=MoveDirection.EAST)

    assert resolver.resolve_move_position(battlefield, soldier, action) == Position(
        x=1,
        y=0,
        z=1,
    )
    assert resolver.verify_move_action(battlefield, soldier, action)


def test_execution_rejects_move_over_one_elevation_level() -> None:
    soldier = Soldier(Team.BLUE, Position(x=0, y=0, z=0))
    battlefield = battlefield_with_elevations([0, 2], soldier)
    loop = LoopEngine(
        battlefield=battlefield,
        vision_resolver=VisionResolver(),
        movement_resolver=MovementResolver(max_elevation_change=1),
    )

    result = loop.execute_actions([MoveAction(direction=MoveDirection.EAST)])

    assert result.after.soldiers[0].position == Position(x=0, y=0, z=0)


def test_steep_descent_is_rejected_too() -> None:
    soldier = Soldier(Team.BLUE, Position(x=0, y=0, z=2))
    battlefield = battlefield_with_elevations([2, 0], soldier)

    assert not MovementResolver().verify_move_action(
        battlefield,
        soldier,
        MoveAction(direction=MoveDirection.EAST),
    )


def test_move_validation_explains_rejection() -> None:
    soldier = Soldier(Team.BLUE, Position(x=0, y=0, z=0))
    battlefield = battlefield_with_elevations([0, 2], soldier)

    validation = MovementResolver(max_elevation_change=1).validate_move_action(
        battlefield,
        soldier,
        MoveAction(direction=MoveDirection.EAST),
    )

    assert not validation.valid
    assert validation.reason == (
        "Moving east climbs 2 elevation levels; the maximum is 1."
    )


def _flat_lane(width: int, soldier: Soldier, terrain=None) -> Battlefield:
    """A one-row battlefield at constant elevation, optionally with terrain."""
    return Battlefield(
        width=width,
        height=1,
        soldiers=[soldier],
        surface={Position(x=x, y=0, z=0) for x in range(width)},
        terrain=terrain,
    )


def _contested_lane(width: int, soldier: Soldier, terrain=None) -> Battlefield:
    """As above, with a living enemy inside vision range.

    Movement allowance depends on contact: a soldier that can see nobody marches.
    A test about gait or terrain cost has to put someone in front of it.
    """
    # The mover has to be able to see it, or it marches regardless.
    soldier.vision_range = max(soldier.vision_range, width * 2)
    enemy = Soldier(Team.RED, Position(x=width - 1, y=0, z=0))
    return Battlefield(
        width=width,
        height=1,
        soldiers=[soldier, enemy],
        surface={Position(x=x, y=0, z=0) for x in range(width)},
        terrain=terrain,
    )


def test_a_move_can_cross_several_cells_in_one_tick() -> None:
    # The reason most batches came back "inconclusive": a tick used to be one
    # metre, so sixty ticks covered sixty metres of ground up to 800 m wide and
    # two forces drawn apart never met.
    soldier = Soldier(Team.BLUE, Position(x=0, y=0, z=0), move_budget=5.0)
    battlefield = _flat_lane(10, soldier)

    action = MoveAction(direction=MoveDirection.EAST, distance=4)

    assert MovementResolver().resolve_move_position(
        battlefield, soldier, action
    ) == Position(x=4, y=0, z=0)


def test_terrain_cost_is_what_bounds_a_move() -> None:
    # move_cost was tabulated per class and read by nothing, so wetland and road
    # cost a soldier exactly the same. Now it is the movement allowance that a
    # cell spends. Road is 0.8, so a budget of 4 buys five road cells.
    from athena.models import TerrainClass

    soldier = Soldier(Team.BLUE, Position(x=0, y=0, z=0), move_budget=4.0)
    road = _contested_lane(
        10,
        soldier,
        terrain=[TerrainClass.ROAD] * 10,
    )
    action = MoveAction(direction=MoveDirection.EAST, distance=10)

    assert MovementResolver().resolve_move_position(
        road, soldier, action
    ) == Position(x=5, y=0, z=0)


def test_wetland_costs_more_ground_than_road_for_the_same_allowance() -> None:
    from athena.models import TerrainClass

    soldier = Soldier(Team.BLUE, Position(x=0, y=0, z=0), move_budget=5.0)
    wetland = _contested_lane(10, soldier, terrain=[TerrainClass.WETLAND] * 10)
    action = MoveAction(direction=MoveDirection.EAST, distance=10)

    # 2.5 per cell against an allowance of 5 buys two cells, against five on road.
    assert MovementResolver().resolve_move_position(
        wetland, soldier, action
    ) == Position(x=2, y=0, z=0)


def test_a_move_stops_at_ground_it_cannot_cross_instead_of_being_rejected() -> None:
    # An agent picks a distance off a drawn map with blanks where it cannot see.
    # Rejecting the whole move would spend a retry -- another model call -- on
    # ground it was never shown, so it travels as far as it legally can.
    soldier = Soldier(Team.BLUE, Position(x=0, y=0, z=0), move_budget=8.0)
    battlefield = battlefield_with_elevations([0, 0, 0, 5, 0], soldier)
    resolver = MovementResolver(max_elevation_change=1)
    action = MoveAction(direction=MoveDirection.EAST, distance=4)

    assert resolver.validate_move_action(battlefield, soldier, action).valid
    assert resolver.resolve_move_position(battlefield, soldier, action) == Position(
        x=2, y=0, z=0
    )


def test_a_move_whose_very_first_cell_is_blocked_is_still_rejected() -> None:
    soldier = Soldier(Team.BLUE, Position(x=0, y=0, z=0), move_budget=8.0)
    battlefield = battlefield_with_elevations([0, 5, 0], soldier)
    resolver = MovementResolver(max_elevation_change=1)

    validation = resolver.validate_move_action(
        battlefield,
        soldier,
        MoveAction(direction=MoveDirection.EAST, distance=3),
    )

    assert not validation.valid
    assert "climbs 5 elevation levels" in (validation.reason or "")


def test_a_move_stops_on_reaching_another_soldier_rather_than_passing_through() -> None:
    mover = Soldier(Team.BLUE, Position(x=0, y=0, z=0), move_budget=8.0)
    blocker = Soldier(Team.RED, Position(x=3, y=0, z=0))
    battlefield = Battlefield(
        width=8,
        height=1,
        soldiers=[mover, blocker],
        surface={Position(x=x, y=0, z=0) for x in range(8)},
    )
    action = MoveAction(direction=MoveDirection.EAST, distance=6)

    # It reaches the occupied cell and stops there. Whether it may actually take
    # that cell is settled across the whole batch, which is what keeps swaps working.
    assert MovementResolver().resolve_move_position(
        battlefield, mover, action
    ) == Position(x=3, y=0, z=0)


def test_a_gait_decides_how_much_ground_a_soldier_covers() -> None:
    # prowl 2.0 / patrol 5.0 / charge 8.0 against open ground at 1.0 a cell.
    battlefield_width = 12
    reached = {}
    for gait, budget in (("prowl", 2.0), ("patrol", 5.0), ("charge", 8.0)):
        soldier = Soldier(Team.BLUE, Position(x=0, y=0, z=0), move_budget=budget)
        battlefield = _contested_lane(battlefield_width, soldier)
        destination = MovementResolver().resolve_move_position(
            battlefield,
            soldier,
            MoveAction(direction=MoveDirection.EAST, distance=10),
        )
        reached[gait] = destination.x

    assert reached == {"prowl": 2, "patrol": 5, "charge": 8}


def test_a_soldier_out_of_contact_marches() -> None:
    # Forces move fast when nobody is shooting at them. Without this, crossing a
    # kilometre of empty ground at a fighting pace outran any tick budget, and
    # every one of those ticks was a decision nobody needed to make.
    from athena.params import MARCH_MOVE_BUDGET

    soldier = Soldier(Team.BLUE, Position(x=0, y=0, z=0), move_budget=5.0)
    empty = _flat_lane(40, soldier)

    assert MovementResolver().movement_allowance(empty, soldier) == MARCH_MOVE_BUDGET


def test_a_soldier_in_contact_moves_at_its_gait() -> None:
    soldier = Soldier(Team.BLUE, Position(x=0, y=0, z=0), move_budget=5.0)
    contested = _contested_lane(20, soldier)

    assert MovementResolver().movement_allowance(contested, soldier) == 5.0


def test_a_suppressed_soldier_does_not_march_away() -> None:
    # Being shot at is contact even if the shooter is not in sight.
    soldier = Soldier(Team.BLUE, Position(x=0, y=0, z=0), move_budget=5.0)
    soldier.suppressed = True
    empty = _flat_lane(40, soldier)

    assert MovementResolver().movement_allowance(empty, soldier) == 5.0


def test_marching_crosses_ground_a_fighting_pace_could_not() -> None:
    soldier = Soldier(Team.BLUE, Position(x=0, y=0, z=0), move_budget=5.0)
    empty = _flat_lane(40, soldier)

    destination = MovementResolver().resolve_move_position(
        empty,
        soldier,
        MoveAction(direction=MoveDirection.EAST, distance=10),
    )

    # Capped by MAX_MOVE_DISTANCE rather than by the allowance, which is the
    # point: the ground, not the budget, is what limits an approach now.
    assert destination == Position(x=10, y=0, z=0)
