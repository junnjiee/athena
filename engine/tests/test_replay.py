import json
from random import Random

from athena.loop import LoopEngine
from athena.models import (
    MoveAction,
    MoveDirection,
    Position,
    ReplayLog,
    ShootAction,
    SurvivalState,
    Team,
)
from athena.replay import ReplayRecorder
from athena.resolvers.movement import MovementResolver
from athena.resolvers.shooting import ShootingResolver
from athena.resolvers.vision import VisionResolver
from athena.world_state import Battlefield, Soldier


def test_replay_records_initial_state_and_completed_tick(tmp_path) -> None:
    shooter = Soldier(Team.BLUE, Position(x=0, y=0, z=0))
    target = Soldier(Team.RED, Position(x=1, y=0, z=0))
    battlefield = Battlefield(width=3, height=1, soldiers=[shooter, target])
    loop = LoopEngine(
        battlefield=battlefield,
        vision_resolver=VisionResolver(),
        movement_resolver=MovementResolver(rng=Random(0)),
        shooting_resolver=ShootingResolver(rng=Random(0)),
    )
    recorder = ReplayRecorder(battlefield.snapshot())

    result = loop.execute_actions(
        [
            ShootAction(target_position=target.position),
            MoveAction(direction=MoveDirection.EAST),
        ]
    )
    recorded_step = recorder.record(result)

    assert recorder.log.steps[0].step == 0
    assert recorder.log.steps[0].soldiers[1].position == Position(x=1, y=0, z=0)
    assert recorder.log.steps[0].shots == ()
    assert recorded_step.step == 1
    assert recorded_step.soldiers[1].position == Position(x=2, y=0, z=0)
    assert recorded_step.soldiers[1].survival_status == SurvivalState.CASUALTY
    assert recorded_step.shots[0].shooter_position == Position(x=0, y=0, z=0)
    assert recorded_step.shots[0].target_position == Position(x=1, y=0, z=0)
    assert recorded_step.shots[0].hit

    output_path = tmp_path / "runs" / "demo.json"
    recorder.save(output_path)
    serialized = output_path.read_text()
    restored = ReplayLog.model_validate_json(serialized)

    assert restored == recorder.log
    assert set(json.loads(serialized)["steps"][1]["shots"][0]) == {
        "shooter_index",
        "target_index",
        "shooter_position",
        "target_position",
        "hit",
    }


def test_replay_omits_rejected_move_attempts() -> None:
    first = Soldier(Team.BLUE, Position(x=0, y=0, z=0))
    second = Soldier(Team.RED, Position(x=2, y=0, z=0))
    battlefield = Battlefield(width=3, height=1, soldiers=[first, second])
    loop = LoopEngine(
        battlefield=battlefield,
        vision_resolver=VisionResolver(),
        movement_resolver=MovementResolver(rng=Random(0)),
    )
    recorder = ReplayRecorder(battlefield.snapshot())

    result = loop.execute_actions(
        [
            MoveAction(direction=MoveDirection.EAST),
            MoveAction(direction=MoveDirection.WEST),
        ]
    )
    step = recorder.record(result)

    assert step.soldiers[0].position == Position(x=0, y=0, z=0)
    assert step.soldiers[1].position == Position(x=1, y=0, z=0)
    assert step.shots == ()
