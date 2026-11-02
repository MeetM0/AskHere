"""Generate the extension icons (a rounded square with a four-point spark)."""
import sys
from pathlib import Path
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "extension" / "icons"
BG = (194, 97, 44, 255)
FG = (255, 255, 255, 255)


def spark(size):
    s = size * 4  # supersample for smooth edges
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.24), fill=BG)
    c, r, w = s / 2, s * 0.34, s * 0.085
    pts = [(c, c - r), (c + w, c - w), (c + r, c), (c + w, c + w),
           (c, c + r), (c - w, c + w), (c - r, c), (c - w, c - w)]
    d.polygon(pts, fill=FG)
    return img.resize((size, size), Image.LANCZOS)


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for size in (16, 32, 48, 128):
        spark(size).save(OUT / f"icon{size}.png")
    print("icons written to", OUT, file=sys.stderr)
