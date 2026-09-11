# -*- coding: utf-8 -*-
import csv, re, json
from collections import defaultdict, Counter
from datetime import datetime
from pathlib import Path

path = Path(r"C:\Users\Mauro\Downloads\DATOS.CSV")
raw = path.read_text(encoding="latin-1")
rows = list(csv.DictReader(raw.splitlines()))
print("n", len(rows))
print("cols", list(rows[0].keys()) if rows else None)

def parse_comp(s):
    s = (s or "").strip()
    m_id = re.search(r"Id\.\s*(\d+)", s)
    tipo = "OTRO"
    if "Nota de Crédito" in s or "Nota de Credito" in s:
        tipo = "NC"
    elif "Nota de Débito" in s or "Nota de Debito" in s:
        tipo = "ND"
    elif "Factura" in s:
        tipo = "FC"
    m_let = re.search(r"\|([A-E])\|", s)
    letra = m_let.group(1) if m_let else ""
    m_n = re.search(r"N[°º]\s*(\d+)-(\d+)", s)
    pto = m_n.group(1) if m_n else ""
    nro = m_n.group(2) if m_n else ""
    return {"id": m_id.group(1) if m_id else "", "tipo": tipo, "letra": letra, "pto": pto, "nro": nro}

tipos = Counter()
letras = Counter()
fechas = []
dest = defaultdict(lambda: {"n": 0, "fc": 0, "nc": 0, "nd": 0, "imp_fc": 0.0, "imp_nc": 0.0, "imp_nd": 0.0})
diario = defaultdict(lambda: {"n": 0, "fc": 0, "nc": 0, "imp_fc": 0.0, "imp_nc": 0.0, "imp_nd": 0.0})
mensual = defaultdict(lambda: {"n": 0, "fc": 0, "nc": 0, "imp_fc": 0.0, "imp_nc": 0.0, "imp_nd": 0.0})
ptos = Counter()
docs = []
for r in rows:
    c = parse_comp(r.get("_comprobant", ""))
    tipos[c["tipo"]] += 1
    letras[(c["tipo"] + c["letra"]) or "?"] += 1
    ptos[c["pto"] or "?"] += 1
    d = datetime.strptime(r["_fech"].strip(), "%d/%m/%Y")
    fechas.append(d)
    ds = d.strftime("%Y-%m-%d")
    ym = d.strftime("%Y-%m")
    imp = float(r["_import"])
    cli = (r.get("_destinatari") or "").strip()
    dest[cli]["n"] += 1
    diario[ds]["n"] += 1
    mensual[ym]["n"] += 1
    rec = r.get("fecha_reg", "")
    item = {
        "id": c["id"], "tipo": c["tipo"], "letra": c["letra"], "pto": c["pto"], "nro": c["nro"],
        "fecha": ds, "cli": cli, "imp": round(imp, 2), "cae": (r.get("_ca") or "").strip(),
        "reg": rec.strip(), "raw": r["_comprobant"].strip()
    }
    docs.append(item)
    if c["tipo"] == "NC":
        dest[cli]["nc"] += 1
        dest[cli]["imp_nc"] += imp
        diario[ds]["nc"] += 1
        diario[ds]["imp_nc"] += imp
        mensual[ym]["nc"] += 1
        mensual[ym]["imp_nc"] += imp
    elif c["tipo"] == "ND":
        dest[cli]["nd"] += 1
        dest[cli]["imp_nd"] += imp
        diario[ds]["imp_nd"] += imp
        mensual[ym]["imp_nd"] += imp
    else:
        dest[cli]["fc"] += 1
        dest[cli]["imp_fc"] += imp
        diario[ds]["fc"] += 1
        diario[ds]["imp_fc"] += imp
        mensual[ym]["fc"] += 1
        mensual[ym]["imp_fc"] += imp

print("tipos", dict(tipos))
print("letras", dict(letras))
print("ptos", dict(ptos))
print("fecha min/max", min(fechas).date(), max(fechas).date())
print("n dest", len(dest))
tot_fc = sum(v["imp_fc"] for v in dest.values())
tot_nc = sum(v["imp_nc"] for v in dest.values())
tot_nd = sum(v["imp_nd"] for v in dest.values())
n_fc = sum(v["fc"] for v in dest.values())
n_nc = sum(v["nc"] for v in dest.values())
neto = tot_fc + tot_nd - tot_nc
print("tot fc", round(tot_fc, 2), "tot nc", round(tot_nc, 2), "tot nd", round(tot_nd, 2), "neto", round(neto, 2))
print("n fc", n_fc, "n nc", n_nc, "ticket medio fc", round(tot_fc / max(1, n_fc), 2))
print("TOP NETO")
top = sorted(dest.items(), key=lambda kv: kv[1]["imp_fc"] + kv[1]["imp_nd"] - kv[1]["imp_nc"], reverse=True)
for n, v in top[:20]:
    net = v["imp_fc"] + v["imp_nd"] - v["imp_nc"]
    print(" ", n[:55], "n=", v["n"], "netoM=", round(net / 1e6, 2), "fcM=", round(v["imp_fc"] / 1e6, 2), "ncM=", round(v["imp_nc"] / 1e6, 2))
print("CONCENTRACION top 5 / 10")
nets = [v["imp_fc"] + v["imp_nd"] - v["imp_nc"] for _, v in top]
print(" top5", round(sum(nets[:5]) / neto * 100, 1), "top10", round(sum(nets[:10]) / neto * 100, 1))
print("MENSUAL")
for m in sorted(mensual):
    v = mensual[m]
    print(m, "n", v["n"], "fc", v["fc"], "nc", v["nc"], "neto", round(v["imp_fc"] + v["imp_nd"] - v["imp_nc"], 2))
print("DIARIO n days", len(diario))
print("largest FC")
fcs = [d for d in docs if d["tipo"] == "FC"]
for d in sorted(fcs, key=lambda x: -x["imp"])[:8]:
    print(" ", d["imp"] / 1e6, d["fecha"], d["tipo"] + d["letra"], d["pto"] + "-" + d["nro"], d["cli"][:40])
print("NCs")
for d in [x for x in docs if x["tipo"] == "NC"]:
    print(" ", d["imp"] / 1e6, d["fecha"], d["cli"][:50], d["nro"])

out = Path(r"c:\APP\cronoapp\tools\facturas-electronicas\_docs.json")
out.write_text(json.dumps(docs, ensure_ascii=False), encoding="utf-8")
print("wrote", out, "docs", len(docs))
