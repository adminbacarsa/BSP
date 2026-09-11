# -*- coding: utf-8 -*-
import json
from pathlib import Path

root = Path(__file__).resolve().parent
docs = json.loads((root / "_docs.json").read_text(encoding="utf-8"))
meta = json.loads((root / "_meta.json").read_text(encoding="utf-8"))
payload = json.dumps(docs, ensure_ascii=False, separators=(",", ":"))
meta_payload = json.dumps(meta, ensure_ascii=False, separators=(",", ":"))
tpl = (root / "shell.html").read_text(encoding="utf-8")
if "%%DOCS%%" not in tpl or "%%META%%" not in tpl:
    raise SystemExit("missing %%DOCS%% or %%META%%")
out = tpl.replace("%%DOCS%%", payload, 1).replace("%%META%%", meta_payload, 1)
(root / "index.html").write_text(out, encoding="utf-8")
print("wrote index.html", len(out), "bytes", "docs", len(docs))
