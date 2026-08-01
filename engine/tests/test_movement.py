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
        "Destination elevation differs by 2 levels; the maximum is 1."
    )
