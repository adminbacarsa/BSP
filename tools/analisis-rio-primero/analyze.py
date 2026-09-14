#!/usr/bin/env python3
"""Análisis marcaciones vs plan vs facturación — casos hospitalarios (Agosto 2026)."""
from __future__ import annotations

import json
import re
import zipfile
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path

GENERADO = datetime.now().strftime("%Y-%m-%d %H:%M")

DIR = Path(__file__).parent
CASES = json.loads((DIR / "cases.json").read_text(encoding="utf-8"))
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
DIAS_MES = 31


def col_idx(ref: str) -> int:
    m = re.match(r"([A-Z]+)", ref)
    col = 0
    for c in m.group(1):
        col = col * 26 + (ord(c) - 64)
    return col - 1


def cell_val(c, sst: list[str]) -> str:
    t = c.attrib.get("t")
    if t == "s":
        v = c.find("m:v", NS)
        return sst[int(v.text)] if v is not None and v.text else ""
    if t == "inlineStr":
        is_el = c.find("m:is", NS)
        if is_el is not None:
            return "".join(x.text or "" for x in is_el.findall(".//m:t", NS))
    v = c.find("m:v", NS)
    return v.text if v is not None else ""


def parse_xlsx(path: Path) -> list[dict]:
    rows_out: list[dict] = []
    with zipfile.ZipFile(path) as z:
        sst: list[str] = []
        if "xl/sharedStrings.xml" in z.namelist():
            root = ET.fromstring(z.read("xl/sharedStrings.xml"))
            for si in root.findall("m:si", NS):
                sst.append("".join(t.text or "" for t in si.findall(".//m:t", NS)))
        root = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
        for row in root.findall("m:sheetData/m:row", NS):
            cells: dict[int, str] = {}
            for c in row.findall("m:c", NS):
                ref = c.attrib.get("r", "")
                cells[col_idx(ref)] = cell_val(c, sst)
            if not cells:
                continue
            maxc = max(cells)
            line = [str(cells.get(i, "")).strip() for i in range(maxc + 1)]
            if line[1:2] == ["Nombre"] or line[0] == "Reporte de Horas":
                continue
            if len(line) < 7 or not line[1]:
                continue
            nombre_raw = line[1]
            m2 = re.match(r"^(.+?)DNI:\s*(\d+)", nombre_raw)
            if m2:
                nombre, dni = m2.group(1).strip(), m2.group(2)
            else:
                compact = nombre_raw.replace(" ", "")
                m = re.match(r"^(.+?)DNI:(\d+)", compact)
                if not m:
                    continue
                raw_name = m.group(1)
                nombre = re.sub(r"([a-z])([A-Z])", r"\1 \2", raw_name)
                dni = m.group(2)

            def parse_fecha_hora(fecha: str, hora: str) -> datetime | None:
                fecha = fecha.strip()
                hora = hora.strip()
                for fmt_d in ("%a- %d-%m-%Y", "%a-%d-%m-%Y"):
                    try:
                        d = datetime.strptime(fecha, fmt_d)
                        break
                    except ValueError:
                        d = None
                if d is None:
                    # fallback: dd-mm-yyyy al final
                    parts = re.findall(r"\d+", fecha)
                    if len(parts) >= 3:
                        d = datetime(int(parts[2]), int(parts[1]), int(parts[0]))
                    else:
                        return None
                try:
                    t = datetime.strptime(hora, "%H:%M:%S")
                except ValueError:
                    return None
                return d.replace(hour=t.hour, minute=t.minute, second=t.second)

            entrada_dt = parse_fecha_hora(line[2], line[3])
            salida_dt = parse_fecha_hora(line[4], line[5])
            if not entrada_dt or not salida_dt:
                continue
            if salida_dt <= entrada_dt:
                salida_dt += timedelta(days=1)

            total_parts = line[6].split(":")
            if len(total_parts) == 2:
                hs = int(total_parts[0]) + int(total_parts[1]) / 60
            else:
                hs = (salida_dt - entrada_dt).total_seconds() / 3600

            rows_out.append({
                "nombre": nombre,
                "dni": dni,
                "entrada": entrada_dt.isoformat(),
                "salida": salida_dt.isoformat(),
                "horas": round(hs, 2),
                "ccosto": line[7] if len(line) > 7 else "",
            })
    return rows_out


def banda_turno(entrada: datetime) -> str:
    """M 05–13:59 · T 14–21:59 · N 22–04:59 (relevo nocturno incluye 22:xx)."""
    h = entrada.hour + entrada.minute / 60
    if h >= 22 or h < 5:
        return "N"
    if h >= 14:
        return "T"
    return "M"


HORAS_NOMINAL = 8.0
UMBRAL_OLVIDO_CIERRE = 10.0  # >10 h = olvidó fichar salida (ej. 23 h, 31 h)


def corregir_marcaciones(marcaciones: list[dict]) -> list[dict]:
    """Capa turnos anómalos a 8 h nominal (olvido de cierre o fichada vacía)."""
    correcciones: list[dict] = []
    for m in marcaciones:
        orig = float(m["horas"])
        m["horas_originales"] = round(orig, 2)
        m["corregido"] = False
        motivo = None
        if orig <= 0.1:
            m["horas"] = HORAS_NOMINAL
            motivo = "Fichada sin duración (0 h) → 8 h nominal del turno"
        elif orig > UMBRAL_OLVIDO_CIERRE:
            m["horas"] = HORAS_NOMINAL
            motivo = f"Olvidó cerrar turno ({orig:.2f} h registradas) → 8 h"
        if motivo:
            m["corregido"] = True
            m["motivo_correccion"] = motivo
            ent = datetime.fromisoformat(m["entrada"])
            correcciones.append({
                "fecha": ent.strftime("%Y-%m-%d"),
                "nombre": m["nombre"],
                "entrada": ent.strftime("%H:%M"),
                "salida": datetime.fromisoformat(m["salida"]).strftime("%H:%M"),
                "horas_originales": round(orig, 2),
                "horas_corregidas": HORAS_NOMINAL,
                "motivo": motivo,
                "banda": banda_turno(ent),
            })
    return correcciones


def plan_del_dia(cfg: dict, d: datetime) -> dict:
    if cfg.get("plan_mode") == "uniform":
        p = dict(cfg["plan_diario"])
        return p
    domingos = set(cfg.get("domingos") or [])
    if d.day in domingos or d.weekday() == 6:
        return dict(cfg["plan_dom"])
    return dict(cfg["plan_lun_sab"])


def analizar(marcaciones: list[dict], correcciones: list[dict], cfg: dict) -> dict:
    por_dia: dict[str, dict] = defaultdict(lambda: {
        "M": [], "T": [], "N": [], "guardias": set(), "horas": 0.0,
    })
    por_guardia: dict[str, dict] = defaultdict(lambda: {"turnos": 0, "horas": 0.0, "bandas": defaultdict(int)})

    for m in marcaciones:
        ent = datetime.fromisoformat(m["entrada"])
        dia = ent.strftime("%Y-%m-%d")
        banda = banda_turno(ent)
        por_dia[dia]["horas"] += m["horas"]
        por_dia[dia][banda].append({**m, "banda": banda})
        por_dia[dia]["guardias"].add(m["nombre"])
        g = por_guardia[m["nombre"]]
        g["turnos"] += 1
        g["horas"] += m["horas"]
        g["bandas"][banda] += 1
        g["dni"] = m["dni"]

    dias_orden = sorted(por_dia.keys())
    calendario = []
    incumplimientos = []
    hs_marcadas = 0.0
    hs_plan_esperadas = 0.0

    for dia_str in dias_orden:
        d = datetime.strptime(dia_str, "%Y-%m-%d")
        plan = plan_del_dia(cfg, d)
        dom = d.day in set(cfg.get("domingos") or []) or d.weekday() == 6
        pd = por_dia[dia_str]
        hs_marcadas += pd["horas"]
        hs_plan_esperadas += plan["hs_dia"]
        counts = {b: len(pd[b]) for b in ("M", "T", "N")}
        ok = all(counts[b] == plan[b] for b in ("M", "T", "N"))
        diffs = {b: counts[b] - plan[b] for b in ("M", "T", "N")}
        if not ok:
            incumplimientos.append({
                "fecha": dia_str,
                "dia_sem": ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"][d.weekday()],
                "domingo": dom,
                "plan": plan,
                "real": counts,
                "diffs": diffs,
                "horas_marcadas": round(pd["horas"], 2),
            })
        calendario.append({
            "fecha": dia_str,
            "dia": d.day,
            "domingo": dom,
            "plan_hs": plan["hs_dia"],
            "real_hs": round(pd["horas"], 2),
            "counts": counts,
            "plan_counts": {b: plan[b] for b in ("M", "T", "N")},
            "ok": ok,
        })

    # Agosto completo 1-31
    agosto_dias = [datetime(2026, 8, d) for d in range(1, 32)]
    dias_sin_marca = []
    for d in agosto_dias:
        ds = d.strftime("%Y-%m-%d")
        if ds not in por_dia:
            plan = plan_del_dia(cfg, d)
            hs_plan_esperadas += plan["hs_dia"] if ds not in dias_orden else 0
            dias_sin_marca.append(ds)

    hs_pdf = cfg.get("horas_plan_pdf") or hs_plan_esperadas

    anomalias = []
    validaciones = []
    hs_marcadas_corregidas = 0.0
    hs_marcadas_brutas = 0.0

    for m in marcaciones:
        ent = datetime.fromisoformat(m["entrada"])
        sal = datetime.fromisoformat(m["salida"])
        banda = banda_turno(ent)
        hs_marcadas_brutas += m.get("horas_originales", m["horas"])
        hs_marcadas_corregidas += m["horas"]
        issues = []

        if m.get("corregido"):
            issues.append(m.get("motivo_correccion", "Corregido a 8 h"))
        elif m["horas"] <= 0.1:
            issues.append("Marcación sin duración (entrada≈salida)")
            anomalias.append({**m, "banda": banda, "issues": issues, "fecha": ent.strftime("%Y-%m-%d")})

        if not m.get("corregido"):
            if banda == "M" and not (5 <= ent.hour <= 8):
                issues.append(f"Entrada M fuera de ventana 05-08 ({ent.strftime('%H:%M')})")
            if banda == "T" and not (13 <= ent.hour <= 16):
                issues.append(f"Entrada T fuera de ventana 14-16 ({ent.strftime('%H:%M')})")
            if banda == "N" and not (ent.hour >= 21 or ent.hour <= 1):
                issues.append(f"Entrada N fuera de ventana 22-01 ({ent.strftime('%H:%M')})")
            if 8.5 < m["horas"] <= UMBRAL_OLVIDO_CIERRE:
                issues.append(f"Jornada extendida ({m['horas']:.2f} h) — dentro de tolerancia")
        if issues and not any(v.get("fecha") == ent.strftime("%Y-%m-%d") and v.get("nombre") == m["nombre"] for v in validaciones):
            validaciones.append({
                "fecha": ent.strftime("%Y-%m-%d"),
                "nombre": m["nombre"],
                "banda": banda,
                "entrada": ent.strftime("%H:%M"),
                "salida": sal.strftime("%H:%M"),
                "horas": m["horas"],
                "horas_originales": m.get("horas_originales"),
                "corregido": m.get("corregido", False),
                "issues": issues,
            })

    hs_nominales = len(marcaciones) * HORAS_NOMINAL

    return {
        "meta": {
            "id": cfg["id"],
            "titulo": cfg["titulo"],
            "objetivo": cfg["objetivo"],
            "periodo": cfg["periodo"],
            "generado": GENERADO,
            "plan_leyenda": cfg.get("plan_leyenda", ""),
            "parametro_label": cfg.get("parametro_label", "Parámetro SLA"),
            "resumen": cfg.get("resumen", []),
            "facturacion": cfg.get("facturacion"),
        },
        "objetivo": cfg["objetivo"],
        "periodo": cfg["periodo"],
        "marcaciones": len(marcaciones),
        "guardias": [
            {"nombre": k, **v, "horas": round(v["horas"], 2),
             "bandas": dict(v["bandas"])} for k, v in sorted(por_guardia.items())
        ],
        "calendario": calendario,
        "incumplimientos": incumplimientos,
        "dias_sin_marca": dias_sin_marca,
        "validaciones": validaciones[:80],
        "correcciones": correcciones,
        "anomalias": anomalias,
        "totales": {
            "horas_marcadas_brutas": round(hs_marcadas_brutas, 2),
            "horas_marcadas": round(hs_marcadas_corregidas, 2),
            "horas_nominales_8h": round(hs_nominales, 2),
            "turnos_marcados": len(marcaciones),
            "turnos_corregidos": len(correcciones),
            "horas_plan_pdf": hs_pdf,
            "horas_facturadas": cfg["horas_facturadas"],
            "horas_teoricas_param": cfg["horas_teoricas_param"],
            "dias_con_marca": len(calendario),
            "dias_incompletos": len(incumplimientos),
        },
    }


def render_html(data: dict) -> str:
    j = json.dumps(data, ensure_ascii=False)
    meta = data.get("meta", {})
    titulo = meta.get("titulo", "Análisis cobertura")
    periodo = meta.get("periodo", "")
    return f"""<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>{titulo} — {periodo}</title>
<style>
  :root {{ --indigo:#4f46e5; --emerald:#10b981; --rose:#f43f5e; --amber:#f59e0b; --slate:#64748b; --bg:#0f172a; --card:#1e293b; --text:#e2e8f0; }}
  * {{ box-sizing:border-box; }}
  body {{ margin:0; font-family:Segoe UI,system-ui,sans-serif; background:linear-gradient(160deg,#0f172a,#1e1b4b); color:var(--text); padding:24px; line-height:1.5; }}
  h1 {{ font-size:1.75rem; margin:0 0 8px; }}
  .sub {{ color:#94a3b8; margin-bottom:24px; }}
  .grid {{ display:grid; gap:16px; }}
  .g4 {{ grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); }}
  .g2 {{ grid-template-columns:1fr 1fr; }}
  .card {{ background:var(--card); border-radius:20px; padding:20px; box-shadow:0 8px 32px rgba(0,0,0,.35); border:1px solid #334155; }}
  .card h2 {{ margin:0 0 12px; font-size:1.05rem; color:#cbd5e1; }}
  .kpi {{ font-size:1.8rem; font-weight:700; }}
  .kpi small {{ display:block; font-size:.75rem; color:#94a3b8; font-weight:500; margin-top:4px; }}
  .ok {{ color:var(--emerald); }}
  .warn {{ color:var(--amber); }}
  .bad {{ color:var(--rose); }}
  .callout {{ border-left:4px solid var(--indigo); background:#1e293b99; padding:14px 18px; border-radius:12px; margin-bottom:20px; }}
  table {{ width:100%; border-collapse:collapse; font-size:.85rem; }}
  th,td {{ padding:8px 10px; border-bottom:1px solid #334155; text-align:left; }}
  th {{ color:#94a3b8; font-weight:600; }}
  .num {{ text-align:right; font-variant-numeric:tabular-nums; }}
  .heat {{ display:grid; grid-template-columns:repeat(7,1fr); gap:6px; }}
  .day {{ border-radius:10px; padding:8px 4px; text-align:center; font-size:.72rem; min-height:72px; }}
  .day .n {{ font-weight:700; font-size:1rem; }}
  .bar-wrap {{ margin:12px 0; }}
  .bar-row {{ display:grid; grid-template-columns:140px 1fr 70px; gap:10px; align-items:center; margin:6px 0; font-size:.85rem; }}
  .bar {{ height:22px; border-radius:99px; background:#334155; overflow:hidden; }}
  .bar > i {{ display:block; height:100%; border-radius:99px; }}
  @media(max-width:900px) {{ .g2 {{ grid-template-columns:1fr; }} }}
</style>
</head>
<body>
<div id="app"></div>
<script>
const D = {j};
const fmt = n => n.toLocaleString('es-AR', {{maximumFractionDigits:1}}) + ' h';
const fmtN = n => n.toLocaleString('es-AR', {{maximumFractionDigits:0}});

function bar(label, val, max, color, isHs=true) {{
  const pct = max ? Math.min(100, val/max*100) : 0;
  const txt = isHs ? fmt(val) : fmtN(val);
  return `<div class="bar-row"><span>${{label}}</span><div class="bar"><i style="width:${{pct}}%;background:${{color}}"></i></div><span class="num">${{txt}}</span></div>`;
}}

function render() {{
  const t = D.totales;
  const M = D.meta || {{}};
  const comp = [
    {{ label: M.parametro_label || 'Parámetro SLA', val: t.horas_teoricas_param, c:'#6366f1' }},
    {{ label:'Facturado SLA', val:t.horas_facturadas, c:'#f59e0b' }},
    {{ label:'Plan operativo', val:t.horas_plan_pdf, c:'#10b981' }},
    {{ label:'Fichadas corregidas', val:t.horas_marcadas, c:'#38bdf8' }},
  ];
  const maxC = Math.max(...comp.map(x=>x.val));
  const resumenHtml = (M.resumen || []).map((p,i) => `${{i+1}}. ${{p}}`).join('<br>');
  const fac = M.facturacion;
  const brecha = t.horas_facturadas - t.horas_plan_pdf;
  const brechaCls = brecha === 0 ? 'ok' : (brecha > 0 ? 'warn' : 'bad');
  const brechaNota = brecha === 0 ? 'SLA = plan operativo' : (brecha > 0 ? 'SLA > plan operativo' : 'SLA < plan operativo');
  let facBlock = '';
  if (fac && fac.principal != null) {{
    facBlock = `<div class="card" style="margin-bottom:14px;border-color:#f59e0b">
      <h2>Desglose facturación vs plan operativo</h2>
      <div class="grid g4">
        <div><span class="muted">Principal</span><div class="kpi warn">${{fmtN(fac.principal)}}<small>teórico 3 vig: ${{fmtN(fac.principal_teorico)}} · gap interno ${{fmtN(fac.gap_principal)}} h</small></div></div>
        <div><span class="muted">Refuerzo</span><div class="kpi">${{fmtN(fac.refuerzo)}}<small>1 vig × 24 × 31</small></div></div>
        <div><span class="muted">Total facturado (SLA)</span><div class="kpi warn">${{fmtN(t.horas_facturadas)}}</div></div>
        <div><span class="muted">Brecha (SLA − operativo)</span><div class="kpi ${{brechaCls}}">${{fmtN(brecha)}}<small>${{brechaNota}} · plan ${{fmtN(t.horas_plan_pdf)}} h</small></div></div>
      </div>
      <p style="color:#94a3b8;font-size:.85rem;margin:12px 0 0">Fichadas corregidas: <b>${{fmt(t.horas_marcadas)}}</b> (referencia) · ${{t.turnos_corregidos}} turno(s) normalizados · bruto ${{fmt(t.horas_marcadas_brutas)}}</p>
    </div>`;
  }} else if (fac && fac.facturado != null) {{
    facBlock = `<div class="card" style="margin-bottom:14px;border-color:#f59e0b">
      <h2>Desglose facturación vs plan operativo</h2>
      <div class="grid g4">
        <div><span class="muted">Facturado SLA</span><div class="kpi warn">${{fmtN(t.horas_facturadas)}}<small>hs mes agosto</small></div></div>
        <div><span class="muted">Plan operativo</span><div class="kpi ok">${{fmtN(t.horas_plan_pdf)}}<small>${{M.plan_leyenda || ''}}</small></div></div>
        <div><span class="muted">Brecha (SLA − operativo)</span><div class="kpi ${{brechaCls}}">${{fmtN(brecha)}}<small>${{brechaNota}}</small></div></div>
        <div><span class="muted">Fichadas corregidas</span><div class="kpi">${{fmt(t.horas_marcadas)}}<small>referencia · ${{t.turnos_corregidos}} turnos norm.</small></div></div>
      </div>
    </div>`;
  }}

  const heat = D.calendario.map(d => {{
    const cls = d.ok ? 'ok' : 'bad';
    const bg = d.ok ? '#064e3b55' : '#7f1d1d55';
    return `<div class="day" style="background:${{bg}}"><div class="n">${{d.dia}}</div><div class="${{cls}}">${{d.counts.M}}M ${{d.counts.T}}T ${{d.counts.N}}N</div><div style="color:#94a3b8">${{d.real_hs}}h</div></div>`;
  }}).join('');

  const inc = D.incumplimientos.map(r => `<tr>
    <td>${{r.fecha}} (${{r.dia_sem}})</td>
    <td>${{r.plan.M}}M ${{r.plan.T}}T ${{r.plan.N}}N</td>
    <td>${{r.real.M}}M ${{r.real.T}}T ${{r.real.N}}N</td>
    <td class="num ${{r.diffs.M||r.diffs.T||r.diffs.N?'bad':''}}">${{Object.entries(r.diffs).map(([k,v])=>v?k+(v>0?'+':'')+v:'').filter(Boolean).join(' ')||'—'}}</td>
    <td class="num">${{r.horas_marcadas}} h</td>
  </tr>`).join('');

  const guards = D.guardias.map(g => `<tr>
    <td>${{g.nombre}}</td><td class="num">${{g.turnos}}</td><td class="num">${{g.horas}} h</td>
    <td>M:${{g.bandas.M||0}} T:${{g.bandas.T||0}} N:${{g.bandas.N||0}}</td>
  </tr>`).join('');

  const val = D.validaciones.slice(0,25).map(v => `<tr>
    <td>${{v.fecha}}</td><td>${{v.nombre.split(' ')[0]}}</td><td>${{v.banda}}</td>
    <td>${{v.entrada}}–${{v.salida}}</td><td class="num">${{v.horas}} h</td>
    <td class="warn">${{v.issues.join('; ')}}</td>
  </tr>`).join('');

  const corr = (D.correcciones||[]).map(v => `<tr>
    <td>${{v.fecha}}</td><td>${{v.nombre?.split(' ').slice(0,2).join(' ')||''}}</td><td>${{v.banda}}</td>
    <td>${{v.entrada}}–${{v.salida}}</td>
    <td class="num bad">${{v.horas_originales}} h</td>
    <td class="num ok">${{v.horas_corregidas}} h</td>
    <td class="warn">${{v.motivo}}</td>
  </tr>`).join('');

  const anom = (D.anomalias||[]).map(v => `<tr>
    <td>${{v.fecha||v.entrada?.slice(0,10)}}</td><td>${{v.nombre?.split(' ')[0]||''}}</td>
    <td class="bad">${{v.issues?.join('; ')||''}}</td><td class="num">${{v.horas}} h</td>
  </tr>`).join('');

  document.getElementById('app').innerHTML = `
    <h1>${{M.titulo || 'Análisis'}}</h1>
    <p class="sub">${{D.objetivo}} · ${{D.periodo}} · ${{D.marcaciones}} marcaciones · ${{D.guardias.length}} guardias · <span style="color:#64748b">v ${{M.generado || '?'}}</span></p>

    <div class="callout">
      <b>Resumen del caso</b><br>
      ${{resumenHtml}}<br><br>
      <b>Brecha (SLA − operativo):</b> <span class="${{brechaCls}}">${{fmtN(brecha)}} h</span> · Fichadas corregidas: ${{fmt(t.horas_marcadas)}} (${{t.turnos_corregidos}} turnos norm.)
    </div>
    ${{facBlock}}

    <div class="grid g4" style="margin-bottom:20px">
      <div class="card"><h2>Facturado SLA</h2><div class="kpi warn">${{fmtN(t.horas_facturadas)}}<small>hs mes</small></div></div>
      <div class="card"><h2>Plan operativo</h2><div class="kpi ok">${{fmtN(t.horas_plan_pdf)}}<small>${{M.plan_leyenda || ''}}</small></div></div>
      <div class="card"><h2>Fichadas corregidas</h2><div class="kpi ok">${{fmt(t.horas_marcadas)}}<small>${{t.turnos_corregidos}} turnos normalizados · bruto ${{fmt(t.horas_marcadas_brutas)}}</small></div></div>
      <div class="card"><h2>Parámetro / contrato</h2><div class="kpi bad">${{fmtN(t.horas_teoricas_param)}}<small>${{M.parametro_label || ''}}</small></div></div>
    </div>

    <div class="card" style="margin-bottom:20px">
      <h2>Comparativa de horas (conceptos)</h2>
      <div class="bar-wrap">${{comp.map(c=>bar(c.label,c.val,maxC,c.c)).join('')}}</div>
      <p style="color:#94a3b8;font-size:.85rem;margin:8px 0 0">
        Fichadas corregidas: ${{fmt(t.horas_marcadas)}} (bruto ${{fmt(t.horas_marcadas_brutas)}}).<br>
        <b>Brecha (SLA − operativo): ${{fmtN(brecha)}} h</b> — ${{brechaNota}}. Fichadas corregidas: ${{fmt(t.horas_marcadas)}} (referencia).
      </p>
    </div>

    <div class="card" style="margin-bottom:20px">
      <h2>Cobertura diaria (marcaciones) — M / T / N por día</h2>
      <p style="color:#94a3b8;font-size:.85rem">Verde = coincide plan · Rojo = desvío · Esperado: ${{M.plan_leyenda || 'ver plan operativo'}}</p>
      <div class="heat" style="margin-top:12px">${{heat}}</div>
      <p style="margin-top:10px;color:#94a3b8">${{t.dias_incompletos}} días con cobertura distinta al plan · ${{D.dias_sin_marca.length}} días sin ninguna marca en el export</p>
    </div>

    <div class="grid g2" style="margin-bottom:20px">
      <div class="card">
        <h2>Desvíos vs plan (${{D.incumplimientos.length}} días)</h2>
        <div style="overflow:auto;max-height:360px"><table>
          <thead><tr><th>Fecha</th><th>Plan</th><th>Real</th><th>Δ</th><th class="num">Hs</th></tr></thead>
          <tbody>${{inc || '<tr><td colspan=5>Sin desvíos</td></tr>'}}</tbody>
        </table></div>
      </div>
      <div class="card">
        <h2>Guardias — resumen</h2>
        <table><thead><tr><th>Nombre</th><th class="num">Turnos</th><th class="num">Horas</th><th>Bandas</th></tr></thead>
        <tbody>${{guards}}</tbody></table>
      </div>
    </div>

    <div class="card" style="margin-bottom:20px">
      <h2>Correcciones aplicadas (${{(D.correcciones||[]).length}}) — regla: máx. 8 h · si &gt;10 h o 0 h → 8 h nominal</h2>
      <p style="color:#94a3b8;font-size:.85rem">Turnos con olvido de cierre (ej. 23 h, 31 h) o fichada sin duración se normalizan a 8 h CCT para el análisis vs SLA.</p>
      <div style="overflow:auto"><table>
        <thead><tr><th>Fecha</th><th>Guardia</th><th>Banda</th><th>Horario fichado</th><th class="num">Hs brutas</th><th class="num">Hs usadas</th><th>Motivo</th></tr></thead>
        <tbody>${{corr || '<tr><td colspan=7>Sin correcciones</td></tr>'}}</tbody>
      </table></div>
    </div>

    <div class="card" style="margin-bottom:20px">
      <h2>Otras observaciones (${{(D.anomalias||[]).length}})</h2>
      <div style="overflow:auto"><table>
        <thead><tr><th>Fecha</th><th>Guardia</th><th>Problema</th><th class="num">Hs reportadas</th></tr></thead>
        <tbody>${{anom || '<tr><td colspan=4>Ninguna</td></tr>'}}</tbody>
      </table></div>
    </div>

    <div class="card">
      <h2>Validaciones horarias (entrada/salida vs banda 8 h)</h2>
      <p style="color:#94a3b8;font-size:.85rem">Ventanas: M 05–08 → 14h · T 14–16 → 23h · N 22–01 → 07h</p>
      <div style="overflow:auto;max-height:400px"><table>
        <thead><tr><th>Fecha</th><th>Guardia</th><th>Banda</th><th>Horario</th><th class="num">Hs</th><th>Observación</th></tr></thead>
        <tbody>${{val}}</tbody>
      </table></div>
    </div>
  `;
}}
render();
</script>
</body>
</html>"""


def run_case(case_id: str) -> tuple[dict, Path]:
    cfg = CASES[case_id]
    xlsx = Path(cfg["xlsx"])
    if not xlsx.exists():
        raise FileNotFoundError(f"No se encuentra export: {xlsx}")
    marcaciones = parse_xlsx(xlsx)
    correcciones = corregir_marcaciones(marcaciones)
    data = analizar(marcaciones, correcciones, cfg)
    out = DIR / cfg["out"]
    out.write_text(render_html(data), encoding="utf-8")
    return data, out


def render_index(reports: list[tuple[str, dict, Path]]) -> None:
    items = "\n".join(
        f'<a class="card" href="{p.name}" style="display:block;text-decoration:none;color:inherit;padding:20px">'
        f'<h2 style="margin:0 0 8px">{d["meta"]["titulo"]}</h2>'
        f'<p class="sub" style="margin:0">{d["objetivo"]} · {d["periodo"]}</p>'
        f'<p style="margin:12px 0 0;color:#94a3b8">Facturado {d["totales"]["horas_facturadas"]:,.0f} h · '
        f'Fichadas {d["totales"]["horas_marcadas"]:,.1f} h · Plan {d["totales"]["horas_plan_pdf"]:,.0f} h</p></a>'
        for _, d, p in reports
    )
    html = f"""<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"/>
<title>Análisis cobertura — Hospitales</title>
<style>
body{{font-family:Segoe UI,sans-serif;background:#0f172a;color:#e2e8f0;padding:32px;max-width:900px;margin:0 auto}}
h1{{margin-bottom:24px}} .grid{{display:grid;gap:16px}}
.card{{background:#1e293b;border-radius:20px;border:1px solid #334155;box-shadow:0 8px 24px rgba(0,0,0,.3)}}
.card:hover{{border-color:#6366f1}}
</style></head><body>
<h1>Análisis cobertura vs facturación</h1>
<p style="color:#94a3b8;margin-bottom:24px">Agosto 2026 — marcaciones corregidas (máx. 8 h si olvido cierre)</p>
<div class="grid">{items}</div>
</body></html>"""
    (DIR / "index.html").write_text(html, encoding="utf-8")


def main():
    reports = []
    for case_id in CASES:
        data, out = run_case(case_id)
        reports.append((case_id, data, out))
        print(f"\n=== {case_id} ===")
        print(json.dumps(data["totales"], indent=2, ensure_ascii=False))
        print(f"Informe: {out}")
    render_index(reports)
    print(f"\nÍndice: {DIR / 'index.html'}")


if __name__ == "__main__":
    main()
