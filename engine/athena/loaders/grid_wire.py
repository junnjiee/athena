"""Decode the terrain service's packed grid.

The wire format is owned by ``server/src/services/grid.ts`` and mirrored here.
It is the same buffer the web app decodes, so the engine and the operator read
one set of bytes rather than two representations that can disagree::

    offset  0  u32       magic 0x41544847 ("ATHG")
    offset  4  u16       version (1)
    offset  6  u16       width
    offset  8  u16       height
    offset 10  u16       reserved
    offset 12  f32       cellMeters
    offset 16  f32[w*h]  elevation, metres
    then       u8[w*h]   x8: cls, slope, cover, concealment, moveCost,
                             visibility, vehicleMobility, ambush

Only ``elevation`` and ``cls`` are read. The other six channels are the web
app's tactical heatmaps, all derived from ground the engine models itself
through ``TERRAIN_PROFILES``; consuming them would give a cell two sources of
truth about cover.
"""

import struct
from dataclasses import dataclass

from athena.loaders.errors import PayloadError

GRID_MAGIC = 0x41544847
GRID_VERSION = 1
HEADER_BYTES = 16
U8_CHANNELS = 8

_HEADER_FORMAT = "<IHHHHf"


@dataclass(frozen=True)
class PackedGrid:
    """One decoded terrain grid, row-major with row 0 northernmost."""

    width: int
    height: int
    cell_meters: float
    elevation: tuple[float, ...]
    """Real metres above the DEM datum, not yet quantized to engine levels."""

    terrain_classes: tuple[int, ...]
    """Raw ``cls`` codes; the caller checks them against ``TerrainClass``."""


def decode_grid(buffer: bytes) -> PackedGrid:
    """Read a packed grid buffer.

    The magic and version are checked rather than assumed. A server that
    changes the layout must bump ``GRID_VERSION``, which turns a format change
    into a loud failure here instead of silently misread elevations.
    """
    if len(buffer) < HEADER_BYTES:
        raise PayloadError(
            f"grid buffer is {len(buffer)} bytes; too short for a {HEADER_BYTES}"
            "-byte header"
        )

    magic, version, width, height, _reserved, cell_meters = struct.unpack_from(
        _HEADER_FORMAT, buffer, 0
    )
    if magic != GRID_MAGIC:
        raise PayloadError(
            f"grid buffer has magic 0x{magic:08X}; expected 0x{GRID_MAGIC:08X}"
        )
    if version != GRID_VERSION:
        raise PayloadError(
            f"grid buffer is version {version}; this engine reads version "
            f"{GRID_VERSION}"
        )

    cells = width * height
    expected = HEADER_BYTES + cells * 4 + cells * U8_CHANNELS
    if len(buffer) != expected:
        raise PayloadError(
            f"grid buffer is {len(buffer)} bytes; expected {expected} for "
            f"{width}x{height}"
        )

    elevation = struct.unpack_from(f"<{cells}f", buffer, HEADER_BYTES)
    classes_start = HEADER_BYTES + cells * 4
    terrain_classes = tuple(buffer[classes_start : classes_start + cells])

    return PackedGrid(
        width=width,
        height=height,
        cell_meters=cell_meters,
        elevation=elevation,
        terrain_classes=terrain_classes,
    )
