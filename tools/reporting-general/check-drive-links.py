# -*- coding: utf-8 -*-
"""Valida drive-links.json y muestra URLs finales."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
from _rollup import resolve_links_map, extract_drive_file_id

cfg_path = ROOT / "drive-links.json"
if not cfg_path.exists():
    print("Falta drive-links.json")
    sys.exit(1)

cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
print("enabled:", cfg.get("enabled"))
print("folder:", cfg.get("folderId", "—"))
print()

links, modo, _ = resolve_links_map()
print("modo:", modo)
print()
for k, url in links.items():
    raw = (cfg.get("modules") or {}).get(k, "")
    fid = extract_drive_file_id(raw)
    ok = "OK" if fid or modo == "local" else "FALTA ID"
    print(f"  [{ok}] {k}")
    print(f"       {url[:90]}{'…' if len(url) > 90 else ''}")

if cfg.get("enabled"):
    missing = [k for k, v in (cfg.get("modules") or {}).items()
               if k != "control_directivo" and not extract_drive_file_id(v)]
    if missing:
        print()
        print("Completá IDs en modules:", ", ".join(missing))
        print("Luego: python _rollup.py && python build.py")
        sys.exit(1)
    print()
    print("Listo. Ejecutá: python _rollup.py && python build.py")
    print("Subí reporting-general/index.html a Drive (reemplazar).")
