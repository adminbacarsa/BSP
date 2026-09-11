# -*- coding: utf-8 -*-
import json
import re
from pathlib import Path

import xlrd

ROOT = Path(__file__).resolve().parent
SRC = Path(r"c:\Users\Mauro\Downloads\liquidacion.xls")
if not SRC.exists():
    SRC = ROOT / "_source.xls"

NUM_COLS = [
    "horas",
    "dias_trabajados_real",
    "sueldobasico",
    "total_remun",
    "total_no_remun",
    "total_descuen",
    "neto_a_pagar",
    "total_contrib",
    "total_prov",
    "int__costo_laboral",
    "horas_extras",
    "horasextrasal100",
    "horas_nocturnas",
    "nocturnidad",
    "feriados",
    "horas_feriado",
    "antiguedad",
    "presentismo",
    "contribart",
    "impuestoalasganan",
    "provision_sac",
    "remuneracion_variabl",
]


def clean_str(v) -> str:
    if v is None:
        return ""
    s = str(v).strip()
    if s.endswith(".0") and s[:-2].isdigit():
        s = s[:-2]
    return s


def clean_num(v) -> float:
    try:
        if v == "" or v is None:
            return 0.0
        return round(float(v), 2)
    except (TypeError, ValueError):
        return 0.0


def clean_leg(v) -> str:
    s = clean_str(v)
    if re.match(r"^\d+\.0$", s):
        return s[:-2]
    return s


def main() -> None:
    wb = xlrd.open_workbook(str(SRC), encoding_override="iso-8859-1")
    sh = wb.sheet_by_index(0)
    headers = [clean_str(sh.cell_value(0, c)) for c in range(sh.ncols)]
    idx = {h: i for i, h in enumerate(headers) if h}

    docs = []
    for r in range(1, sh.nrows):
        leg = clean_leg(sh.cell_value(r, idx.get("legajo", 0)))
        if not leg:
            continue
        rec = {
            "leg": leg,
            "legint": clean_leg(sh.cell_value(r, idx["legint"])) if "legint" in idx else "",
            "nombre": clean_str(sh.cell_value(r, idx["nombre"])) if "nombre" in idx else "",
            "cuil": clean_str(sh.cell_value(r, idx["cuil"])) if "cuil" in idx else "",
            "cc": clean_str(sh.cell_value(r, idx["ccosto"])) if "ccosto" in idx else "",
            "ccNom": clean_str(sh.cell_value(r, idx["d_ccosto"])) if "d_ccosto" in idx else "",
            "cat": clean_str(sh.cell_value(r, idx["d_categoria"])) if "d_categoria" in idx else "",
            "sec": clean_str(sh.cell_value(r, idx["d_seccion"])) if "d_seccion" in idx else "",
        }
        for col in NUM_COLS:
            key = {
                "int__costo_laboral": "costo",
                "horas_extras": "ex50",
                "horasextrasal100": "ex100",
                "horas_nocturnas": "hsNoct",
                "horas_feriado": "hsFeriado",
                "total_remun": "remun",
                "total_no_remun": "noRem",
                "total_descuen": "desc",
                "neto_a_pagar": "neto",
                "total_contrib": "contrib",
                "total_prov": "prov",
                "dias_trabajados_real": "dias",
                "remuneracion_variabl": "remVar",
                "provision_sac": "provSac",
                "impuestoalasganan": "ganancias",
            }.get(col, col)
            if col in idx:
                rec[key] = clean_num(sh.cell_value(r, idx[col]))
        docs.append(rec)

    meta = {
        "empresa": "Bacar",
        "periodo": "Agosto 2026",
        "titulo": "Liquidación de sueldos",
        "n": len(docs),
        "fuente": str(SRC),
        "campoCosto": "int__costo_laboral (costo empleador)",
    }

    (ROOT / "_docs.json").write_text(json.dumps(docs, ensure_ascii=False), encoding="utf-8")
    (ROOT / "_meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    costo = sum(d["costo"] for d in docs)
    neto = sum(d["neto"] for d in docs)
    print("wrote", len(docs), "legajos")
    print("costo laboral", round(costo, 2), "neto", round(neto, 2))


if __name__ == "__main__":
    main()
