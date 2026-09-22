"""Assets nativos = mock A aprobado (sin reinventar el isologo)."""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

OUT = Path(__file__).resolve().parents[1] / "assets"
MOCK = OUT / "mock-bacar-icon-red.png"
SIZE = 1024


def knock_out_bg(rgba: np.ndarray, thr: int = 246) -> np.ndarray:
    r, g, b = rgba[..., 0], rgba[..., 1], rgba[..., 2]
    bright = (r.astype(np.int16) + g.astype(np.int16) + b.astype(np.int16)) / 3
    near_white = (
        (bright >= thr)
        & (np.abs(r.astype(int) - g.astype(int)) < 14)
        & (np.abs(g.astype(int) - b.astype(int)) < 14)
    )
    out = rgba.copy()
    out[near_white, 3] = 0
    return out


def main() -> None:
    if not MOCK.exists():
        raise SystemExit(f"Falta {MOCK}")

    mock = Image.open(MOCK).convert("RGBA")
    # Icono launcher / splash / favicon = mock A exacto
    rgb = mock.convert("RGB")
    if rgb.size != (SIZE, SIZE):
        rgb = rgb.resize((SIZE, SIZE), Image.Resampling.LANCZOS)
        mock = mock.resize((SIZE, SIZE), Image.Resampling.LANCZOS)
    for name in ("icon.png", "favicon.png", "splash-icon.png", "_cap-A-icono.png"):
        rgb.save(OUT / name, optimize=True)

    arr = np.asarray(mock)
    fg = Image.fromarray(knock_out_bg(arr), "RGBA")
    alpha = fg.split()[-1].filter(ImageFilter.GaussianBlur(0.35))
    fg.putalpha(alpha)
    fg.save(OUT / "android-icon-foreground.png", optimize=True)
    Image.new("RGB", (SIZE, SIZE), "#FFFFFF").save(OUT / "android-icon-background.png", optimize=True)

    mono = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    mono.paste(Image.new("RGBA", (SIZE, SIZE), (255, 255, 255, 255)), (0, 0), alpha)
    mono.save(OUT / "android-icon-monochrome.png", optimize=True)

    # Marca login: B con transparencia (sin fondo blanco del mock)
    a = np.asarray(alpha)
    ys, xs = np.where(a > 18)
    pad = 12
    crop = fg.crop(
        (
            max(0, int(xs.min()) - pad),
            max(0, int(ys.min()) - pad),
            min(SIZE, int(xs.max()) + pad),
            min(SIZE, int(ys.max()) + pad),
        )
    )
    side = max(crop.size)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(crop, ((side - crop.size[0]) // 2, (side - crop.size[1]) // 2), crop)
    canvas.resize((512, 512), Image.Resampling.LANCZOS).save(OUT / "bacar-mark.png", optimize=True)

    print("OK mock A -> icon/mark")
    for n in ("icon.png", "bacar-mark.png", "android-icon-foreground.png"):
        print(f"  {n}: {(OUT / n).stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
