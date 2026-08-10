import struct

import pytest

from athena.loaders import PayloadError, decode_grid
from athena.loaders.grid_wire import (
    GRID_MAGIC,
    GRID_VERSION,
    HEADER_BYTES,
    U8_CHANNELS,
)


def pack_grid(
    width: int,
    height: int,
    cell_meters: float,
    elevation: list[float],
    classes: list[int],
    magic: int = GRID_MAGIC,
    version: int = GRID_VERSION,
) -> bytes:
    """Mirror of ``packGrid`` in server/src/services/grid.ts.

    Written out rather than derived from the decoder, so a decoder that drifts
    from the server's layout fails instead of agreeing with itself.
    """
    cells = width * height
    header = struct.pack("<IHHHHf", magic, version, width, height, 0, cell_meters)
    heights = struct.pack(f"<{cells}f", *elevation)
    # cls first, then seven heatmap channels the engine ignores.
    channels = bytes(classes) + bytes(cells * (U8_CHANNELS - 1))
    return header + heights + channels


def test_decodes_elevation_and_classes():
    buffer = pack_grid(
        width=3,
        height=2,
        cell_meters=1.5,
        elevation=[10.0, 11.0, 12.0, 13.0, 14.0, 15.0],
        classes=[0, 3, 5, 7, 8, 9],
    )

    grid = decode_grid(buffer)

    assert (grid.width, grid.height) == (3, 2)
    assert grid.cell_meters == 1.5
    assert grid.elevation == (10.0, 11.0, 12.0, 13.0, 14.0, 15.0)
    assert grid.terrain_classes == (0, 3, 5, 7, 8, 9)


def test_row_major_layout_matches_the_server():
    """Row 0 is northernmost, so index 3 in a 3-wide grid is row 1, column 0."""
    buffer = pack_grid(
        width=3,
        height=2,
        cell_meters=1.0,
        elevation=[0.0] * 6,
        classes=[0, 0, 0, 3, 0, 0],
    )

    grid = decode_grid(buffer)

    assert grid.terrain_classes[1 * 3 + 0] == 3


def test_rejects_a_foreign_buffer():
    buffer = pack_grid(1, 1, 1.0, [0.0], [0], magic=0xDEADBEEF)

    with pytest.raises(PayloadError, match="magic"):
        decode_grid(buffer)


def test_rejects_an_unknown_version():
    buffer = pack_grid(1, 1, 1.0, [0.0], [0], version=GRID_VERSION + 1)

    with pytest.raises(PayloadError, match="version"):
        decode_grid(buffer)


def test_rejects_a_truncated_buffer():
    buffer = pack_grid(2, 2, 1.0, [0.0] * 4, [0] * 4)

    with pytest.raises(PayloadError, match="expected"):
        decode_grid(buffer[:-1])


def test_rejects_a_buffer_shorter_than_the_header():
    with pytest.raises(PayloadError, match="too short"):
        decode_grid(bytes(HEADER_BYTES - 1))
