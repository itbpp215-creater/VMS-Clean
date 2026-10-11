"""Create a two-layer PSD for the V6 pointed-shield logo."""
from __future__ import annotations

import struct
from pathlib import Path

from PIL import Image, ImageChops

ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / "bpp-prerimwatch-pointed-shield.psd"
COMPOSITE = ROOT / "bpp-prerimwatch-pointed-shield.png"
LAYER_SOURCES = [
    ("Display Typography Frame", ROOT / "layer-display-typography-frame.png"),
    ("Shield and Approved Mascot", ROOT / "layer-shield-approved-mascot.png"),
]


def packbits(row: bytes) -> bytes:
    result = bytearray()
    index = 0
    while index < len(row):
        run = 1
        while index + run < len(row) and run < 128 and row[index + run] == row[index]:
            run += 1
        if run >= 3:
            result.extend((257 - run, row[index]))
            index += run
            continue
        start = index
        index += run
        while index < len(row):
            next_run = 1
            while index + next_run < len(row) and next_run < 128 and row[index + next_run] == row[index]:
                next_run += 1
            if next_run >= 3 or index - start >= 128:
                break
            index += next_run
        literal = row[start:index]
        result.append(len(literal) - 1)
        result.extend(literal)
    return bytes(result)


def channel_block(channel: Image.Image) -> bytes:
    width, height = channel.size
    raw = channel.tobytes()
    rows = [packbits(raw[row * width : (row + 1) * width]) for row in range(height)]
    return struct.pack(">H", 1) + b"".join(struct.pack(">H", len(row)) for row in rows) + b"".join(rows)


def pascal_name(name: str) -> bytes:
    encoded = name.encode("ascii")[:255]
    payload = bytes((len(encoded),)) + encoded
    return payload + b"\x00" * ((4 - len(payload) % 4) % 4)


def build_psd() -> None:
    composite = Image.open(COMPOSITE).convert("RGBA")
    art = Image.open(ROOT / "layer-shield-approved-mascot.png").convert("RGBA")
    difference = ImageChops.difference(composite, art)
    diff_channels = difference.split()
    alpha = ImageChops.lighter(ImageChops.lighter(diff_channels[0], diff_channels[1]), ImageChops.lighter(diff_channels[2], diff_channels[3]))
    alpha = alpha.point(lambda value: 0 if value < 3 else min(255, value * 4))
    typography = composite.copy()
    typography.putalpha(alpha)
    typography.save(ROOT / "layer-display-typography-frame.png", optimize=True)
    width, height = composite.size
    prepared = []
    for name, path in LAYER_SOURCES:
        image = Image.open(path).convert("RGBA")
        if image.size != composite.size:
            raise ValueError(f"Layer size mismatch: {path.name}")
        prepared.append((name, [channel_block(image.getchannel(channel)) for channel in ("R", "G", "B", "A")]))
    records = bytearray()
    for name, blocks in prepared:
        records.extend(struct.pack(">iiiiH", 0, 0, height, width, 4))
        for channel_id, block in zip((0, 1, 2, -1), blocks):
            records.extend(struct.pack(">hI", channel_id, len(block)))
        extra = struct.pack(">I", 0) + struct.pack(">I", 0) + pascal_name(name)
        records.extend(b"8BIMnorm" + bytes((255, 0, 0, 0)) + struct.pack(">I", len(extra)) + extra)
    pixels = b"".join(block for _, blocks in prepared for block in blocks)
    layer_info = struct.pack(">h", len(prepared)) + bytes(records) + pixels
    if len(layer_info) % 2:
        layer_info += b"\x00"
    layer_mask = struct.pack(">I", len(layer_info)) + layer_info + struct.pack(">I", 0)
    header = b"8BPS" + struct.pack(">H", 1) + b"\x00" * 6 + struct.pack(">HIIHH", 4, height, width, 8, 3)
    sections = struct.pack(">I", 0) + struct.pack(">I", 0) + struct.pack(">I", len(layer_mask)) + layer_mask
    composite_blocks = [channel_block(composite.getchannel(channel)) for channel in ("R", "G", "B", "A")]
    count_size = height * 2
    counts = b"".join(block[2 : 2 + count_size] for block in composite_blocks)
    data = b"".join(block[2 + count_size :] for block in composite_blocks)
    OUTPUT.write_bytes(header + sections + struct.pack(">H", 1) + counts + data)


if __name__ == "__main__":
    build_psd()
