#!/usr/bin/env python3
"""Resize/center-crop chunk surface art to 1024² and seal the vertical tile seam."""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

TARGET = 1024


def postprocess(src: Path, dst: Path) -> None:
    im = Image.open(src).convert("RGBA")
    w, h = im.size
    if w >= TARGET and h >= TARGET:
        left = (w - TARGET) // 2
        top = (h - TARGET) // 2
        im = im.crop((left, top, left + TARGET, top + TARGET))
    else:
        im = im.resize((TARGET, TARGET), Image.Resampling.LANCZOS)

    pixels = im.load()
    assert pixels is not None
    for x in range(TARGET):
        pixels[x, TARGET - 1] = pixels[x, 0]

    dst.parent.mkdir(parents=True, exist_ok=True)
    im.save(dst, format="PNG", optimize=True)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("usage: postprocess-chunk-surface.py <input.png> <output.png>", file=sys.stderr)
        sys.exit(1)
    postprocess(Path(sys.argv[1]), Path(sys.argv[2]))
