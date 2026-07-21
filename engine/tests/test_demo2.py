import asyncio
import re
from io import StringIO

from athena import demo2
from athena.loop import LoopEngine
from athena.models import (
    AgentContext,
    BroadcastDraft,
    ChosenTurn,
    HoldAction,
    MoveAction,
    MoveDirection,
    Team,
)
from athena.resolvers.movement import MovementResolver
from athena.resolvers.vision import VisionResolver


def test_demo2_starts_blue_together_and_red_on_the_summit() -> None:
    battlefield = demo2.build_battlefield()
    blue = [soldier for soldier in battlefield.soldiers if soldier.team == Team.BLUE]
    red = [soldier for soldier in battlefield.soldiers if soldier.team == Team.RED]

    assert len(blue) == 6
    assert len(red) == 4
    assert {(soldier.position.x, soldier.position.y) for soldier in blue} == {
        (7, 12),
        (8, 12),
        (9, 12),
        (7, 13),
        (8, 13),
        (9, 13),
    }
    assert {soldier.position.z for soldier in blue} == {0}
    assert {soldier.position.z for soldier in red} == {
        demo2.HILL_SUMMIT_ELEVATION
    }


def test_demo2_preassigns_three_blue_soldiers_to_each_flank() -> None:
    battlefield = demo2.build_battlefield()
    blue = [soldier for soldier in battlefield.soldiers if soldier.team == Team.BLUE]

    assert sum("blue-left" in soldier.communication_group_ids for soldier in blue) == 3
    assert sum("blue-right" in soldier.communication_group_ids for soldier in blue) == 3
    assert all("blue-team" in soldier.communication_group_ids for soldier in blue)


def test_demo2_red_patrol_routes_are_disjoint_summit_moves() -> None:
    battlefield = demo2.build_battlefield()
    route_cells = [
        position
        for route in demo2.RED_PATROL_ROUTES.values()
        for position in route
    ]

    assert len(route_cells) == len(set(route_cells))
    for soldier_index, (start, destination) in demo2.RED_PATROL_ROUTES.items():
        soldier = battlefield.soldiers[soldier_index]
        assert (soldier.position.x, soldier.position.y, soldier.position.z) == start
        assert destination[2] == demo2.HILL_SUMMIT_ELEVATION
        assert max(abs(start[0] - destination[0]), abs(start[1] - destination[1])) == 1


def test_demo2_rejects_red_moves_outside_assigned_patrol_route() -> None:
    battlefield = demo2.build_battlefield()
    resolver = demo2.HillAssaultMovementResolver()
    red_6 = battlefield.soldiers[6]

    allowed = resolver.validate_move_action(
        battlefield,
        red_6,
        MoveAction(direction=MoveDirection.EAST),
    )
    outside_sector = resolver.validate_move_action(
        battlefield,
        red_6,
        MoveAction(direction=MoveDirection.SOUTH),
    )

    assert allowed.valid
    assert not outside_sector.valid
    assert outside_sector.reason == (
        "Destination is outside your assigned summit patrol sector."
    )


def test_demo2_hill_changes_by_at_most_one_level_per_cell() -> None:
    battlefield = demo2.build_battlefield()

    for y in range(battlefield.height):
        for x in range(battlefield.width):
            position = battlefield.position_at(x, y)
            assert position is not None
            for neighbor_x, neighbor_y in ((x + 1, y), (x, y + 1)):
                neighbor = battlefield.position_at(neighbor_x, neighbor_y)
                if neighbor is not None:
                    assert abs(position.z - neighbor.z) <= 1


def test_demo2_has_concealed_approaches_and_staging_cells_at_the_hill_foot() -> None:
    battlefield = demo2.build_battlefield()
    concealed_xy = {(position.x, position.y) for position in battlefield.concealment}

    assert demo2.FOOT_CONCEALMENT_CELLS <= concealed_xy
    assert {
        battlefield.position_at(x, y).z
        for x, y in demo2.FOOT_CONCEALMENT_CELLS
    } == {0}


def test_demo2_concealment_guarantees_hidden_occupants() -> None:
    battlefield = demo2.build_battlefield()
    blue = battlefield.soldiers[0]
    red = battlefield.soldiers[8]
    staging_position = battlefield.position_at(6, 8)
    assert staging_position is not None
    blue.move_to(staging_position)

    assert VisionResolver(concealment_hide_probability=0.0).verify_los(
        battlefield,
        red,
        blue,
    )
    assert not VisionResolver(
        concealment_hide_probability=demo2.CONCEALMENT_HIDE_PROBABILITY
    ).verify_los(
        battlefield,
        red,
        blue,
    )


def test_demo2_teams_cannot_see_each_other_before_blue_splits() -> None:
    battlefield = demo2.build_battlefield()
    loop = LoopEngine(
        battlefield=battlefield,
        vision_resolver=VisionResolver(),
        movement_resolver=MovementResolver(),
    )

    observations = loop.observed_soldiers_map()

    for observation in observations:
        assert all(
            visible.team == observation.team
            for visible in observation.visible_soldiers
        )


def test_demo2_action_chooser_injects_different_team_orders(monkeypatch) -> None:
    received_objectives: dict[int, str] = {}
    battlefield = demo2.build_battlefield()

    async def record_orders(*, soldier, team_objectives, **_):
        soldier_index = next(
            index
            for index, battlefield_soldier in enumerate(battlefield.soldiers)
            if battlefield_soldier is soldier
        )
        received_objectives[soldier_index] = team_objectives
        return ChosenTurn(action=HoldAction())

    monkeypatch.setattr(demo2, "choose_action", record_orders)
    chooser = demo2.build_action_chooser(None)

    async def choose_for(soldier_index: int) -> None:
        soldier = battlefield.soldiers[soldier_index]
        observation = LoopEngine(
            battlefield=battlefield,
            vision_resolver=VisionResolver(),
            movement_resolver=MovementResolver(),
        ).observed_soldiers_map()[soldier_index]
        result = await chooser(
            agent_context=AgentContext(
                current_observation=observation,
                visibility_history=(),
                communication_groups=battlefield.communication_groups_for(soldier),
            ),
            battlefield=battlefield,
            soldier=soldier,
            movement_resolver=MovementResolver(),
        )
        assert result == ChosenTurn(action=HoldAction())

    for soldier_index in (0, 1, 3, 6, 7, 8, 9):
        asyncio.run(choose_for(soldier_index))

    commander_orders = received_objectives[0]
    subordinate_orders = received_objectives[1]
    right_commander_orders = received_objectives[3]
    assert "Your soldier identity is Blue 0" in commander_orders
    assert "overall assault commander and left-flank commander" in commander_orders
    assert "RIGHT FORCE READY report from sender_index 3" in commander_orders
    assert "broadcast PUSH NOW anyway" in commander_orders
    assert "Your soldier identity is Blue 1" in subordinate_orders
    assert "must never broadcast PUSH NOW or RIGHT" in subordinate_orders
    assert "sender_index 0 on blue-team" in subordinate_orders
    assert "Your soldier identity is Blue 3" in right_commander_orders
    assert "right-flank commander" in right_commander_orders
    assert "RIGHT FORCE READY: N ready, M casualties" in right_commander_orders
    assert "strength you can account for" in right_commander_orders
    assert "CASUALTY at (x,y,z)" in commander_orders

    for soldier_index in (6, 7, 8, 9):
        first, second = demo2.RED_PATROL_ROUTES[soldier_index]
        orders = received_objectives[soldier_index]
        assert f"Your soldier identity is Red {soldier_index}" in orders
        assert f"{first} <-> {second}" in orders
        assert "HARD MOVEMENT BOUNDARY" in orders
        assert "stop patrolling, shoot it" in orders
        assert "Leaving your sector is mission failure" in orders


def test_demo2_rejects_ollama_model_specs() -> None:
    try:
        demo2.build_action_chooser("ollama:auto")
    except ValueError as exc:
        assert str(exc) == "demo2 supports OpenRouter models only"
    else:
        raise AssertionError("expected Ollama model spec to be rejected")


def test_demo2_runs_a_hold_tick_without_calling_openrouter(monkeypatch) -> None:
    labels: list[str] = []

    async def choose_hold(**_) -> ChosenTurn:
        return ChosenTurn(action=HoldAction())

    monkeypatch.setattr(demo2, "build_action_chooser", lambda _: choose_hold)
    monkeypatch.setattr(
        demo2,
        "render_demo_frame",
        lambda label, *_args, **_kwargs: labels.append(label),
    )

    asyncio.run(demo2.run_demo(ticks=1))

    assert labels == [
        "Hill assault - running tick 1 (waiting for agents)",
        "After tick 1 - tick limit reached",
    ]


def test_demo2_redraws_primary_screen_without_using_alternate_buffer(
    monkeypatch,
) -> None:
    class TtyStdout(StringIO):
        def isatty(self) -> bool:
            return True

    async def choose_hold(**_) -> ChosenTurn:
        return ChosenTurn(action=HoldAction())

    stdout = TtyStdout()
    monkeypatch.setattr(demo2.sys, "stdout", stdout)
    monkeypatch.setattr(demo2, "build_action_chooser", lambda _: choose_hold)

    asyncio.run(demo2.run_demo(ticks=0))

    output = stdout.getvalue()
    assert output.startswith("\033[H\033[2JHill assault - initial state\n")
    assert "\033[?1049h" not in output
    assert "\033[?1049l" not in output
    assert "\033[?25l" not in output
    assert "\033[?25h" not in output


def test_demo2_live_frames_fit_in_a_24_row_terminal(monkeypatch) -> None:
    class TtyStdout(StringIO):
        def isatty(self) -> bool:
            return True

    async def choose_hold(**_) -> ChosenTurn:
        return ChosenTurn(action=HoldAction())

    stdout = TtyStdout()
    monkeypatch.setenv("COLUMNS", "80")
    monkeypatch.setattr(demo2.sys, "stdout", stdout)
    monkeypatch.setattr(demo2, "build_action_chooser", lambda _: choose_hold)

    asyncio.run(demo2.run_demo(ticks=2))

    frames = [
        frame
        for frame in stdout.getvalue().split("\033[H\033[2J")
        if frame
    ]
    assert len(frames) == 3
    assert all(len(frame.splitlines()) <= 20 for frame in frames)
    assert all("Visible information" not in frame for frame in frames)
    visible_lines = [
        re.sub(r"\033\[[0-9;]*[A-Za-z]", "", line)
        for frame in frames
        for line in frame.splitlines()
    ]
    assert all(len(line) <= 80 for line in visible_lines)
    assert "ID action/result | V: pre-action view | C: …" in frames[-1]
    assert "B0 hold | V:1,2,3,4,5" in frames[-1]
    assert "Last: moves 0/0, holds 10, hits 0/0, messages 0" in frames[-1]


def test_demo2_live_panel_shows_accepted_communications(monkeypatch) -> None:
    class TtyStdout(StringIO):
        def isatty(self) -> bool:
            return True

    battlefield = demo2.build_battlefield()
    loop = LoopEngine(
        battlefield=battlefield,
        vision_resolver=VisionResolver(),
        movement_resolver=MovementResolver(),
    )
    result = loop.execute_actions(
        [HoldAction() for _ in battlefield.soldiers],
        broadcasts=[
            BroadcastDraft(
                group_id="blue-team",
                content="LEFT READY at (6,8,0)",
            ),
            *[None for _ in battlefield.soldiers[1:]],
        ],
    )

    stdout = TtyStdout()
    monkeypatch.setenv("COLUMNS", "80")
    monkeypatch.setattr(demo2.sys, "stdout", stdout)

    demo2.render_demo_frame(
        "After tick 1",
        battlefield,
        loop.observed_soldiers_map(),
        execution_result=result,
    )

    output = stdout.getvalue()
    assert "B0 hold | V:1,2,3,4,5 | C:BT LEFT READY" in output
