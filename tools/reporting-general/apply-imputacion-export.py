# -*- coding: utf-8 -*-
"""
Copia unidades-negocio.json exportado desde el editor HTML y regenera el pack.

Uso (después de Descargar JSON desde listado-imputacion.html):
  npm run apply:imputacion-un

  # o ruta custom:
  python tools/reporting-general/apply-imputacion-export.py D:\\Downloads\\unidades-negocio.json
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
REPORTING = ROOT / "tools" / "reporting-general"
DST = REPORTING / "unidades-negocio.json"
DIST_DIR = ROOT / "dist" / "Tableros-Gerencia-Agosto"


def candidate_sources():
    home = Path.home()
    yield DIST_DIR / "unidades-negocio.json"
    yield home / "Downloads" / "unidades-negocio.json"
    yield home / "Descargas" / "unidades-negocio.json"


def resolve_source(explicit: str | None) -> Path | None:
    if explicit:
        p = Path(explicit)
        return p if p.exists() else None
    found = [p for p in candidate_sources() if p.exists()]
    if not found:
        return None
    return max(found, key=lambda p: p.stat().st_mtime)


def main():
    src = resolve_source(sys.argv[1] if len(sys.argv) > 1 else None)
    if not src:
        print("No encontre unidades-negocio.json")
        print("Busque en:")
        for p in candidate_sources():
            print(f"  - {p}")
        print("Descargalo desde listado-imputacion.html o pasa la ruta como argumento.")
        sys.exit(1)

    data = json.loads(src.read_text(encoding="utf-8"))
    if "imputaciones" not in data:
        print("El archivo no parece unidades-negocio.json valido (falta imputaciones).")
        sys.exit(1)

    DST.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    pend = sum(1 for r in data["imputaciones"] if not r.get("unidadId"))
    print(f"OK copiado a {DST}")
    print(f"  origen: {src}")
    print(f"  pendientes: {pend} / {len(data['imputaciones'])}")

    r = subprocess.run([sys.executable, str(ROOT / "tools" / "pack-tableros-drive.py")], cwd=str(ROOT))
    if r.returncode != 0:
        sys.exit(r.returncode)

    DIST_DIR.mkdir(parents=True, exist_ok=True)
    (DIST_DIR / "unidades-negocio.json").write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"OK JSON copiado a {DIST_DIR / 'unidades-negocio.json'}")
    print("Recarga index.html con Ctrl+F5")


if __name__ == "__main__":
    main()
