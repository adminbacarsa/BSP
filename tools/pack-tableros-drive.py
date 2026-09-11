# -*- coding: utf-8 -*-
"""
Genera UNA carpeta plana para subir a Drive (Tableros Gerencia).

Todos los HTML en el mismo nivel; Control Directivo = index.html.
Links relativos entre archivos .html — funcionan al descargar la carpeta y abrir en Chrome.

Uso:
  python tools/pack-tableros-drive.py
  python tools/pack-tableros-drive.py D:\\Tableros-Gerencia-Agosto

Futuro intranet: los Excel irán en datos/ y los tableros en la plataforma
leerán esos archivos; este pack es el caso estático actual (datos embebidos).
"""
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOOLS = ROOT / "tools"
REPORTING = TOOLS / "reporting-general"
DEFAULT_OUT = ROOT / "dist" / "Tableros-Gerencia-Agosto"

COPY = [
    (TOOLS / "reporting-general" / "index.html", "index.html"),
    (TOOLS / "reporting-general" / "listado-imputacion.html", "listado-imputacion.html"),
    (TOOLS / "ventas-cobranzas" / "index.html", "ventas-cobranzas.html"),
    (TOOLS / "facturas-electronicas" / "index.html", "facturas-electronicas.html"),
    (TOOLS / "compras" / "index.html", "compras.html"),
    (TOOLS / "mano-de-obra" / "index.html", "mano-de-obra.html"),
    (TOOLS / "novedades-camioneros" / "index.html", "camioneros.html"),
]

LEEME = """Tableros Gerencia — Grupo Bacar (Agosto 2026)
================================================

CÓMO VER (Google Drive)
-----------------------
1. Subí ESTA carpeta completa a Drive (una sola carpeta).
2. Quien quiera ver: Descargar → descomprimir/abrir carpeta en el PC.
3. Doble clic en: index.html  (Control Directivo)
4. Desde ahí: "Abrir tablero" navega a los otros .html del mismo folder.

IMPORTANTE
----------
• Drive NO ejecuta HTML en el navegador (solo muestra código).
• Hay que DESCARGAR la carpeta y abrir index.html localmente.
• No separes ni renombres los .html — deben quedar juntos.

ARCHIVOS
--------
  index.html                  → Control Directivo (panel madre)
  listado-imputacion.html     → Editor UN (dropdown + exportar JSON)
  ventas-cobranzas.html
  facturas-electronicas.html
  compras.html
  mano-de-obra.html
  camioneros.html
  datos/                      → reservado: futuros Excel de colaboradores

FUTURO (intranet)
-----------------
Los colaboradores subirán Excel a la plataforma; cada tablero leerá
esos archivos y se regenerará. Este pack es la versión estática actual.

REGENERAR (IT / Mauro)
----------------------
Desde el repo cronoapp, tras actualizar fuentes (_parse.py en cada módulo):
  python tools/pack-tableros-drive.py
Subir de nuevo la carpeta dist/Tableros-Gerencia-Agosto a Drive.
"""


def run_build_flat():
    print("> sync-imputacion-catalogo.py")
    r0 = subprocess.run(
        [sys.executable, "sync-imputacion-catalogo.py", "--write-html"],
        cwd=str(REPORTING),
    )
    if r0.returncode != 0:
        sys.exit(r0.returncode)

    pack_cfg = REPORTING / "pack-config.json"
    pack_cfg.write_text(
        json.dumps({"mode": "flat", "links": {}}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    try:
        for script in ("_rollup.py", "build.py"):
            print(">", script)
            r = subprocess.run([sys.executable, script], cwd=str(REPORTING))
            if r.returncode != 0:
                sys.exit(r.returncode)
    finally:
        if pack_cfg.exists():
            pack_cfg.unlink()


def main():
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUT
    if out.exists():
        shutil.rmtree(out)
    out.mkdir(parents=True)

    run_build_flat()

    total_kb = 0
    for src, name in COPY:
        if not src.exists():
            print("SKIP missing", src)
            continue
        dest = out / name
        shutil.copy2(src, dest)
        kb = dest.stat().st_size // 1024
        total_kb += kb
        print(f"  {name} ({kb} KB)")

    datos = out / "datos"
    datos.mkdir(exist_ok=True)
    (datos / ".gitkeep").write_text("", encoding="utf-8")
    (datos / "LEEME.txt").write_text(
        "Carpeta reservada para archivos Excel fuente (futuro).\n"
        "Hoy los datos van embebidos en cada .html al generar el pack.\n",
        encoding="utf-8",
    )

    (out / "LEEME.txt").write_text(LEEME, encoding="utf-8")

    zip_path = shutil.make_archive(str(out), "zip", root_dir=out.parent, base_dir=out.name)
    print(f"\nOK Carpeta: {out}")
    print(f"OK ZIP:     {zip_path}")
    print(f"  Total ~{total_kb} KB en HTML")
    print("\nSubí la carpeta (o el .zip) a Drive. Ver LEEME.txt")


if __name__ == "__main__":
    main()
