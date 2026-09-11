# -*- coding: utf-8 -*-
"""Agrega KPIs y drill-down operativo de los tableros hijos en _rollup.json."""
import json
import re
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TOOLS = ROOT.parent


def load_json(path: Path):
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


LOCAL_LINKS = {
    "control_directivo": "index.html",
    "imputacion": "listado-imputacion.html",
    "ventas_cobranzas": "../ventas-cobranzas/index.html",
    "facturas": "../facturas-electronicas/index.html",
    "compras": "../compras/index.html",
    "mano_obra": "../mano-de-obra/index.html",
    "camioneros": "../novedades-camioneros/index.html",
}

FLAT_LINKS = {
    "control_directivo": "index.html",
    "imputacion": "listado-imputacion.html",
    "ventas_cobranzas": "ventas-cobranzas.html",
    "facturas": "facturas-electronicas.html",
    "compras": "compras.html",
    "mano_obra": "mano-de-obra.html",
    "camioneros": "camioneros.html",
}


def extract_drive_file_id(value: str):
    if not value:
        return None
    s = str(value).strip()
    m = re.search(r"/file/d/([a-zA-Z0-9_-]+)", s)
    if m:
        return m.group(1)
    m = re.search(r"[?&]id=([a-zA-Z0-9_-]+)", s)
    if m:
        return m.group(1)
    if re.fullmatch(r"[a-zA-Z0-9_-]{10,}", s):
        return s
    return None


def resolve_links_map():
    """Links: pack-config (flat Drive) > hosting > drive > local lab."""
    pack = load_json(ROOT / "pack-config.json") or {}
    if pack.get("mode") == "flat":
        links = {**FLAT_LINKS, **(pack.get("links") or {})}
        return links, "flat", None

    hosting = load_json(ROOT / "hosting-links.json") or {}
    if hosting.get("enabled"):
        modules = hosting.get("modules") or {}
        out = dict(LOCAL_LINKS)
        for key in LOCAL_LINKS:
            raw = str(modules.get(key) or "").strip()
            if raw.startswith("http"):
                out[key] = raw if raw.endswith("/") else raw + "/"
        return out, "hosting", hosting.get("base")

    cfg = load_json(ROOT / "drive-links.json") or {}
    if cfg.get("enabled"):
        template = cfg.get("previewUrl") or "https://drive.google.com/file/d/{fileId}/preview"
        modules = cfg.get("modules") or {}
        out = dict(LOCAL_LINKS)
        missing = []
        for key in LOCAL_LINKS:
            raw = modules.get(key, "")
            fid = extract_drive_file_id(raw)
            if fid:
                out[key] = template.replace("{fileId}", fid)
            elif key != "control_directivo":
                missing.append(key)
        if missing:
            print("WARN drive-links: sin ID para", ", ".join(missing))
        return out, "drive", cfg.get("folderId")

    return dict(LOCAL_LINKS), "local", None


def top_items(pairs, total, n=8, label_key=0, val_key=1):
    items = sorted(pairs, key=lambda x: abs(x[val_key] if isinstance(val_key, int) else x[1]), reverse=True)
    pos = [(k, v) for k, v in items if v > 0][:n]
    out = []
    for label, val in pos:
        out.append({
            "label": str(label)[:80],
            "valor": round(val, 2),
            "pct": round(val / total * 100, 2) if total else 0,
        })
    return out


def rollup_ventas(docs, meta):
    venta = sum(d["net"] for d in docs if d.get("fam") == "venta")
    fc = sum(d["net"] for d in docs if d.get("fam") == "venta" and d.get("comp") == "FC")
    nc = sum(d["net"] for d in docs if d.get("fam") == "venta" and d.get("comp") == "NC")
    nd = sum(d["net"] for d in docs if d.get("fam") == "venta" and d.get("comp") == "ND")
    cobro = sum(d["net"] for d in docs if d.get("fam") == "cobro")
    cxc_alta = sum(d["net"] for d in docs if d.get("fam") == "cxc_alta")
    cxc_pago = sum(d["net"] for d in docs if d.get("fam") == "cxc_pago")
    impuesto = sum(d["net"] for d in docs if d.get("fam") == "impuesto")

    by_rubro = defaultdict(float)
    by_canal = defaultdict(float)
    for d in docs:
        if d.get("fam") == "venta":
            by_rubro[d.get("cuenta") or d.get("cod") or "—"] += d["net"]
        if d.get("fam") == "cobro":
            by_canal[d.get("canal") or d.get("cuenta") or "—"] += d["net"]

    rubro_arr = top_items(list(by_rubro.items()), venta, 8)
    canal_arr = top_items(list(by_canal.items()), cobro, 8)
    top5_rubro = sum(x["valor"] for x in rubro_arr[:5])
    top5_canal = sum(x["valor"] for x in canal_arr[:5])

    return {
        "ventas": round(venta, 2),
        "fc": round(fc, 2),
        "nc": round(nc, 2),
        "nd": round(nd, 2),
        "cobranzas": round(cobro, 2),
        "cxcAlta": round(cxc_alta, 2),
        "cxcPago": round(cxc_pago, 2),
        "impuesto": round(impuesto, 2),
        "gapCobroVenta": round(cobro - venta, 2),
        "n": len(docs),
        "nRubros": len(by_rubro),
        "nCanales": len(by_canal),
        "topRubros": rubro_arr,
        "topCanales": canal_arr,
        "concTop5Rubros": round(top5_rubro / venta, 4) if venta else 0,
        "concTop5Canales": round(top5_canal / cobro, 4) if cobro else 0,
        "periodo": (meta or {}).get("periodo"),
        "tipoCorte": "efecto_contable",
        "fuente": (meta or {}).get("fuente"),
    }


def rollup_facturas(docs, desde="2026-08-01", hasta="2026-08-31"):
    subset = [d for d in docs if desde <= d.get("fecha", "") <= hasta]
    bruto = sum(d["imp"] for d in subset if d.get("tipo") != "NC")
    nc = sum(d["imp"] for d in subset if d.get("tipo") == "NC")
    n_fc = sum(1 for d in subset if d.get("tipo") != "NC")
    n_nc = sum(1 for d in subset if d.get("tipo") == "NC")
    neto = bruto - nc

    by_cli = defaultdict(lambda: {"bruto": 0.0, "nc": 0.0, "n": 0})
    by_day = defaultdict(lambda: {"bruto": 0.0, "nc": 0.0, "n": 0})
    by_letra = defaultdict(float)
    for d in subset:
        cli = d.get("cli") or "—"
        by_cli[cli]["n"] += 1
        day = d.get("fecha") or "—"
        by_day[day]["n"] += 1
        letra = d.get("letra") or "?"
        if d.get("tipo") == "NC":
            by_cli[cli]["nc"] += d["imp"]
            by_day[day]["nc"] += d["imp"]
        else:
            by_cli[cli]["bruto"] += d["imp"]
            by_day[day]["bruto"] += d["imp"]
            by_letra[letra] += d["imp"]

    cli_pairs = [(k, v["bruto"] - v["nc"]) for k, v in by_cli.items()]
    top_cli = top_items(cli_pairs, neto, 10)
    top5_cli = sum(x["valor"] for x in top_cli[:5])
    serie = []
    for day in sorted(by_day.keys()):
        v = by_day[day]
        serie.append({
            "fecha": day,
            "neto": round(v["bruto"] - v["nc"], 2),
            "n": v["n"],
        })

    return {
        "bruto": round(bruto, 2),
        "nc": round(nc, 2),
        "neto": round(neto, 2),
        "n": len(subset),
        "nFc": n_fc,
        "nNc": n_nc,
        "nClientes": len(by_cli),
        "ticket": round(bruto / n_fc, 2) if n_fc else 0,
        "topClientes": top_cli,
        "concTop5Clientes": round(top5_cli / neto, 4) if neto else 0,
        "serieDiaria": serie,
        "porLetra": top_items(list(by_letra.items()), bruto, 4),
        "periodoDesde": desde,
        "periodoHasta": hasta,
        "tipoCorte": "fecha_emision_cae",
        "fuente": "DATOS.CSV",
    }


def rollup_compras(docs):
    money = [d for d in docs if d.get("tipo") != "RC"]
    total = sum(d["total"] for d in money)
    bruto = sum(d["total"] for d in money if d.get("tipo") in ("FC", "ND"))
    nc = sum(-d["total"] for d in money if d.get("tipo") == "NC")
    neto = sum(d.get("neto", 0) for d in money)
    iva = sum(d.get("iva", 0) for d in money)

    by_prov = defaultdict(float)
    by_cta = defaultdict(float)
    for d in money:
        by_prov[d.get("prov") or "(sin proveedor)"] += d["total"]
        by_cta[d.get("cta") or "(sin cuenta)"] += d["total"]

    prov_arr = top_items(list(by_prov.items()), total, 10)
    cta_arr = top_items(list(by_cta.items()), total, 10)
    top5_prov = sum(x["valor"] for x in prov_arr[:5])

    return {
        "total": round(total, 2),
        "bruto": round(bruto, 2),
        "nc": round(nc, 2),
        "neto": round(neto, 2),
        "iva": round(iva, 2),
        "n": len(docs),
        "nComp": len({
            (d.get("tipo"), d.get("letra"), d.get("pto"), d.get("nro"), d.get("prov"))
            for d in money
        }),
        "nProv": len([p for p in by_prov if p != "(sin proveedor)"]),
        "nCta": len([c for c in by_cta if c != "(sin cuenta)"]),
        "topProveedores": prov_arr,
        "topCuentas": cta_arr,
        "concTop5Prov": round(top5_prov / total, 4) if total else 0,
        "periodo": "Agosto 2026",
        "tipoCorte": "fecha_imputacion_efecto",
        "fuente": "compras.CSV",
    }


def rollup_mano_obra(docs, meta):
    costo = sum(d.get("costo", 0) for d in docs)
    neto = sum(d.get("neto", 0) for d in docs)
    contrib = sum(d.get("contrib", 0) for d in docs)
    prov = sum(d.get("prov", 0) for d in docs)
    ex50 = sum(d.get("ex50", 0) for d in docs)
    ex100 = sum(d.get("ex100", 0) for d in docs)

    by_cc = defaultdict(float)
    by_sec = defaultdict(float)
    for d in docs:
        by_cc[d.get("ccNom") or str(d.get("cc") or "—")] += d.get("costo", 0)
        by_sec[d.get("sec") or "—"] += d.get("costo", 0)

    cc_arr = top_items(list(by_cc.items()), costo, 8)
    sec_arr = top_items(list(by_sec.items()), costo, 6)
    top5_cc = sum(x["valor"] for x in cc_arr[:5])

    return {
        "costo": round(costo, 2),
        "neto": round(neto, 2),
        "contrib": round(contrib, 2),
        "prov": round(prov, 2),
        "extras": round(ex50 + ex100, 2),
        "avgCosto": round(costo / len(docs), 2) if docs else 0,
        "avgNeto": round(neto / len(docs), 2) if docs else 0,
        "n": len(docs),
        "nCc": len(by_cc),
        "topCentros": cc_arr,
        "topSecciones": sec_arr,
        "concTop5Cc": round(top5_cc / costo, 4) if costo else 0,
        "periodo": (meta or {}).get("periodo"),
        "tipoCorte": "liquidacion_mensual",
        "fuente": (meta or {}).get("fuente"),
    }


def rollup_camioneros():
    path = TOOLS / "novedades-camioneros" / "index.html"
    if not path.exists():
        return None
    html = path.read_text(encoding="utf-8")
    m = re.search(r"const PEOPLE = (\[.*?\]);", html)
    if not m:
        return None
    people = json.loads(m.group(1))
    active = [p for p in people if p.get("dias", 0) > 0]
    hs_n = sum(p.get("hsN", 0) for p in people)
    h50 = sum(p.get("hs50", 0) for p in people)
    h100 = sum(p.get("hs100", 0) for p in people)
    reloj = sum(p.get("tot", 0) for p in people)
    ice = sum(p.get("eq", 0) for p in people)

    top_eq = sorted(
        [{"label": p.get("n") or p.get("l"), "valor": round(p.get("eq", 0), 2), "leg": p.get("l")} for p in people],
        key=lambda x: x["valor"],
        reverse=True,
    )[:8]
    for t in top_eq:
        t["pct"] = round(t["valor"] / ice * 100, 2) if ice else 0

    high_ot = sum(1 for p in people if p.get("extra", 0) >= 0.6 and p.get("tot", 0) > 80)
    over_200 = sum(1 for p in people if p.get("tot", 0) >= 200)
    lic_j = sum(p.get("licJ", 0) for p in people)

    return {
        "n": len(people),
        "nActivos": len(active),
        "hsNormales": round(hs_n, 2),
        "hs50": round(h50, 2),
        "hs100": round(h100, 2),
        "reloj": round(reloj, 2),
        "iceEq": round(ice, 2),
        "markup": round(ice / reloj, 4) if reloj else 0,
        "avgIce": round(ice / len(active), 2) if active else 0,
        "topChoferes": top_eq,
        "alertas": {
            "altoExtra": high_ot,
            "sobre200h": over_200,
            "licenciasJ": round(lic_j, 1),
        },
        "mix": {
            "normales": round(hs_n / reloj * 100, 1) if reloj else 0,
            "h50": round(h50 / reloj * 100, 1) if reloj else 0,
            "h100": round(h100 / reloj * 100, 1) if reloj else 0,
        },
        "periodo": "26/07/2026 al 25/08/2026",
        "tipoCorte": "cct_camioneros_26_25",
        "fuente": "Legajos Online CSV",
        "unidad": "horas",
    }


def build_sub_paneles(vc, fc, cp, mob, cam, links_map):
    return [
        {
            "id": "ventas_cobranzas",
            "titulo": "Ventas y cobranzas",
            "kicker": "Contabilidad · Reporte 272",
            "href": links_map["ventas_cobranzas"],
            "color": "#34d399",
            "kpis": [
                {"l": "Ventas netas", "v": vc["ventas"], "u": "$"},
                {"l": "Cobranzas", "v": vc["cobranzas"], "u": "$"},
                {"l": "Gap cobro−venta", "v": vc["gapCobroVenta"], "u": "$"},
                {"l": "Alta CxC", "v": vc["cxcAlta"], "u": "$"},
            ],
            "chartLabel": "Ventas por rubro",
            "chartTotal": vc["ventas"],
            "chartItems": vc["topRubros"],
            "secChartLabel": "Cobranzas por canal",
            "secChartTotal": vc["cobranzas"],
            "secChartItems": vc["topCanales"],
            "nota": f"{vc['nRubros']} rubros · {vc['nCanales']} canales · {vc['n']} renglones contables",
        },
        {
            "id": "facturas",
            "titulo": "Facturación electrónica",
            "kicker": "AFIP · CAE",
            "href": links_map["facturas"],
            "color": "#38bdf8",
            "kpis": [
                {"l": "Neto facturado", "v": fc["neto"], "u": "$"},
                {"l": "Bruto FC", "v": fc["bruto"], "u": "$"},
                {"l": "Notas de crédito", "v": fc["nc"], "u": "$"},
                {"l": "Ticket medio FC", "v": fc["ticket"], "u": "$"},
            ],
            "chartLabel": "Top clientes (% neto)",
            "chartTotal": fc["neto"],
            "chartItems": fc["topClientes"],
            "serie": fc["serieDiaria"],
            "nota": f"{fc['nClientes']} clientes · {fc['nFc']} FC · {fc['nNc']} NC",
        },
        {
            "id": "compras",
            "titulo": "Compras imputadas",
            "kicker": "Gastos · Fecha efecto",
            "href": links_map["compras"],
            "color": "#fbbf24",
            "kpis": [
                {"l": "Total imputado", "v": cp["total"], "u": "$"},
                {"l": "Bruto FC/ND", "v": cp["bruto"], "u": "$"},
                {"l": "NC", "v": cp["nc"], "u": "$"},
                {"l": "IVA crédito", "v": cp["iva"], "u": "$"},
            ],
            "chartLabel": "Top proveedores",
            "chartTotal": cp["total"],
            "chartItems": cp["topProveedores"],
            "secChartLabel": "Por cuenta contable",
            "secChartTotal": cp["total"],
            "secChartItems": cp["topCuentas"],
            "nota": f"{cp['nProv']} proveedores · {cp['nCta']} cuentas · {cp['nComp']} comprobantes",
        },
        {
            "id": "mano_obra",
            "titulo": "Costo laboral",
            "kicker": "Liquidación · Empleador",
            "href": links_map["mano_obra"],
            "color": "#fb7185",
            "kpis": [
                {"l": "Costo laboral", "v": mob["costo"], "u": "$"},
                {"l": "Neto a pagar", "v": mob["neto"], "u": "$"},
                {"l": "Contribuciones", "v": mob["contrib"], "u": "$"},
                {"l": "Extras ($)", "v": mob["extras"], "u": "$"},
            ],
            "chartLabel": "Por centro de costo",
            "chartTotal": mob["costo"],
            "chartItems": mob["topCentros"],
            "secChartLabel": "Por sección",
            "secChartTotal": mob["costo"],
            "secChartItems": mob["topSecciones"],
            "nota": f"{mob['n']} legajos · {mob['nCc']} centros · prom {mob['avgCosto']:,.0f} $/persona",
        },
        {
            "id": "camioneros",
            "titulo": "Transporte Camioneros",
            "kicker": "LOL · Horas ICE",
            "href": links_map["camioneros"],
            "color": "#a78bfa",
            "kpis": [
                {"l": "ICE equivalente", "v": cam["iceEq"], "u": "h"},
                {"l": "Horas reloj", "v": cam["reloj"], "u": "h"},
                {"l": "Markup ICE", "v": cam["markup"], "u": "x"},
                {"l": "Prom ICE/activo", "v": cam["avgIce"], "u": "h"},
            ],
            "chartLabel": "Top choferes (ICE)",
            "chartTotal": cam["iceEq"],
            "chartItems": cam["topChoferes"],
            "alertas": cam["alertas"],
            "mix": cam["mix"],
            "nota": f"{cam['nActivos']} activos de {cam['n']} · período {cam['periodo']}",
        } if cam else None,
    ]


def load_unidades_negocio_config():
    path = ROOT / "unidades-negocio.json"
    if not path.exists():
        return None
    return load_json(path)


def build_unidades_from_config(cfg):
    """Arma estructura de UN + índice label→unidad desde unidades-negocio.json."""
    unidades_meta = {u["id"]: u for u in cfg.get("unidades", [])}
    reglas = cfg.get("reglas") or {}
    idx = {"ventas": {}, "mob": {}, "compras": {}}
    for row in cfg.get("imputaciones", []):
        uid = row.get("unidadId")
        if not uid:
            continue
        tipo = row.get("tipo")
        if tipo not in idx:
            continue
        idx[tipo][norm_key(row.get("label") or "")] = uid

    unidades = []
    for uid, meta in unidades_meta.items():
        unidades.append({
            "id": uid,
            "nombre": meta.get("nombre") or uid,
            "color": meta.get("color") or "#64748b",
            "operativa": meta.get("operativa", True),
            "ventasRubros": [r["label"] for r in cfg.get("imputaciones", [])
                             if r.get("tipo") == "ventas" and r.get("unidadId") == uid],
            "mobCc": [r["label"] for r in cfg.get("imputaciones", [])
                      if r.get("tipo") == "mob" and r.get("unidadId") == uid],
            "comprasCta": [r["label"] for r in cfg.get("imputaciones", [])
                           if r.get("tipo") == "compras" and r.get("unidadId") == uid],
        })
    return unidades, idx, reglas


UNIDADES_NEGOCIO_FALLBACK = [
    {
        "id": "transporte_caudales",
        "nombre": "Transporte de caudales",
        "color": "#38bdf8",
        "ventasRubros": [
            "INGRESOS POR RECAUDACION",
            "ING. POR SERVICIOS DE ATM",
            "ALQUILER CAJAS DE SEGURIDAD",
        ],
        "mobCc": [
            "PROTECCION DE VALORES",
        ],
        "comprasCta": [
            "Servicios p/ Recontadoras  Sumadoras E Impresoras",
            "Comisiones y Gtos. Bancarios",
        ],
    },
    {
        "id": "gruas",
        "nombre": "Grúas",
        "color": "#fbbf24",
        "ventasRubros": [
            "INGRESOS POR TRASLADOS",
            "INGRESOS POR SERVICIOS",
            "INGRESOS POR T.E.P.",
        ],
        "mobCc": ["GRUAS"],
        "comprasCta": [
            "Gastos Taller",
            "Combustibles y Lubricantes",
            "Rodados",
            "Repuestos y Reparaciones",
            "Neumaticos",
        ],
    },
    {
        "id": "seguridad",
        "nombre": "Seguridad privada",
        "color": "#34d399",
        "ventasRubros": [
            "INGRESOS POR SEGURIDAD PRIVADA",
        ],
        "mobCc": [
            "SERVICIO DE SEGURIDAD PRIVADA - Personal Permanente",
            "SERVICIO DE SEGURIDAD PRIVADA - Eventuales Bacar",
            "SEGURIDAD PLANTA",
        ],
        "comprasCta": ["Uniformes", "Seguros de Responsabilidad Civil"],
    },
    {
        "id": "tesoreria_bpc",
        "nombre": "Tesorería BPC",
        "color": "#a78bfa",
        "ventasRubros": [
            "SERVICIOS TERCERIZADOS DE TESORERIA",
        ],
        "mobCc": [
            "SERVICIOS DE TESORERIA TERCERIZADOS",
            "TESORERIA",
        ],
        "comprasCta": [],
    },
    {
        "id": "corporativo",
        "nombre": "Corporativo y soporte",
        "color": "#64748b",
        "ventasRubros": ["OTROS INGRESOS"],
        "mobCc": [
            "ADMINISTRACION CENTRAL",
            "COMERCIAL",
            "SISTEMAS Y TECNOLOGIA",
            "CAPITAL HUMANO",
            "MANTENIMIENTO PLANTA",
            "BACAR GASTOS",
        ],
        "comprasCta": [
            "Publicidad",
            "Carteles y Elementos Publicitarios",
            "Honorarios de Terceros",
            "Comunicaciones",
            "Alquiler de Planta",
            "Atencion al Personal",
            "Viaticos Bpc",
        ],
    },
]


def get_unidades_negocio():
    cfg = load_unidades_negocio_config()
    if cfg:
        return build_unidades_from_config(cfg)
    unidades = UNIDADES_NEGOCIO_FALLBACK
    idx = {"ventas": {}, "mob": {}, "compras": {}}
    for un in unidades:
        for label in un.get("ventasRubros") or []:
            idx["ventas"][norm_key(label)] = un["id"]
        for label in un.get("mobCc") or []:
            idx["mob"][norm_key(label)] = un["id"]
        for label in un.get("comprasCta") or []:
            idx["compras"][norm_key(label)] = un["id"]
    return unidades, idx, {}


def norm_key(s: str) -> str:
    s = (s or "").upper()
    for a, b in [
        ("Á", "A"), ("É", "E"), ("Í", "I"), ("Ó", "O"), ("Ú", "U"), ("Ñ", "N"),
    ]:
        s = s.replace(a, b)
    return re.sub(r"\s+", " ", s.strip())


def match_list(key: str, patterns: list) -> bool:
    nk = norm_key(key)
    for p in patterns:
        np = norm_key(p)
        if nk == np or np in nk or nk in np:
            return True
    return False


def resolve_unidad_id(tipo: str, label: str, idx: dict):
    nk = norm_key(label)
    return idx.get(tipo, {}).get(nk)


def _pesos_overhead_operativas(operativas, criterio: str, pesos_fijos: dict | None = None) -> dict:
    """Peso de prorrateo por UN operativa."""
    ids = [u["id"] for u in operativas]
    n = len(operativas)
    if n == 0:
        return {}

    def mob(u):
        return max(u.get("mobDirecto", u.get("mob", 0)), 0)

    def compras(u):
        return max(u.get("comprasDirectas", 0), 0)

    def ventas(u):
        return max(u.get("ventas", 0), 0)

    def gasto_op(u):
        return mob(u) + compras(u)

    if criterio == "fijo":
        if not pesos_fijos:
            return _pesos_overhead_operativas(operativas, "igual")
        raw = {u["id"]: max(float(pesos_fijos.get(u["id"], 0) or 0), 0.0) for u in operativas}
        total = sum(raw.values())
        if total <= 0:
            w = 1.0 / n
            return {uid: w for uid in ids}
        return {uid: raw[uid] / total for uid in ids}

    if criterio == "igual":
        w = 1.0 / n
        return {uid: w for uid in ids}

    if criterio == "mixto":
        pesos_mob = _pesos_overhead_operativas(operativas, "mob")
        pesos_eq = _pesos_overhead_operativas(operativas, "igual")
        return {
            uid: 0.5 * pesos_mob.get(uid, 0) + 0.5 * pesos_eq.get(uid, 0)
            for uid in ids
        }

    metric_fn = {
        "mob": mob,
        "compras": compras,
        "ventas": ventas,
        "gasto_operativo": gasto_op,
    }.get(criterio, gasto_op)

    base = sum(metric_fn(u) for u in operativas)
    if base <= 0:
        if criterio == "compras":
            return _pesos_overhead_operativas(operativas, "mob")
        if criterio != "ventas":
            return _pesos_overhead_operativas(operativas, "ventas")
        return {uid: 1.0 / n for uid in ids}

    return {u["id"]: metric_fn(u) / base for u in operativas}


def aplicar_distribucion_corporativo(unidades, pool, reglas):
    """Reparte MOB/compras/ventas de corporativo en UN operativas."""
    if not reglas.get("distribuirCorporativo"):
        return None
    operativas = [
        u for u in unidades
        if u.get("operativa") and u["id"] not in ("corporativo", "sin_asignar")
    ]
    if not operativas:
        return None

    criterio_mob = reglas.get("criterioOverheadMob", reglas.get("criterioOverhead", "mob"))
    criterio_compras = reglas.get(
        "criterioOverheadCompras",
        reglas.get("criterioOverhead", "mixto"),
    )
    pesos_fijos = reglas.get("pesosOverheadFijos") or {}
    pesos_mob = _pesos_overhead_operativas(operativas, criterio_mob, pesos_fijos)
    pesos_compras = _pesos_overhead_operativas(operativas, criterio_compras, pesos_fijos)
    if sum(pesos_mob.values()) <= 0 and sum(pesos_compras.values()) <= 0:
        return None

    label_map = {
        "gasto_operativo": "MOB + compras directas",
        "mob": "MOB directo",
        "compras": "compras directas",
        "ventas": "ventas",
        "mixto": "50% MOB + 50% partes iguales",
        "igual": "partes iguales",
        "fijo": "pesos fijos por cobertura operativa",
    }

    meta = {
        "mobTotal": round(pool["mob"], 2),
        "comprasTotal": round(pool["compras"], 2),
        "ventasTotal": round(pool["ventas"], 2),
        "criterioMob": criterio_mob,
        "criterioCompras": criterio_compras,
        "criterioLabel": f"MOB corp.: {label_map.get(criterio_mob, criterio_mob)} · Compras corp.: {label_map.get(criterio_compras, criterio_compras)}",
        "pesosMob": {u["id"]: round(pesos_mob.get(u["id"], 0), 4) for u in operativas},
        "pesosCompras": {u["id"]: round(pesos_compras.get(u["id"], 0), 4) for u in operativas},
        "detalleMob": pool.get("detalleMob", []),
        "detalleCompras": pool.get("detalleCompras", []),
    }

    for u in unidades:
        u.setdefault("mobDirecto", u["mob"])
        u.setdefault("mobOverhead", 0.0)
        u.setdefault("comprasOverheadCorp", 0.0)
        u.setdefault("ventasCorp", 0.0)

    criterio_ventas = reglas.get("criterioOverheadVentas", "gasto_operativo")
    pesos_ventas = _pesos_overhead_operativas(operativas, criterio_ventas, pesos_fijos)

    for u in operativas:
        wm = pesos_mob.get(u["id"], 0)
        wc = pesos_compras.get(u["id"], 0)
        wv = pesos_ventas.get(u["id"], 0)
        u["mobDirecto"] = u["mob"]
        u["mobOverhead"] = round(pool["mob"] * wm, 2)
        u["mob"] = round(u["mobDirecto"] + u["mobOverhead"], 2)
        u["comprasOverheadCorp"] = round(pool["compras"] * wc, 2)
        u["compras"] = round(u["comprasDirectas"] + u["comprasOverheadCorp"], 2)
        u["ventasCorp"] = round(pool["ventas"] * wv, 2)
        if u["ventasCorp"]:
            u["ventas"] = round(u["ventas"] + u["ventasCorp"], 2)
            u.setdefault("detalleVentas", []).append({
                "label": "Otros ingresos (overhead prorr.)",
                "valor": u["ventasCorp"],
            })
        u["margen"] = round(u["ventas"] - u["mob"] - u["compras"], 2)
        u["margenDirecto"] = round(
            u["ventas"] - u.get("ventasCorp", 0) - u["mobDirecto"] - u["comprasDirectas"],
            2,
        )
        u["margenPct"] = round(u["margen"] / u["ventas"], 4) if u["ventas"] else None
        u["margenDirectoPct"] = round(u["margenDirecto"] / u["ventas"], 4) if u["ventas"] else None
        u["mobPct"] = round(u["mob"] / u["ventas"], 4) if u["ventas"] else None

    return meta


def _finalizar_pl_unidades(unidades):
    """Separa MOB/compras asignadas vs gasto corporativo prorrateado."""
    for u in unidades:
        mob_dir = u.get("mobDirecto", u.get("mob", 0))
        mob_oh = u.get("mobOverhead", 0)
        comp_dir = u.get("comprasDirectas", u.get("compras", 0))
        comp_prorr = u.get("comprasProrrateo", 0)
        comp_corp = u.get("comprasOverheadCorp", 0)
        u["mobOperativo"] = round(mob_dir, 2)
        u["comprasAsignadas"] = round(comp_dir, 2)
        u["comprasOperativas"] = round(comp_dir + comp_prorr, 2)
        u["gastosPropios"] = round(mob_dir + comp_dir + comp_prorr, 2)
        u["gastoCorporativo"] = round(mob_oh + comp_corp, 2)
        u["costoCorporativo"] = u["gastoCorporativo"]
        if "mobDirecto" not in u:
            u["mobDirecto"] = round(mob_dir, 2)
        if "mobOverhead" not in u:
            u["mobOverhead"] = round(mob_oh, 2)
        if "comprasOverheadCorp" not in u:
            u["comprasOverheadCorp"] = round(comp_corp, 2)


def rollup_unidades_negocio(ventas_docs, mob_docs, compras_docs, cam, total_compras):
    unidades_def, idx, reglas = get_unidades_negocio()

    ventas_by_rubro = defaultdict(float)
    for d in ventas_docs:
        if d.get("fam") == "venta":
            ventas_by_rubro[d.get("cuenta") or "—"] += d["net"]

    mob_by_cc = defaultdict(float)
    for d in mob_docs:
        mob_by_cc[d.get("ccNom") or "—"] += d.get("costo", 0)

    compras_by_cta = defaultdict(float)
    money = [d for d in compras_docs if d.get("tipo") != "RC"]
    for d in money:
        compras_by_cta[d.get("cta") or "—"] += d["total"]

    buckets = {}
    for un in unidades_def:
        buckets[un["id"]] = {
            "meta": un,
            "ventas": 0.0,
            "mob": 0.0,
            "compras": 0.0,
            "detalleVentas": [],
            "detalleMob": [],
            "detalleCompras": [],
        }

    sin_ventas_rubros = set()
    sin_mob_cc = set()
    sin_compras_cta = set()

    for rub, val in ventas_by_rubro.items():
        uid = resolve_unidad_id("ventas", rub, idx)
        if uid and uid in buckets:
            b = buckets[uid]
            b["ventas"] += val
            b["detalleVentas"].append({"label": rub, "valor": round(val, 2)})
        else:
            sin_ventas_rubros.add(rub)

    for cc, val in mob_by_cc.items():
        uid = resolve_unidad_id("mob", cc, idx)
        if uid and uid in buckets:
            b = buckets[uid]
            b["mob"] += val
            b["detalleMob"].append({"label": cc, "valor": round(val, 2)})
        else:
            sin_mob_cc.add(cc)

    for cta, val in compras_by_cta.items():
        uid = resolve_unidad_id("compras", cta, idx)
        if uid and uid in buckets:
            b = buckets[uid]
            b["compras"] += val
            b["detalleCompras"].append({"label": cta, "valor": round(val, 2)})
        else:
            sin_compras_cta.add(cta)

    distribuir_corp = reglas.get("distribuirCorporativo", False)
    corp_pool = None
    if distribuir_corp and "corporativo" in buckets:
        cb = buckets["corporativo"]
        corp_pool = {
            "mob": cb["mob"],
            "compras": cb["compras"],
            "ventas": cb["ventas"],
            "detalleMob": list(cb["detalleMob"]),
            "detalleCompras": list(cb["detalleCompras"]),
        }

    unidades = []
    for un in unidades_def:
        if un["id"] == "corporativo" and (distribuir_corp or not reglas.get("mostrarCorporativoEnTablero", True)):
            continue
        b = buckets[un["id"]]
        compras_dir = b["compras"]
        margen = b["ventas"] - b["mob"] - compras_dir
        margen_dir = margen
        unidades.append({
            "id": un["id"],
            "nombre": un["nombre"],
            "color": un["color"],
            "operativa": un.get("operativa", True),
            "ventas": round(b["ventas"], 2),
            "mob": round(b["mob"], 2),
            "comprasDirectas": round(compras_dir, 2),
            "comprasProrrateo": 0.0,
            "compras": round(compras_dir, 2),
            "margen": round(margen, 2),
            "margenDirecto": round(margen_dir, 2),
            "margenPct": round(margen / b["ventas"], 4) if b["ventas"] else None,
            "margenDirectoPct": round(margen_dir / b["ventas"], 4) if b["ventas"] else None,
            "mobPct": round(b["mob"] / b["ventas"], 4) if b["ventas"] else None,
            "detalleVentas": sorted(b["detalleVentas"], key=lambda x: -x["valor"]),
            "detalleMob": sorted(b["detalleMob"], key=lambda x: -x["valor"]),
            "detalleCompras": sorted(b["detalleCompras"], key=lambda x: -x["valor"]),
        })

    overhead_meta = None
    if corp_pool:
        overhead_meta = aplicar_distribucion_corporativo(unidades, corp_pool, reglas)

    sin_ventas = sum(ventas_by_rubro[r] for r in sin_ventas_rubros)
    sin_mob = sum(mob_by_cc[c] for c in sin_mob_cc)
    compras_resto = sum(compras_by_cta[c] for c in sin_compras_cta)

    if reglas.get("comprasSinMapear", "prorratear") == "prorratear":
        dest = [
            u for u in unidades
            if u.get("operativa") and u["id"] not in ("corporativo", "sin_asignar")
        ] if distribuir_corp else unidades
        ventas_pos = sum(max(u["ventas"], 0) for u in dest)
        for u in dest:
            if ventas_pos > 0 and compras_resto > 0:
                prorr = compras_resto * (max(u["ventas"], 0) / ventas_pos)
                u["comprasProrrateo"] = round(prorr, 2)
                u["compras"] = round(
                    u["comprasDirectas"] + u.get("comprasOverheadCorp", 0) + prorr,
                    2,
                )
                u["margen"] = round(u["ventas"] - u["mob"] - u["compras"], 2)
                u["margenPct"] = round(u["margen"] / u["ventas"], 4) if u["ventas"] else None

    if (sin_ventas or sin_mob or (compras_resto and reglas.get("comprasSinMapear") == "sin_asignar")) and reglas.get("mostrarSinAsignarEnTablero", True):
        compras_sin = compras_resto if reglas.get("comprasSinMapear") == "sin_asignar" else 0
        unidades.append({
            "id": "sin_asignar",
            "nombre": "Sin imputar / ajustes",
            "color": "#94a3b8",
            "operativa": False,
            "ventas": round(sin_ventas, 2),
            "mob": round(sin_mob, 2),
            "comprasDirectas": round(compras_sin, 2),
            "comprasProrrateo": 0,
            "compras": round(compras_sin, 2),
            "margen": round(sin_ventas - sin_mob - compras_sin, 2),
            "margenPct": round((sin_ventas - sin_mob - compras_sin) / sin_ventas, 4) if sin_ventas else None,
            "mobPct": round(sin_mob / sin_ventas, 4) if sin_ventas else None,
            "detalleVentas": [{"label": r, "valor": round(ventas_by_rubro[r], 2)} for r in sorted(sin_ventas_rubros)],
            "detalleMob": [{"label": c, "valor": round(mob_by_cc[c], 2)} for c in sorted(sin_mob_cc)],
            "detalleCompras": [{"label": c, "valor": round(compras_by_cta[c], 2)} for c in sorted(sin_compras_cta)] if compras_sin else [],
        })

    _finalizar_pl_unidades(unidades)

    unidades.sort(key=lambda x: -x["ventas"])

    metodo_compras = (
        "Gastos propios = MOB directo + compras imputadas a la UN (sin corporativo). "
        "Corporativo se reparte aparte en Gasto corp."
    )
    oh_texto = None
    if distribuir_corp:
        pf = reglas.get("pesosOverheadFijos") or {}
        cm = reglas.get("criterioOverheadMob", "mob")
        cc = reglas.get("criterioOverheadCompras", "mixto")
        if cm == "fijo" or cc == "fijo":
            partes = []
            for un in unidades_def:
                if not un.get("operativa", True) or un["id"] in ("corporativo", "sin_asignar"):
                    continue
                p = pf.get(un["id"])
                if p is not None and float(p) > 0:
                    partes.append(f"{un['nombre']} {float(p):g}%")
            pesos_txt = " · ".join(partes) if partes else "pesos configurados"
            oh_texto = (
                "Gasto corporativo (MOB + compras de estructura) prorrateado por cobertura operativa: "
                f"{pesos_txt}. "
                "Compras y MOB directo = gastos propios de cada UN. "
                "Columna Gasto corp. — no se mezcla con Compras. "
                "El margen directo excluye Gasto corp."
            )
        else:
            oh_texto = (
                "Gasto corporativo = MOB estructura + compras admin/RRHH/sistemas prorrateados. "
                "Criterio MOB corp.: "
                f"{cm} · Compras corp.: {cc}. "
                "Columna Gasto corp. — separada de Compras imputadas."
            )
    return {
        "unidades": unidades,
        "overhead": overhead_meta,
        "metodo": {
            "ventas": "Rubro contable BASE IMPONIBLE (reporte 272)",
            "mob": "Centro de costo directo + overhead corporativo prorrateado" if distribuir_corp else "Centro de costo liquidación (int__costo_laboral)",
            "compras": metodo_compras,
            "facturas": "No imputadas por UN en esta versión (ver tablero Facturas)",
            "overhead": oh_texto if distribuir_corp else None,
        },
        "transporte": {
            "iceEq": cam.get("iceEq") if cam else None,
            "nota": "Camioneros en horas ICE — vinculado a transporte de caudales / recaudación",
        } if cam else None,
        "totales": {
            "ventas": round(sum(u["ventas"] for u in unidades), 2),
            "mob": round(sum(u["mob"] for u in unidades), 2),
            "compras": round(total_compras, 2),
        },
    }


def main():
    ventas_docs = load_json(TOOLS / "ventas-cobranzas" / "_docs.json") or []
    ventas_meta = load_json(TOOLS / "ventas-cobranzas" / "_meta.json") or {}
    facturas_docs = load_json(TOOLS / "facturas-electronicas" / "_docs.json") or []
    compras_docs = load_json(TOOLS / "compras" / "_docs.json") or []
    mob_docs = load_json(TOOLS / "mano-de-obra" / "_docs.json") or []
    mob_meta = load_json(TOOLS / "mano-de-obra" / "_meta.json") or {}

    vc = rollup_ventas(ventas_docs, ventas_meta)
    fc = rollup_facturas(facturas_docs)
    cp = rollup_compras(compras_docs)
    mob = rollup_mano_obra(mob_docs, mob_meta)
    cam = rollup_camioneros()

    ventas = vc["ventas"]
    mob_costo = mob["costo"]
    compras = cp["total"]
    margen = ventas - mob_costo - compras

    links_map, link_modo, drive_folder = resolve_links_map()

    sub_paneles = [p for p in build_sub_paneles(vc, fc, cp, mob, cam, links_map) if p]
    unidades = rollup_unidades_negocio(ventas_docs, mob_docs, compras_docs, cam, compras)

    rollup = {
        "titulo": "Control Directivo",
        "empresa": ventas_meta.get("empresa") or mob_meta.get("empresa") or "Bacar",
        "periodo": "Agosto 2026",
        "periodoDesde": fc["periodoDesde"],
        "periodoHasta": fc["periodoHasta"],
        "generado": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "modo": "estatico",
        "linkModo": link_modo,
        "driveFolderId": drive_folder,
        "navLinks": [
            {"id": k, "label": lbl, "href": links_map[k]}
            for k, lbl in [
                ("control_directivo", "Control Directivo"),
                ("ventas_cobranzas", "Ventas y cobranzas"),
                ("facturas", "Facturas"),
                ("compras", "Compras"),
                ("mano_obra", "Costo laboral"),
                ("camioneros", "Camioneros"),
                ("imputacion", "Editor UN"),
            ]
            if k in links_map
        ],
        "modulos": {
            "ventas_cobranzas": vc,
            "facturas": fc,
            "compras": cp,
            "mano_obra": mob,
            "camioneros": cam,
        },
        "pnl": {
            "ventasContables": ventas,
            "facturasNetas": fc["neto"],
            "cobranzas": vc["cobranzas"],
            "comprasImputadas": compras,
            "costoLaboral": mob_costo,
            "margenBrutoRef": round(margen, 2),
            "mobSobreVentas": round(mob_costo / ventas, 4) if ventas else 0,
            "comprasSobreVentas": round(compras / ventas, 4) if ventas else 0,
            "margenSobreVentas": round(margen / ventas, 4) if ventas else 0,
            "deltaFacturasVentas": round(fc["neto"] - ventas, 2),
        },
        "composicion": [
            {"label": "Costo laboral", "valor": mob_costo, "color": "#fb7185", "tipo": "costo"},
            {"label": "Compras", "valor": compras, "color": "#fbbf24", "tipo": "costo"},
            {"label": "Margen bruto ref.", "valor": margen, "color": "#6366f1", "tipo": "margen"},
        ],
        "ingresos": [
            {"label": "Ventas contables", "valor": ventas, "color": "#34d399"},
            {"label": "Facturas CAE", "valor": fc["neto"], "color": "#38bdf8"},
            {"label": "Cobranzas", "valor": vc["cobranzas"], "color": "#818cf8"},
        ],
        "indicadores": [
            {
                "id": "margen",
                "label": "Margen bruto ref.",
                "valor": margen,
                "fmt": "peso",
                "pct": margen / ventas if ventas else 0,
                "estado": "ok" if margen > 0 else "danger",
                "meta": "Referencia operativa",
            },
            {
                "id": "mob",
                "label": "MOB / ventas",
                "valor": mob_costo / ventas if ventas else 0,
                "fmt": "pct",
                "estado": "warn" if mob_costo / ventas > 0.6 else "ok",
                "meta": "Costo empleador sobre ingreso",
            },
            {
                "id": "cobranza",
                "label": "Cobranzas / ventas",
                "valor": vc["cobranzas"] / ventas if ventas else 0,
                "fmt": "pct",
                "estado": "info",
                "meta": "Liquidez del mes",
            },
            {
                "id": "conc_cli",
                "label": "Conc. top 5 clientes",
                "valor": fc["concTop5Clientes"],
                "fmt": "pct",
                "estado": "warn" if fc["concTop5Clientes"] > 0.5 else "ok",
                "meta": "Facturación AFIP",
            },
        ],
        "subPaneles": sub_paneles,
        "unidadesNegocio": unidades,
        "links": [
            {
                "id": "ventas_cobranzas",
                "label": "Ventas y cobranzas",
                "kicker": "Contabilidad",
                "href": links_map["ventas_cobranzas"],
                "kpi": fmt_m(vc["ventas"]),
                "kpiLabel": "Ventas netas",
            },
            {
                "id": "facturas",
                "label": "Facturas electrónicas",
                "kicker": "AFIP / CAE",
                "href": links_map["facturas"],
                "kpi": fmt_m(fc["neto"]),
                "kpiLabel": "Neto facturado",
            },
            {
                "id": "compras",
                "label": "Compras",
                "kicker": "Imputaciones",
                "href": links_map["compras"],
                "kpi": fmt_m(cp["total"]),
                "kpiLabel": "Total imputado",
            },
            {
                "id": "mano_obra",
                "label": "Costo laboral",
                "kicker": "Capital humano",
                "href": links_map["mano_obra"],
                "kpi": fmt_m(mob["costo"]),
                "kpiLabel": "Costo empleador",
            },
            {
                "id": "camioneros",
                "label": "Camioneros (ICE)",
                "kicker": "Transporte LOL",
                "href": links_map["camioneros"],
                "kpi": f"{cam['iceEq']:,.0f} h ICE" if cam else "—",
                "kpiLabel": "ICE equivalente",
            },
            {
                "id": "imputacion",
                "label": "Editor imputación UN",
                "kicker": "Parametrización",
                "href": links_map.get("imputacion", "listado-imputacion.html"),
                "kpi": "Dropdown",
                "kpiLabel": "Asignar rubros / MOB / compras",
            },
        ],
    }

    out = ROOT / "_rollup.json"
    out.write_text(json.dumps(rollup, ensure_ascii=False, indent=2), encoding="utf-8")
    print("wrote", out.name)
    print("Control Directivo · margen", rollup["pnl"]["margenBrutoRef"])


def fmt_m(n):
    if abs(n) >= 1e6:
        return f"$ {n / 1e6:.1f} M"
    return f"$ {n:,.0f}"


if __name__ == "__main__":
    main()
