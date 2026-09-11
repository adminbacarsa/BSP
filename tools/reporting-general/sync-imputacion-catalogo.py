# -*- coding: utf-8 -*-
"""
Sincroniza unidades-negocio.json con rubros/CC/cuentas detectados en los tableros.

Preserva unidadId ya definidos. Los ítems nuevos quedan con unidadId: null (PENDIENTE).

Uso:
  python sync-imputacion-catalogo.py
  python sync-imputacion-catalogo.py --write-html   # genera listado-imputacion.html
"""
import argparse
import json
import re
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TOOLS = ROOT.parent
CONFIG_PATH = ROOT / "unidades-negocio.json"
HTML_PATH = ROOT / "listado-imputacion.html"


def norm_key(s: str) -> str:
    s = (s or "").upper()
    for a, b in [
        ("Á", "A"), ("É", "E"), ("Í", "I"), ("Ó", "O"), ("Ú", "U"), ("Ñ", "N"),
    ]:
        s = s.replace(a, b)
    return re.sub(r"\s+", " ", s.strip())


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def scan_fuentes():
    ventas = load_json(TOOLS / "ventas-cobranzas" / "_docs.json")
    mob = load_json(TOOLS / "mano-de-obra" / "_docs.json")
    compras = load_json(TOOLS / "compras" / "_docs.json")

    out = {
        "ventas": defaultdict(float),
        "mob": defaultdict(float),
        "compras": defaultdict(float),
    }
    for d in ventas:
        if d.get("fam") == "venta":
            out["ventas"][d.get("cuenta") or "—"] += d["net"]
    for d in mob:
        out["mob"][d.get("ccNom") or "—"] += d.get("costo", 0)
    for d in compras:
        if d.get("tipo") != "RC":
            out["compras"][d.get("cta") or "—"] += d["total"]
    return out


def default_config():
    return {
        "version": 1,
        "actualizado": None,
        "unidades": [
            {
                "id": "transporte_caudales",
                "nombre": "Transporte de caudales",
                "color": "#38bdf8",
                "operativa": True,
            },
            {
                "id": "gruas",
                "nombre": "Grúas",
                "color": "#fbbf24",
                "operativa": True,
            },
            {
                "id": "seguridad",
                "nombre": "Seguridad privada",
                "color": "#34d399",
                "operativa": True,
            },
            {
                "id": "tesoreria_bpc",
                "nombre": "Tesorería BPC",
                "color": "#a78bfa",
                "operativa": True,
            },
            {
                "id": "corporativo",
                "nombre": "Corporativo y soporte",
                "color": "#64748b",
                "operativa": False,
                "nota": "Overhead / estructura — imputar explícitamente o prorratear",
            },
        ],
        "reglas": {
            "comprasSinMapear": "prorratear",
            "distribuirCorporativo": True,
            "criterioOverheadMob": "igual",
            "criterioOverheadCompras": "igual",
            "criterioOverheadVentas": "gasto_operativo",
            "mostrarCorporativoEnTablero": False,
            "mostrarSinAsignarEnTablero": True,
        },
        "imputaciones": [],
    }


def seed_imputaciones():
    """Asignación inicial acordada (Agosto 2026)."""
    rows = []
    mapping = [
        ("ventas", "INGRESOS POR SEGURIDAD PRIVADA", "seguridad"),
        ("ventas", "SERVICIOS TERCERIZADOS DE TESORERIA", "tesoreria_bpc"),
        ("ventas", "INGRESOS POR RECAUDACION", "transporte_caudales"),
        ("ventas", "ALQUILER CAJAS DE SEGURIDAD", "transporte_caudales"),
        ("ventas", "ING. POR SERVICIOS DE ATM", "transporte_caudales"),
        ("ventas", "INGRESOS POR TRASLADOS", "gruas"),
        ("ventas", "INGRESOS POR SERVICIOS", "gruas"),
        ("ventas", "INGRESOS POR T.E.P.", "gruas"),
        ("ventas", "OTROS INGRESOS", "corporativo"),
        ("mob", "SERVICIO DE SEGURIDAD PRIVADA - Personal Permanente", "seguridad"),
        ("mob", "SERVICIO DE SEGURIDAD PRIVADA - Eventuales Bacar", "seguridad"),
        ("mob", "SEGURIDAD PLANTA", "seguridad"),
        ("mob", "SERVICIOS DE TESORERIA TERCERIZADOS", "tesoreria_bpc"),
        ("mob", "TESORERIA", "tesoreria_bpc"),
        ("mob", "PROTECCION DE VALORES", "transporte_caudales"),
        ("mob", "GRUAS", "gruas"),
        ("mob", "ADMINISTRACIÓN CENTRAL", "corporativo"),
        ("mob", "ADMINISTRACION CENTRAL", "corporativo"),
        ("mob", "COMERCIAL", "corporativo"),
        ("mob", "SISTEMAS Y TECNOLOGIA", "corporativo"),
        ("mob", "CAPITAL HUMANO", "corporativo"),
        ("mob", "MANTENIMIENTO PLANTA", "corporativo"),
        ("mob", "BACAR GASTOS", "corporativo"),
        ("compras", "Gastos Taller", "gruas"),
        ("compras", "Combustibles y Lubricantes", "gruas"),
        ("compras", "Rodados", "gruas"),
        ("compras", "Repuestos y Reparaciones", "gruas"),
        ("compras", "Neumaticos", "gruas"),
        ("compras", "Servicios p/ Recontadoras  Sumadoras E Impresoras", "transporte_caudales"),
        ("compras", "Comisiones y Gtos. Bancarios", "transporte_caudales"),
        ("compras", "Uniformes", "seguridad"),
        ("compras", "Uniforme del Personal", "seguridad"),
        ("compras", "Seguros de Responsabilidad Civil", "seguridad"),
        ("compras", "Publicidad", "corporativo"),
        ("compras", "Carteles y Elementos Publicitarios", "corporativo"),
        ("compras", "Honorarios de Terceros", "corporativo"),
        ("compras", "Comunicaciones", "corporativo"),
        ("compras", "Alquiler de Planta", "corporativo"),
        ("compras", "Atencion al Personal", "corporativo"),
        ("compras", "Viaticos Bpc", "corporativo"),
    ]
    for tipo, label, uid in mapping:
        rows.append({"tipo": tipo, "label": label, "unidadId": uid, "nota": ""})
    return rows


def merge_catalog(cfg, fuentes):
    existing = {}
    for row in cfg.get("imputaciones", []):
        key = (row["tipo"], norm_key(row["label"]))
        existing[key] = row

    merged = []
    for tipo in ("ventas", "mob", "compras"):
        for label, monto in sorted(fuentes[tipo].items(), key=lambda x: -abs(x[1])):
            key = (tipo, norm_key(label))
            prev = existing.get(key)
            if prev:
                merged.append({
                    "tipo": tipo,
                    "label": label,
                    "unidadId": prev.get("unidadId"),
                    "nota": prev.get("nota") or "",
                    "montoRef": round(monto, 2),
                })
            else:
                merged.append({
                    "tipo": tipo,
                    "label": label,
                    "unidadId": None,
                    "nota": "PENDIENTE — definir unidadId",
                    "montoRef": round(monto, 2),
                })

    cfg["imputaciones"] = merged
    cfg["actualizado"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return cfg


def write_html(cfg):
    shell_path = ROOT / "listado-imputacion-shell.html"
    if not shell_path.exists():
        raise SystemExit("missing listado-imputacion-shell.html")
    payload = json.dumps(cfg, ensure_ascii=False, separators=(",", ":"))
    tpl = shell_path.read_text(encoding="utf-8")
    if "%%CFG%%" not in tpl:
        raise SystemExit("missing %%CFG%% in listado-imputacion-shell.html")
    out = tpl.replace("%%CFG%%", payload, 1)
    HTML_PATH.write_text(out, encoding="utf-8")
    print("wrote", HTML_PATH)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--write-html", action="store_true")
    args = parser.parse_args()

    fuentes = scan_fuentes()
    if CONFIG_PATH.exists():
        cfg = load_json(CONFIG_PATH)
    else:
        cfg = default_config()
        cfg["imputaciones"] = seed_imputaciones()

    cfg = merge_catalog(cfg, fuentes)
    CONFIG_PATH.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
    pend = sum(1 for r in cfg["imputaciones"] if not r.get("unidadId"))
    print(f"wrote {CONFIG_PATH} — {pend} pendientes de {len(cfg['imputaciones'])} ítems")

    if args.write_html:
        write_html(cfg)


if __name__ == "__main__":
    main()
