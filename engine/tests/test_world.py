from athena.renderer import Renderer
from athena.world import Position, World


def test_agent_moves_inside_grid() -> None:
    world = World(width=3, height=3, agent_position=Position(1, 1))

    result = world.move_agent("right")

    assert result.accepted is True
    assert world.agent_position == Position(2, 1)


def test_agent_cannot_leave_grid() -> None:
    world = World(width=3, height=3, agent_position=Position(0, 0))

    result = world.move_agent("left")

    assert result.accepted is False
    assert world.agent_position == Position(0, 0)


def test_agent_cannot_enter_blocked_cell() -> None:
    world = World(
        width=3,
        height=3,
        agent_position=Position(1, 1),
        blocked={Position(1, 0)},
    )

    result = world.move_agent("up")

    assert result.accepted is False
    assert world.agent_position == Position(1, 1)


def test_renderer_marks_agent_and_blocked_cells() -> None:
    world = World(
        width=3,
        height=2,
        agent_position=Position(0, 0),
        blocked={Position(2, 1)},
    )
    renderer = Renderer()

    assert renderer.render(world) == "A..\n..#"


def test_renderer_frame_clears_screen_and_includes_status() -> None:
    world = World(width=2, height=1, agent_position=Position(0, 0))
    renderer = Renderer()

    frame = renderer.render_frame(world, tick=2, direction="right", message="accepted")

    assert frame == "\033[2J\033[HTick 2\nA.\nLLM chose: right\naccepted\n"
