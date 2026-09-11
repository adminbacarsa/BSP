"""Genera icono 512 y feature graphic 1024x500 para Play Console."""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ASSETS = Path(__file__).resolve().parents[1] / "assets"
OUT = Path(__file__).resolve().parents[1] / "store"


def try_font(size: int, bold: bool = True) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    candidates = [
        r"C:\Windows\Fonts\segoeuib.ttf" if bold else r"C:\Windows\Fonts\segoeui.ttf",
        r"C:\Windows\Fonts\arialbd.ttf" if bold else r"C:\Windows\Fonts\arial.ttf",
        r"C:\Windows\Fonts\calibrib.ttf" if bold else r"C:\Windows\Fonts\calibri.ttf",
    ]
    for path in candidates:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)

    src = Image.open(ASSETS / "icon.png").convert("RGBA")
    if src.size != (512, 512):
        src = src.resize((512, 512), Image.Resampling.LANCZOS)
    icon = Image.new("RGB", (512, 512), "#8B1A1A")
    icon.paste(src, (0, 0), src)
    icon_path = OUT / "play-icon-512.png"
    icon.save(icon_path, format="PNG", optimize=True)
    print(f"icon: {icon_path} ({icon_path.stat().st_size} bytes)")

    w, h = 1024, 500
    feat = Image.new("RGB", (w, h), "#0B1220")
    draw = ImageDraw.Draw(feat)
    for x in range(w):
        t = x / (w - 1)
        r = int(139 * (1 - t * 0.85) + 11 * (t * 0.85))
        g = int(26 * (1 - t * 0.7) + 18 * (t * 0.7))
        b = int(26 * (1 - t * 0.55) + 40 * (t * 0.55))
        draw.line([(x, 0), (x, h)], fill=(r, g, b))

    feat_rgba = feat.convert("RGBA")
    vignette = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    vd = ImageDraw.Draw(vignette)
    for y in range(h // 2, h):
        a = int(100 * ((y - h / 2) / (h / 2)))
        vd.line([(0, y), (w, y)], fill=(0, 0, 0, a))
    feat_rgba = Image.alpha_composite(feat_rgba, vignette)

    shadow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(shadow).ellipse((78, 118, 378, 418), fill=(0, 0, 0, 90))
    feat_rgba = Image.alpha_composite(feat_rgba, shadow)

    mark = Image.open(ASSETS / "icon.png").convert("RGBA").resize((280, 280), Image.Resampling.LANCZOS)
    feat_rgba.paste(mark, (88, 110), mark)
    feat = feat_rgba.convert("RGB")
    draw = ImageDraw.Draw(feat)

    title_font = try_font(72, True)
    sub_font = try_font(28, False)
    tx, ty = 420, 160
    draw.text((tx, ty), "COSP Guardia", font=title_font, fill="#FFFFFF")
    draw.rounded_rectangle((tx, ty + 80, tx + 160, ty + 86), radius=3, fill="#C45C5C")
    draw.text((tx, ty + 95), "Portal del vigilador", font=sub_font, fill="#E8C4C4")

    feat_path = OUT / "play-feature-1024x500.png"
    feat.save(feat_path, format="PNG", optimize=True)
    print(f"feature: {feat_path} ({feat_path.stat().st_size} bytes)")
    print("OK")


if __name__ == "__main__":
    main()
