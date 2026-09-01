"""Terrain classification and the per-class properties resolvers read."""

from dataclasses import dataclass
from enum import IntEnum


class TerrainClass(IntEnum):
    """Terrain categories for a battlefield cell.

    Values match the ``classNames`` indices emitted by the frontend terrain
    export, so an imported class grid needs no translation layer.
    """

    OPEN_GROUND = 0
    GRASSLAND = 1
    SCRUB = 2
    DENSE_FOREST = 3
    WETLAND = 4
    WATER = 5
    URBAN = 6
    STRUCTURE = 7
    ROAD = 8
    BARREN_ROCK = 9
    # Engine-side only: the frontend classifier never emits this, because a
    # trench is drawn by a commander rather than read off satellite imagery. It
    # arrives as a per-cell override on the payload, so it is never part of the
    # exported class grid and the numbering contract with the export is intact.
    TRENCH = 10


TERRAIN_LABELS: dict[TerrainClass, str] = {
    TerrainClass.OPEN_GROUND: "Open Ground",
    TerrainClass.GRASSLAND: "Grassland",
    TerrainClass.SCRUB: "Scrub / Bush",
    TerrainClass.DENSE_FOREST: "Dense Forest",
    TerrainClass.WETLAND: "Wetland",
    TerrainClass.WATER: "Water",
    TerrainClass.URBAN: "Urban Area",
    TerrainClass.STRUCTURE: "Structure",
    TerrainClass.ROAD: "Road",
    TerrainClass.BARREN_ROCK: "Barren / Rock",
    TerrainClass.TRENCH: "Trench",
}
"""Human-readable names, matching the export's ``classNames`` strings."""


TERRAIN_GLYPHS: dict[TerrainClass, str] = {
    TerrainClass.OPEN_GROUND: ".",
    TerrainClass.GRASSLAND: ",",
    TerrainClass.SCRUB: ";",
    TerrainClass.DENSE_FOREST: "^",
    TerrainClass.WETLAND: "_",
    TerrainClass.WATER: "~",
    TerrainClass.URBAN: "o",
    TerrainClass.STRUCTURE: "#",
    TerrainClass.ROAD: "=",
    TerrainClass.BARREN_ROCK: "%",
    TerrainClass.TRENCH: "T",
}
"""One character per class, for rendering terrain as a picture.

Shared by the terminal view and the agent's observation: a soldier reads the
same map the operator does, and the two cannot drift apart.
"""


@dataclass(frozen=True)
class TerrainProfile:
    """How one terrain class affects movement, sight, and gunfire.

    Each field is consumed by exactly one resolver, which keeps the axes
    independent: a cell can be slow without being opaque (wetland), opaque
    without being solid (dense forest), or solid without being opaque (water).
    A single cover/concealment flag pair cannot express those combinations.
    """

    passable: bool
    """Whether a soldier may enter the cell at all."""

    move_cost: float
    """Relative cost to traverse the cell. Not yet read by any resolver."""

    opacity_per_metre: float
    """Sight blocked per metre travelled through the cell.

    Accumulated along a sightline; the line is blocked once the running total
    reaches 1.0. At 1 m cells a single dense-forest cell should not blind an
    observer, but twenty of them should.
    """

    concealment: float
    """Probability that an enemy standing here goes unseen despite clear sight."""

    protection: float
    """Reduction applied to the probability of hitting a soldier in this cell."""
