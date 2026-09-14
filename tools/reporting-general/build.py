# -*- coding: utf-8 -*-
import json
from pathlib import Path

root = Path(__file__).resolve().parent
rollup_path = root / "_rollup.json"
if not rollup_path.exists():
    raise SystemExit("missing _rollup.json — run python _rollup.py first")
rollup = json.loads(rollup_path.read_text(encoding="utf-8"))
payload = json.dumps(rollup, ensure_ascii=False, separators=(",", ":"))
tpl = (root / "shell.html").read_text(encoding="utf-8")
if "%%ROLLUP%%" not in tpl:
    raise SystemExit("missing %%ROLLUP%% in shell.html")
out = tpl.replace("%%ROLLUP%%", payload, 1)
(root / "index.html").write_text(out, encoding="utf-8")
print("wrote index.html", len(out), "bytes")
