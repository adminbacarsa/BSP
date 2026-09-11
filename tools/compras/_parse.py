# -*- coding: utf-8 -*-
import csv, json, re
from collections import Counter
from datetime import datetime
from pathlib import Path

src = Path(r"C:\Users\Mauro\Downloads\compras.CSV")
raw = src.read_bytes()
for enc in ("utf-8-sig", "utf-8", "latin-1", "cp1252"):
    try:
        text = raw.decode(enc)
        print("encoding", enc)
        break
    except UnicodeDecodeError:
        continue

lines = text.splitlines()
header = lines[0]
body = []
for line in lines[1:]:
    s = line.strip()
    if not s:
        continue
    parsed = next(csv.reader([s]))
    if len(parsed) == 1 and "," in parsed[0]:
        s = parsed[0]
    body.append(s)

rows = list(csv.DictReader([header] + body))
print("n", len(rows))

def num(x):
    s = (x or "").strip().replace(",", ".")
    return float(s) if s else 0.0

def parse_dt(s):
    s = (s or "").strip()
    if not s:
        return None
    return datetime.strptime(s.split()[0], "%d/%m/%Y")

def parse_comp(s):
    s = re.sub(r"\s+", " ", (s or "").strip())
    m = re.match(r"^([A-Z]{1,4})\s+([A-Z])\s+(\d+)-(\d+)$", s)
    if m:
        return {"tipo": m.group(1), "letra": m.group(2), "pto": m.group(3), "nro": m.group(4), "raw": s}
    m2 = re.match(r"^([A-Z]{1,4})\s+(\d+)-(\d+)$", s)
    if m2:
        return {"tipo": m2.group(1), "letra": "", "pto": m2.group(2), "nro": m2.group(3), "raw": s}
    return {"tipo": "OTRO", "letra": "", "pto": "", "nro": "", "raw": s}

docs = []
tipos = Counter()
for r in rows:
    c = parse_comp(r.get("tipo_comprobante", ""))
    tipos[c["tipo"]] += 1
    d = parse_dt(r["fecha"])
    e = parse_dt(r["fefecto"])
    if d is None:
        continue
    docs.append({
        "fecha": d.strftime("%Y-%m-%d"),
        "efecto": e.strftime("%Y-%m-%d") if e else "",
        "tipo": c["tipo"],
        "letra": c["letra"],
        "pto": c["pto"],
        "nro": c["nro"],
        "comp": c["raw"],
        "prov": (r.get("proveedor") or "").strip() or "(sin proveedor)",
        "cuit": re.sub(r"\D", "", r.get("cuit") or ""),
        "cta": (r.get("cuenta_principal") or "").strip() or "(sin cuenta)",
        "cat": (r.get("iva_a") or "").strip(),
        "alic": (r.get("alic") or "").strip(),
        "neto": round(num(r.get("neto")), 2),
        "cng": round(num(r.get("cng")), 2),
        "impint": round(num(r.get("impinternos")), 2),
        "iva": round(num(r.get("iva_b")), 2),
        "retiva": round(num(r.get("retperiva")), 2),
        "retiibb": round(num(r.get("retperiibb")), 2),
        "retmun": round(num(r.get("retpermun")), 2),
        "total": round(num(r.get("total")), 2),
    })

print("tipos", dict(tipos))
print("fecha", min(d["fecha"] for d in docs), max(d["fecha"] for d in docs))
print("efecto", min((d["efecto"] for d in docs if d["efecto"]), default=""), max((d["efecto"] for d in docs if d["efecto"]), default=""))
print("total", round(sum(d["total"] for d in docs), 2), "n prov", len({d["prov"] for d in docs}), "n cta", len({d["cta"] for d in docs}))

out = Path(__file__).with_name("_docs.json")
out.write_text(json.dumps(docs, ensure_ascii=False), encoding="utf-8")
print("wrote", out, "docs", len(docs))
