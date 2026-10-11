#!/usr/bin/env python3
"""Generate square favicon / PWA app icons from a (possibly non-square) source logo.
Logo is centered on a transparent square canvas (contain, no distortion)."""
import base64
import os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "source-logo.png")


def contain_square(logo, size, scale=0.92):
    """Return a size x size RGBA image with the logo scaled to `scale` of the box, centered."""
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    box = int(size * scale)
    w, h = logo.size
    ratio = min(box / w, box / h)
    new = (max(1, int(w * ratio)), max(1, int(h * ratio)))
    resized = logo.resize(new, Image.LANCZOS)
    pos = ((size - new[0]) // 2, (size - new[1]) // 2)
    canvas.paste(resized, pos, resized)
    return canvas


def main():
    logo = Image.open(SRC).convert("RGBA")
    print(f"source: {SRC}  size={logo.size}  mode=RGBA")

    # Standard favicons / app icons (slight padding 0.92)
    outputs = {
        "favicon-16.png": (16, 0.96),
        "favicon-32.png": (32, 0.96),
        "apple-touch.png": (180, 0.88),
        "android-192.png": (192, 0.90),
        "android-512.png": (512, 0.90),
        # maskable icons need a larger safe zone (~60% of canvas)
        "maskable-512.png": (512, 0.60),
        "maskable-badge.png": (512, 0.60),
    }
    for name, (size, scale) in outputs.items():
        img = contain_square(logo, size, scale)
        img.save(os.path.join(HERE, name))
        print(f"  wrote {name} ({size}x{size}, scale={scale})")

    # Multi-resolution .ico
    ico = contain_square(logo, 256, 0.96)
    ico.save(os.path.join(HERE, "favicon.ico"),
             sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
    print("  wrote favicon.ico (16/32/48/64)")

    # SVG favicon embedding the 512 PNG as base64
    png512_path = os.path.join(HERE, "android-512.png")
    with open(png512_path, "rb") as f:
        b64 = base64.b64encode(f.read()).decode("ascii")
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" '
        'width="512" height="512" viewBox="0 0 512 512">'
        f'<image href="data:image/png;base64,{b64}" '
        'width="512" height="512"/></svg>'
    )
    with open(os.path.join(HERE, "favicon.svg"), "w", encoding="utf-8") as f:
        f.write(svg)
    print("  wrote favicon.svg (embedded PNG)")


if __name__ == "__main__":
    main()
