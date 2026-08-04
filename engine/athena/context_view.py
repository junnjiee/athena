"""Render an agent's context as text rather than JSON.

Terrain dominates an agent's message: a soldier at the default vision range
sees roughly three hundred cells, and as one JSON object each that is ~24,000
characters carrying almost no information -- in dense forest every cell reports
the same class. Serialised per cell it also destroys the one thing a soldier
actually reasons about, which is shape: where the treeline runs, which way the
road goes, whether the high ground is left or right.

Drawn as a grid the same observation costs about a fiftieth as much and reads
as a picture. The glyphs are the ones the terminal view uses, so an operator
watching the demo sees what the agent sees.
"""

from collections.abc import Sequence

from athena.models import (
    AgentContext,
    ObservedSoldier,
    Position,
    TERRAIN_GLYPHS,
    TERRAIN_LABELS,
    TerrainCell,
    VisibilityObservation,
)

BLANK = " "
"""Stands for a cell inside the bounding box that the soldier cannot see."""

MAX_DIGIT_RELIEF = 9
"""Largest relief a single-digit elevation grid can express without wrapping."""


def _bounds(cells: Sequence[TerrainCell]) -> tuple[int, int, int, int]:
    xs = [cell.position.x for cell in cells]
    ys = [cell.position.y for cell in cells]
    return min(xs), max(xs), min(ys), max(ys)


def _rows(
    values: dict[tuple[int, int], str],
    x0: int,
    x1: int,
    y0: int,
    y1: int,
) -> str:
    return "\n".join(
        "".join(values.get((x, y), BLANK) for x in range(x0, x1 + 1))
        for y in range(y0, y1 + 1)
    )


def render_terrain(
    cells: Sequence[TerrainCell],
    observer: Position,
    caption: str = "Terrain you can see",
) -> str:
    """Draw visible terrain as a glyph grid with a matching elevation grid.

    Rows run north to south and columns west to east, matching the battlefield's
    own axes so a bearing read off the picture is the bearing the soldier moves
    on. Cells the soldier cannot see are left blank, which makes the shape of
    its vision -- and anything blocking it -- visible rather than implied.
    """
    if not cells:
        return f"{caption}: nothing."

    x0, x1, y0, y1 = _bounds(cells)
    glyphs = {
        (cell.position.x, cell.position.y): TERRAIN_GLYPHS[cell.terrain_class]
        for cell in cells
    }
    heights = {
        (cell.position.x, cell.position.y): cell.position.z for cell in cells
    }
    present = sorted({cell.terrain_class for cell in cells})
    legend = "  ".join(
        f"{TERRAIN_GLYPHS[terrain_class]}={TERRAIN_LABELS[terrain_class]}"
        for terrain_class in present
    )

    lowest = min(heights.values())
    relief = max(heights.values()) - lowest
    header = (
        f"{caption}, x {x0}..{x1} increasing east, "
        f"y {y0}..{y1} increasing south, you at ({observer.x},{observer.y}):"
    )
    picture = _rows(glyphs, x0, x1, y0, y1)

    # A single digit per cell keeps the elevation grid aligned with the terrain
    # grid above it, which is what makes the two readable together. Beyond nine
    # metres of relief digits would wrap and quietly misreport the ground, so
    # the fallback states the range in words instead of drawing it.
    if relief > MAX_DIGIT_RELIEF:
        elevation = (
            f"elevation: {lowest}..{lowest + relief} m, "
            f"you are at {observer.z} m"
        )
    else:
        elevation = f"elevation, metres above {lowest} m:\n" + _rows(
            {key: str(value - lowest) for key, value in heights.items()},
            x0,
            x1,
            y0,
            y1,
        )

    return "\n".join([header, picture, legend, elevation])


def render_observation(observed: ObservedSoldier) -> str:
    """Describe what a soldier can see this tick."""
    if observed.visible_soldiers:
        sighted = ", ".join(
            f"{soldier.team.value} at ({soldier.position.x},{soldier.position.y}) "
            f"{soldier.survival_status.value}"
            for soldier in observed.visible_soldiers
        )
    else:
        sighted = "none"

    return "\n\n".join(
        [
            f"You are {observed.team.value}, at "
            f"({observed.position.x},{observed.position.y}), elevation "
            f"{observed.position.z} m, {observed.survival_status.value}.",
            f"Visible soldiers: {sighted}.",
            render_terrain(observed.available_terrain, observed.position),
        ]
    )


def _render_history(history: Sequence[VisibilityObservation]) -> str:
    """Replay past ticks: where the soldier stood, what it did, what it saw."""
    if not history:
        return "Recent ticks: none, this is your first."

    blocks = []
    for observation in history:
        action = observation.submitted_action
        did = "did nothing" if action is None else action.model_dump_json()
        blocks.append(
            f"t{observation.tick}: at ({observation.position.x},"
            f"{observation.position.y}), {did}, "
            f"{len(observation.visible_soldiers)} soldiers in sight\n"
            + render_terrain(
                observation.available_terrain,
                observation.position,
                caption="Terrain you saw",
            )
        )
    return "Recent ticks, oldest first:\n" + "\n\n".join(blocks)


def render_agent_context(context: AgentContext) -> str:
    """Render the whole agent message: observation, track, and radio."""
    sections = [
        render_observation(context.current_observation),
        _render_history(context.visibility_history),
    ]

    if context.communication_groups:
        sections.append(
            "Radio nets you can broadcast on: "
            + ", ".join(
                f"{group.name} (group_id {group.group_id})"
                for group in context.communication_groups
            )
        )

    if context.communication_history:
        sections.append(
            "Radio traffic, oldest first:\n"
            + "\n".join(
                f"  t{message.sent_tick} soldier {message.sender_index} "
                f"on {message.group_id}: {message.content}"
                for message in context.communication_history
            )
        )

    return "\n\n".join(sections)
