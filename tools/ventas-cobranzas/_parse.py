# -*- coding: utf-8 -*-
import json
import re
from pathlib import Path

import xlrd

ROOT = Path(__file__).resolve().parent
SRC = Path(r"\\192.168.0.57\Sistemas\reporte-272.xls")
if not SRC.exists():
    SRC = ROOT / "_source.xls"

CANAL = {
    "11101": "Caja",
    "11102": "Banco Provincia",
    "11103": "Banco Patagonia",
    "11112": "Banco Julio",
    "11118": "Compensación cuentas",
    "11209": "Cheques de terceros",
    "11201": "Cuentas a cobrar",
    "11407": "Retención IVA",
    "11408": "Retención IIBB",
    "11409": "Retención Ganancias",
    "11419": "Retención Comercio Ind.",
    "11425": "Retención SUSS",
    "12106": "Rodados",
}


def clean_cuenta(raw: str, cod: str) -> str:
    s = (raw or "").strip()
    s = re.sub(r"^\s*" + re.escape(cod) + r"\s*-+\s*", "", s)
    return re.sub(r"\s+", " ", s).strip() or cod


def norm_comp(s: str) -> str:
    s = (s or "").strip().upper()
    if "RECIBO" in s:
        return "RECIBO"
    if s.startswith("NC") or ("NOTA" in s and "CRED" in s):
        return "NC"
    if s.startswith("ND"):
        return "ND"
    if "FACTURA" in s:
        return "FC"
    return s or "OTRO"


def classify(tipo_c: str, tipo_comp: str, cod: str) -> str:
    tc = norm_comp(tipo_comp)
    if tipo_c == "BASE IMPONIBLE":
        return "venta"
    if tipo_c == "FORMAS DE PAGO":
        if cod == "11201":
            return "cxc_pago" if tc == "RECIBO" else "cxc_alta"
        return "cobro" if tc == "RECIBO" else "cobro_otro"
    if tipo_c in (
        "POSICION DE IVA",
        "INGRESOS BRUTOS",
        "IMPUESTO A LAS GANANCIAS",
        "COMERCIO E INDUSTRIA",
    ):
        return "impuesto"
    return "otro"


def net_for(fam: str, debe: float, haber: float) -> float:
    if fam == "venta":
        return haber - debe
    if fam in ("cobro", "cxc_alta", "impuesto"):
        return debe - haber if fam != "cxc_alta" else debe
    if fam == "cxc_pago":
        return haber
    return debe - haber


def parse_header(sh) -> dict:
    t0 = str(sh.cell_value(0, 1) or "")
    t1 = str(sh.cell_value(1, 1) or "")
    empresa = "Bacar"
    m = re.search(r"Empresa:\s*(.+)", t0, re.I)
    if m:
        empresa = m.group(1).strip()
    periodo = ""
    m = re.search(r"Del\s+(\d{2}/\d{2}/\d{4})\s+al\s+(\d{2}/\d{2}/\d{4})", t1, re.I)
    if m:
        periodo = f"{m.group(1)} al {m.group(2)}"
    reporte = "272"
    m = re.search(r"Reporte\s+N[°º]?\s*(\d+)", t0, re.I)
    if m:
        reporte = m.group(1)
    return {
        "empresa": empresa,
        "periodo": periodo,
        "reporte": reporte,
        "titulo": "Asiento de Ventas y Cobranzas",
    }


def main() -> None:
    wb = xlrd.open_workbook(str(SRC))
    sh = wb.sheet_by_index(0)
    meta = parse_header(sh)
    docs = []
    for r in range(6, sh.nrows):
        cod = str(sh.cell_value(r, 1)).strip()
        if not cod or cod == "Cód.Cuenta":
            continue
        debe = float(sh.cell_value(r, 2) or 0)
        haber = float(sh.cell_value(r, 3) or 0)
        saldo = float(sh.cell_value(r, 4) or 0)
        tipo_c = str(sh.cell_value(r, 5) or "").strip()
        tipo_comp = str(sh.cell_value(r, 6) or "").strip()
        cuenta_raw = str(sh.cell_value(r, 7) or "").strip()
        cuenta = clean_cuenta(cuenta_raw, cod)
        fam = classify(tipo_c, tipo_comp, cod)
        net = round(net_for(fam, debe, haber), 2)
        docs.append(
            {
                "i": r - 5,
                "cod": cod,
                "cuenta": cuenta,
                "debe": round(debe, 2),
                "haber": round(haber, 2),
                "saldo": round(saldo, 2),
                "tipoC": tipo_c,
                "tipoComp": tipo_comp,
                "comp": norm_comp(tipo_comp),
                "fam": fam,
                "net": net,
                "canal": CANAL.get(cod, cuenta if fam.startswith("cobro") or fam == "cxc_pago" else ""),
            }
        )

    meta["n"] = len(docs)
    meta["fuente"] = str(SRC)

    out_docs = ROOT / "_docs.json"
    out_meta = ROOT / "_meta.json"
    out_docs.write_text(json.dumps(docs, ensure_ascii=False), encoding="utf-8")
    out_meta.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    print("wrote", out_docs, "rows", len(docs))
    print("meta", meta)
    venta = sum(d["net"] for d in docs if d["fam"] == "venta")
    cobro = sum(d["net"] for d in docs if d["fam"] == "cobro")
    print("venta neto", round(venta, 2), "cobro liquido", round(cobro, 2))


if __name__ == "__main__":
    main()
