from athena.context_view import (
    MAX_DIGIT_RELIEF,
    render_agent_context,
    render_observation,
    render_terrain,
)
from athena.models import (
    AgentContext,
    MoveAction,
    MoveDirection,
    ObservedSoldier,
    Position,
    SurvivalState,
    Team,
    TerrainCell,
    TerrainClass,
    VisibilityObservation,
    VisibleSoldier,
)


def cells(
    layout: list[str],
    x0: int = 0,
    y0: int = 0,
    heights: dict[tuple[int, int], int] | None = None,
) -> list[TerrainCell]:
    """Build terrain from a picture, so tests read as the map they describe."""
    by_glyph = {
        ".": TerrainClass.OPEN_GROUND,
        "^": TerrainClass.DENSE_FOREST,
        "=": TerrainClass.ROAD,
        "~": TerrainClass.WATER,
    }
    heights = heights or {}
    return [
        TerrainCell(
            position=Position(
                x=x0 + column,
                y=y0 + row,
                z=heights.get((x0 + column, y0 + row), 0),
            ),
            terrain_class=by_glyph[glyph],
        )
        for row, line in enumerate(layout)
        for column, glyph in enumerate(line)
        if glyph != " "
    ]


def test_terrain_renders_as_a_picture_in_battlefield_orientation() -> None:
    # Row order must match the battlefield's: y increases southward, so the
    # road drawn on the last line has to appear on the last line.
    picture = render_terrain(
        cells(["^^^", "...", "==="]),
        observer=Position(x=1, y=1, z=0),
    )
    rows = picture.splitlines()

    assert "^^^" in rows
    assert rows.index("^^^") < rows.index("...") < rows.index("===")


def test_unseen_cells_are_left_blank() -> None:
    # A gap in the middle is terrain behind an obstruction. Rendering it blank
    # shows the soldier the shape of what it cannot see.
    picture = render_terrain(
        cells(["^^^", "^ ^", "^^^"]),
        observer=Position(x=0, y=0, z=0),
    )

    assert "^ ^" in picture.splitlines()


def test_legend_covers_only_the_classes_present() -> None:
    picture = render_terrain(cells(["^=="]), observer=Position(x=0, y=0, z=0))

    assert "^=Dense Forest" in picture
    assert "==Road" in picture
    assert "Water" not in picture


def test_elevation_grid_is_relative_to_the_lowest_visible_cell() -> None:
    picture = render_terrain(
        cells(["..", ".."], heights={(0, 0): 7, (1, 0): 9, (0, 1): 7, (1, 1): 8}),
        observer=Position(x=0, y=0, z=7),
    )

    assert "elevation, metres above 7 m:" in picture
    assert "02" in picture.splitlines()
    assert "01" in picture.splitlines()


def test_steep_ground_states_its_range_rather_than_wrapping_digits() -> None:
    # Two digits would misalign against the terrain grid and a wrapped single
    # digit would misreport the ground, so relief beyond nine metres is stated.
    relief = MAX_DIGIT_RELIEF + 5
    picture = render_terrain(
        cells(["..", ".."], heights={(0, 0): 0, (1, 0): relief, (0, 1): 1, (1, 1): 2}),
        observer=Position(x=0, y=0, z=0),
    )

    assert f"elevation: 0..{relief} m" in picture
    assert "elevation, metres above" not in picture


def test_terrain_with_nothing_visible_says_so() -> None:
    assert render_terrain([], observer=Position(x=0, y=0, z=0)) == (
        "Terrain you can see: nothing."
    )


def observation(**overrides: object) -> ObservedSoldier:
    defaults = {
        "team": Team.BLUE,
        "position": Position(x=1, y=1, z=0),
        "survival_status": SurvivalState.ALIVE,
        "visible_soldiers": [],
        "available_terrain": cells(["^^^", "^^^", "^^^"]),
    }
    return ObservedSoldier(**{**defaults, **overrides})


def test_observation_reports_position_and_sightings() -> None:
    rendered = render_observation(
        observation(
            visible_soldiers=[
                VisibleSoldier(
                    team=Team.RED,
                    position=Position(x=2, y=0, z=0),
                    survival_status=SurvivalState.ALIVE,
                )
            ]
        )
    )

    assert "You are blue, at (1,1)" in rendered
    assert "Visible soldiers: red at (2,0) alive." in rendered


def test_observation_without_sightings_says_none() -> None:
    assert "Visible soldiers: none." in render_observation(observation())


def test_history_replays_each_past_tick() -> None:
    context = AgentContext(
        current_observation=observation(),
        visibility_history=(
            VisibilityObservation(
                tick=4,
                position=Position(x=0, y=1, z=0),
                submitted_action=MoveAction(direction=MoveDirection.EAST),
                visible_soldiers=[],
                available_terrain=cells(["~~~"]),
            ),
        ),
    )

    rendered = render_agent_context(context)

    assert "t4: at (0,1)" in rendered
    assert "east" in rendered
    assert "Terrain you saw" in rendered
    assert "~=Water" in rendered


def test_first_tick_history_says_so() -> None:
    rendered = render_agent_context(
        AgentContext(current_observation=observation(), visibility_history=())
    )

    assert "Recent ticks: none, this is your first." in rendered


def test_rendered_context_is_far_smaller_than_the_json_dump() -> None:
    # The point of the format: a uniform view costs a fraction of per-cell JSON.
    observed = observation(
        available_terrain=cells(["^" * 21 for _ in range(21)])
    )
    context = AgentContext(
        current_observation=observed,
        visibility_history=tuple(
            VisibilityObservation(
                tick=tick,
                position=observed.position,
                submitted_action=MoveAction(direction=MoveDirection.NORTH),
                visible_soldiers=[],
                available_terrain=observed.available_terrain,
            )
            for tick in range(10)
        ),
    )

    assert len(render_agent_context(context)) < len(context.model_dump_json()) / 20
