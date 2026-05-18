import { operationalGuideForModuleKey } from './cospKnowledge';
import {
  ejecutarBuscarEmpleadosPorNombre,
  ejecutarConsultarTurnosEmpleado,
  ejecutarContarServiciosSlaVigentesEmpresa,
  ejecutarResumenHorasEmpleadoPeriodo,
  ejecutarListadoTurnosOperativosDia,
  ejecutarResumenHorasObjetivoSlaPeriodo,
  ejecutarResumenHorasSlaVariosObjetivos,
  ejecutarResumenHorasLiquidacionEmpresaPeriodo,
  ejecutarResumenPresenciasObjetivosDia,
  ejecutarListadoFrancoRetDia,
  ejecutarBuscarObjetivosPorNombre,
  ejecutarContarClientesEmpresa,
  ejecutarListarObjetivosCliente,
  ejecutarContarEmpleadosPlantillaEmpresa,
  formatListadoFrancoRetParaChat,
  canQueryClientsCrm,
  type AssistantToolContext,
} from './assistantDataTools';

export type AssistantRecentMessage = { role: 'user' | 'assistant'; content: string };

const SPANISH_MONTHS: Record<string, number> = {
  enero: 1,
  febrero: 2,
  marzo: 3,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto: 8,
  septiembre: 9,
  setiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

const SPANISH_MONTH_LABELS = [
  '',
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

function parseRefYmd(s: string): { y: number; m: number; d: number } {
  const rex = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s).trim());
  if (!rex) throw new Error('fecha_ref_invalida');
  return { y: Number(rex[1]), m: Number(rex[2]), d: Number(rex[3]) };
}

function monthRangeYsMmDd(year: number, month1to12: number): { desde: string; hasta: string; label: string } {
  const mm = String(month1to12).padStart(2, '0');
  const lastD = new Date(year, month1to12, 0).getDate();
  const dd = String(lastD).padStart(2, '0');
  const label = `${SPANISH_MONTH_LABELS[month1to12] ?? 'mes'} ${year}`;
  return { desde: `${year}-${mm}-01`, hasta: `${year}-${mm}-${dd}`, label };
}

function extractMonthRangeFromHoursQuery(t: string, refYmd: string): { desde: string; hasta: string; label: string } | null {
  let year: number;
  try {
    year = parseRefYmd(refYmd).y;
  } catch {
    return null;
  }
  const yMatch = t.match(/\b(20\d{2})\b/);
  if (yMatch) year = Number(yMatch[1]);

  for (const [name, mo] of Object.entries(SPANISH_MONTHS)) {
    if (new RegExp(`\\b${name}\\b`).test(t)) return monthRangeYsMmDd(year, mo);
  }

  const ref = parseRefYmd(refYmd);
  if (/\b(este mes|el mes actual|mes en curso|mes corriente)\b/.test(t)) {
    return monthRangeYsMmDd(ref.y, ref.m);
  }
  if (/\b(mes pasado|mes anterior)\b/.test(t)) {
    const d = new Date(ref.y, ref.m - 2, 1);
    return monthRangeYsMmDd(d.getFullYear(), d.getMonth() + 1);
  }

  const isoRange = t.match(/\b(20\d{2}-\d{2}-\d{2})\s*(?:a|hasta|al)\s*(20\d{2}-\d{2}-\d{2})\b/);
  if (isoRange) {
    return { desde: isoRange[1], hasta: isoRange[2], label: `${isoRange[1]} a ${isoRange[2]}` };
  }

  return null;
}

/** «hora» o «horas» (usuarios suelen escribir en singular). */
const RE_HORA = '\\bhoras?\\b';

/** Fragmentos que parecen nombre de legajo pero son conceptos de liquidación/reportes. */
function looksLikeEmployeeNameFragment(frag: string): boolean {
  const n = normText(frag);
  if (n.length < 3) return false;
  if (/^(horas?\s+)?(extras?|diurnas?|nocturnas?|reales?|teoricas?|liquidaci[oó]n|al\s*100|feriados?|bolsa|ft)\b/.test(n)) return false;
  if (/\b(extras?|diurnas?|nocturnas?|liquidaci[oó]n)\b/.test(n) && n.split(/\s+/).length <= 3) return false;
  return true;
}

function extractEmployeeNameFromHoursQuery(raw: string): string | null {
  const t = normText(raw);
  const monthNames = Object.keys(SPANISH_MONTHS).join('|');
  const periodTail = `(?:en|durante|para|del)\\s+(?:el\\s+)?(?:mes\\s+de\\s+)?(?:${monthNames}|este mes|mes actual|mes pasado|20\\d{2})`;

  let m = t.match(new RegExp(`${RE_HORA}.{0,24}\\b(?:de|del)\\s+(.+?)\\s+${periodTail}`));
  if (m?.[1] && looksLikeEmployeeNameFragment(m[1])) return m[1].trim();

  m = t.match(new RegExp(`\\b(?:cuantas|cuántas)\\s+horas?\\b.{0,32}\\b(?:de|del)\\s+(.+?)\\s+${periodTail}`));
  if (m?.[1] && looksLikeEmployeeNameFragment(m[1])) return m[1].trim();

  m = t.match(new RegExp(`${RE_HORA}.{0,16}\\b(?:trabaj|planific|fichad)\\w*\\s+(?:de\\s+)?(.+?)\\s+${periodTail}`));
  if (m?.[1] && looksLikeEmployeeNameFragment(m[1])) return m[1].trim();

  m = t.match(/\b(?:de|del)\s+([a-záéíóúñ][a-záéíóúñ\s]{2,40}?)\s+en\s+(?:el\s+)?(?:mes\s+de\s+)?(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/);
  if (m?.[1] && looksLikeEmployeeNameFragment(m[1])) return m[1].trim();

  m = t.match(new RegExp(`${RE_HORA}\\s+(?:de|del)\\s+([a-záéíóúñ][a-záéíóúñ\\s]{2,48})\\s+en\\s+(?:${monthNames})\\b`));
  if (m?.[1] && looksLikeEmployeeNameFragment(m[1])) return m[1].trim();

  m = t.match(
    new RegExp(`\\b(?:cuantas?|cuántas?)\\s+horas?\\s+trabaj\\w*\\s+([a-záéíóúñ][a-záéíóúñ\\s]{2,48}?)\\s+en\\s+(?:el\\s+)?(?:mes\\s+de\\s+)?(?:${monthNames})\\b`),
  );
  if (m?.[1] && looksLikeEmployeeNameFragment(m[1])) return m[1].trim();

  return null;
}

/** «detalle turnos de romina», o seguimiento sin nombre en el mensaje actual. */
function extractEmployeeNameFromTurnosDetailQuery(raw: string): string | null {
  const t = normText(raw);
  let m = t.match(
    /\b(?:detalle|listado|mostrar|mostrame|mostrá|ver|pasame|pasa)\b.{0,40}\b(?:de\s+)?(?:los\s+|las\s+)?turnos?\s+(?:de|del)\s+(.+)$/,
  );
  if (m?.[1] && looksLikeEmployeeNameFragment(m[1])) return m[1].trim();
  m = t.match(/\bturnos?\s+(?:de|del)\s+([a-záéíóúñ][a-záéíóúñ\s,]{2,48})$/);
  if (m?.[1] && looksLikeEmployeeNameFragment(m[1])) return m[1].trim();
  return null;
}

function extractEmployeeNameFromRecentMessages(recent: AssistantRecentMessage[]): string | null {
  for (let i = recent.length - 1; i >= 0 && i >= recent.length - 10; i--) {
    const c = recent[i].content || '';

    const encontre = c.match(/Encontr[eé]\s+a\s+\*\*([^*]+)\*\*/i);
    if (encontre?.[1] && looksLikeEmployeeNameFragment(encontre[1])) return encontre[1].trim();

    const boldMatches = c.match(/\*\*([^*]{3,64})\*\*/g);
    if (boldMatches) {
      for (const b of boldMatches) {
        const name = b.replace(/\*\*/g, '').trim();
        if (!looksLikeEmployeeNameFragment(name)) continue;
        if (/^(reportes|planificaci[oó]n|operaciones|firestore|servicios|rrhh|dashboard)$/i.test(name)) continue;
        if (name.split(/[\s,]+/).filter(Boolean).length >= 2 || /,/.test(name)) return name;
      }
    }

    if (recent[i].role === 'user') {
      const frag =
        extractEmployeeNameFromHoursQuery(c) ||
        extractEmployeeNameFromTurnosDetailQuery(c);
      if (frag) return frag;
    }
  }
  return null;
}

function matchEmployeeTurnosDetailIntent(t: string, recent: AssistantRecentMessage[]): boolean {
  if (!/\b(turnos?)\b/.test(t)) return false;
  const wantsDetail =
    /\b(detalle|listado|mostrar|mostrame|mostrá|ver|pasame|pasa|desglos|itemizado)\b/.test(t) ||
    /^(detalle|los turnos|el detalle)\b/.test(t.trim());
  if (!wantsDetail) return false;
  if (/\b(sla|servicio|contrato|liquidaci[oó]n)\b/.test(t) && !/\b(empleado|guardia|legajo|colaborador)\b/.test(t)) {
    return false;
  }
  if (extractEmployeeNameFromHoursQuery(t) || extractEmployeeNameFromTurnosDetailQuery(t)) return true;
  return !!extractEmployeeNameFromRecentMessages(recent);
}

function formatCordobaDayFromIso(iso: string | undefined): string {
  if (!iso) return '—';
  try {
    return new Intl.DateTimeFormat('es-AR', {
      timeZone: 'America/Argentina/Cordoba',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(new Date(iso));
  } catch {
    return String(iso).slice(0, 10);
  }
}

function formatTurnosDetailReply(nombre: string, rangeLabel: string, data: Record<string, unknown>): string {
  const turnos = (data.turnos ?? []) as Array<Record<string, unknown>>;
  const emp = data.empleado as { nombreLegible?: string } | undefined;
  const nom = String(emp?.nombreLegible ?? nombre).trim() || nombre;

  if (turnos.length === 0) {
    return `Según **Firestore**, **${nom}** no tiene turnos registrados en **${rangeLabel}** (rango consultado en colección **turnos**).`;
  }

  let body = `Detalle de turnos de **${nom}** en **${rangeLabel}** (${turnos.length} registro(s)):\n\n`;
  for (const row of turnos.slice(0, 22)) {
    const dia = formatCordobaDayFromIso(String(row.inicioUtc ?? ''));
    const cod = String(row.codigo ?? '—');
    const obj = String(row.objetivo ?? '—');
    const puesto = String(row.puesto ?? '').trim();
    const pres = String(row.resumen_presencia_para_usuario ?? '').replace(/_/g, ' ');
    body += `- **${dia}** · código **${cod}**`;
    if (puesto && puesto !== 'Sin Puesto') body += ` · puesto ${puesto}`;
    body += ` · ${obj}`;
    if (pres) body += ` · ${pres}`;
    if (row.borrador === true) body += ' · *borrador*';
    body += '\n';
  }
  if (turnos.length > 22) {
    body += `\n*… y ${turnos.length - 22} turno(s) más en el período (consulta limitada a 32 por respuesta rápida).*\n`;
  }
  const acl = String(data.aclaracion ?? '').trim();
  if (acl) body += `\n*Nota:* ${acl.replace(/_/g, ' ')}.\n`;
  return body.trim();
}

function matchLiquidacionEmpresaIntent(t: string): boolean {
  if (matchLiquidacionEmpresaIntentExcludeEmployee(t)) return false;
  if (/\b(diurna|nocturna|liquidaci|liquidar|extras?|al\s*100|100\s*%|ft\s+trabaj|franco\s+trabaj|bolsa|al\s*50|feriado)\b/.test(t)) {
    return true;
  }
  if (/\bhoras?\b/.test(t) && /\b(total|cantidad|cuantas|cuántas|empresa|plantilla|nomina|nómina)\b/.test(t)) {
    return true;
  }
  if (/\b(cantidad|total)\b/.test(t) && /\b(liquidar|liquidaci)\b/.test(t)) return true;
  return false;
}

/** Evita confundir «horas de Romina» con totales de empresa. */
function matchLiquidacionEmpresaIntentExcludeEmployee(t: string): boolean {
  if (!/\bhoras?\b/.test(t)) return false;
  const nameFrag = extractEmployeeNameFromHoursQuery(t);
  if (
    nameFrag &&
    nameFrag.length >= 3 &&
    looksLikeEmployeeNameFragment(nameFrag) &&
    !/\b(empresa|plantilla|total|todos)\b/.test(nameFrag)
  ) {
    return true;
  }
  return false;
}

function formatLiquidacionEmpresaReply(agg: Record<string, unknown>, rangeLabel: string): string {
  const trunc = agg.truncado_consulta_turnos === true;
  let body = `Según **Firestore** (turnos fichados, misma lógica que **Reportes y liquidación**) para **${rangeLabel}**:\n\n`;
  body += `- **Horas reales fichadas:** **${agg.hs_reales}** h (${agg.turnos_con_fichada} turnos con fichada, ${agg.empleados_con_fichada} legajos)\n`;
  body += `- **Horas teóricas planificadas:** **${agg.hs_teoricas}** h\n`;
  body += `- **Diurnas (sobre reales, 21:00–06:00 nocturnas):** **${agg.diurnas}** h\n`;
  body += `- **Nocturnas:** **${agg.nocturnas}** h\n`;
  body += `- **Al 100% (franco trabajado / FT):** **${agg.al_100_ft}** h (${agg.turnos_ft} turno(s) FT)\n`;
  body += `- **Plus feriado (reales en día feriado):** **${agg.plus_feriado}** h\n`;
  body += `- **Bolsa 200 h (reales − FT):** **${agg.bolsa_200}** h → **Hs simples:** **${agg.hs_simples}** h, **Al 50%:** **${agg.al_50}** h\n`;
  body += `- **Extras (reales − teóricas por legajo, suma):** **${agg.horas_extras_reales_menos_teoricas}** h\n`;

  const muestra = (agg.muestra_empleados ?? []) as Array<Record<string, unknown>>;
  if (muestra.length > 0) {
    body += `\n**Mayores hs reales (muestra):**\n`;
    for (const e of muestra.slice(0, 6)) {
      body += `- **${e.nombre}**: ${e.hs_reales} h reales (${e.diurnas} diurnas, ${e.nocturnas} nocturnas`;
      if (Number(e.al_100_ft) > 0) body += `, ${e.al_100_ft} h al 100%`;
      body += ')\n';
    }
  }

  if (trunc) {
    body += `\n*Nota:* la consulta alcanzó el límite de turnos; los totales pueden estar incompletos. Revisá el detalle en **Reportes y liquidación**.\n`;
  } else if (Number(agg.advertencias_sin_fichada) > 0) {
    body += `\n*Aviso:* ${agg.advertencias_sin_fichada} turno(s) operativos sin fichada no suman a horas reales.\n`;
  }
  return body.trim();
}

async function tryDeterministicLiquidacionEmpresaReply(
  t: string,
  toolCtx: AssistantToolContext,
  recent: AssistantRecentMessage[] = [],
): Promise<string | null> {
  if (!matchLiquidacionEmpresaIntent(t)) return null;

  let range = extractMonthRangeFromHoursQuery(t, toolCtx.referenceDateYsMmDd);
  if (!range) {
    range = extractMonthRangeFromHoursQuery(
      recent
        .slice(-6)
        .map((m) => m.content)
        .join(' '),
      toolCtx.referenceDateYsMmDd,
    );
  }
  if (!range) {
    try {
      const ref = parseRefYmd(extractMonthRefYmdFromRecentMessages(recent, toolCtx.referenceDateYsMmDd));
      range = monthRangeYsMmDd(ref.y, ref.m);
    } catch {
      return null;
    }
  }

  const resumen = await ejecutarResumenHorasLiquidacionEmpresaPeriodo(toolCtx, {
    fecha_desde: range.desde,
    fecha_hasta: range.hasta,
  });

  const err = String(resumen.error ?? '').trim();
  if (err) {
    if (err === 'sin_permiso_consultar_turnos_requiere_reportes_planificacion_operaciones') {
      return 'Tu perfil no tiene permiso para consultar turnos. Necesitás lectura en **Reportes**, **Planificación** u **Operaciones**.';
    }
    return `No pude calcular los totales de liquidación (${err}). Revisá **Reportes y liquidación**.`;
  }

  return formatLiquidacionEmpresaReply(resumen, range.label).slice(0, 7500);
}

function matchEmployeeHoursPeriodIntent(t: string): boolean {
  if (matchLiquidacionEmpresaIntent(t)) return false;
  if (!new RegExp(RE_HORA).test(t)) return false;
  if (/\b(empresa|plantilla completa|todos los empleados|total de la empresa)\b/.test(t) && !/\bde\s+\w/.test(t)) {
    return false;
  }
  const hasPeriod =
    Object.keys(SPANISH_MONTHS).some((name) => new RegExp(`\\b${name}\\b`).test(t)) ||
    /\b(este mes|mes actual|mes pasado|mes anterior|20\d{2}-\d{2}-\d{2})\b/.test(t);
  if (!hasPeriod) return false;
  if (/\b(?:de|del)\s+\w/.test(t)) return true;
  return new RegExp(`${RE_HORA}.{0,40}\\b[a-záéíóúñ]{3,}\\s+[a-záéíóúñ]{3,}`).test(t);
}

function formatDeterministicHoursReply(
  nombre: string,
  rangeLabel: string,
  resumen: Record<string, unknown>,
): string {
  const tot = (resumen.totales ?? {}) as Record<string, unknown>;
  const plan = Number(tot.horas_planificadas_cobertura ?? 0);
  const real = Number(tot.horas_reales_fichadas_sumadas ?? 0);
  const turnos = Number(tot.turnos_considerados ?? 0);
  const conReal = Number(tot.turnos_con_horas_reales ?? 0);
  const trunc = resumen.truncado_consulta_turnos_limite === true;

  let body = `Según **Firestore** (colección **turnos**, horas de cobertura planificada — no reemplaza liquidación CCT), **${nombre}** en **${rangeLabel}**:\n\n`;
  body += `- **Horas planificadas de cobertura:** **${plan}** h (${turnos} turnos considerados en el rango).\n`;
  if (conReal > 0) {
    body += `- **Horas reales fichadas** (turnos completados con ingreso/egreso): **${real}** h en ${conReal} turno(s).\n`;
  } else {
    body += `- **Horas reales fichadas:** sin turnos completados con fichada en ese período (o aún no cerrados).\n`;
  }
  if (trunc) {
    body += `\n*Nota:* la consulta alcanzó el límite de turnos; el total puede estar incompleto.\n`;
  }
  return body;
}

async function tryDeterministicEmployeeTurnosDetailReply(
  raw: string,
  t: string,
  toolCtx: AssistantToolContext,
  recent: AssistantRecentMessage[],
): Promise<string | null> {
  if (!matchEmployeeTurnosDetailIntent(t, recent)) return null;

  const nameFragment =
    extractEmployeeNameFromHoursQuery(raw) ||
    extractEmployeeNameFromTurnosDetailQuery(raw) ||
    extractEmployeeNameFromRecentMessages(recent);
  if (!nameFragment) {
    return 'Para el detalle de turnos necesito el **apellido y nombre** del colaborador (o repetí la consulta en el mismo mensaje, ej. «detalle de turnos de Romina Romero en mayo»).';
  }

  let range = extractMonthRangeFromHoursQuery(t, toolCtx.referenceDateYsMmDd);
  if (!range) {
    range = extractMonthRangeFromHoursQuery(
      recent
        .slice(-6)
        .map((m) => m.content)
        .join(' '),
      toolCtx.referenceDateYsMmDd,
    );
  }
  if (!range) {
    try {
      const ref = parseRefYmd(extractMonthRefYmdFromRecentMessages(recent, toolCtx.referenceDateYsMmDd));
      range = monthRangeYsMmDd(ref.y, ref.m);
    } catch {
      const ref = parseRefYmd(toolCtx.referenceDateYsMmDd);
      range = monthRangeYsMmDd(ref.y, ref.m);
    }
  }

  const search = await ejecutarBuscarEmpleadosPorNombre(toolCtx, { texto: nameFragment, limite: 6 });
  const searchErr = String(search.error ?? '').trim();
  if (searchErr) {
    if (searchErr === 'sin_permiso_para_buscar_personal') {
      return 'Tu perfil no tiene permiso para buscar legajos. Pedí acceso de lectura a **RRHH** o **Planificación**.';
    }
    return null;
  }

  const coincidencias = (search.coincidencias ?? []) as Array<{ idFirestore?: string; nombreLegible?: string }>;
  if (coincidencias.length === 0) {
    return `No encontré legajos que coincidan con «${nameFragment}». Probá apellido y nombre o número de legajo.`;
  }
  if (search.ambigua === true && coincidencias.length >= 2) {
    const lista = coincidencias
      .slice(0, 6)
      .map((c) => `**${c.nombreLegible ?? c.idFirestore}**`)
      .join(', ');
    return `Hay varias personas similares a «${nameFragment}»: ${lista}. Decime cuál para listar sus turnos.`;
  }

  const emp = coincidencias[0];
  const empId = String(emp.idFirestore ?? '').trim();
  if (!empId) return null;

  const detalle = await ejecutarConsultarTurnosEmpleado(toolCtx, {
    id_firestore_empleado: empId,
    fecha_desde: range.desde,
    fecha_hasta: range.hasta,
  });
  const err = String(detalle.error ?? '').trim();
  if (err) {
    if (err === 'sin_permiso_para_consultar_turnos') {
      return `Encontré a **${emp.nombreLegible ?? nameFragment}**, pero tu perfil no tiene permiso para consultar turnos. Necesitás lectura en **Planificación**, **Operaciones** o **Reportes**.`;
    }
    return `Encontré a **${emp.nombreLegible ?? nameFragment}** pero no pude listar los turnos (${err}). Probá de nuevo en unos segundos.`;
  }

  const nombre = String(emp.nombreLegible ?? nameFragment);
  return formatTurnosDetailReply(nombre, range.label, detalle).slice(0, 7500);
}

async function tryDeterministicEmployeeHoursReply(
  raw: string,
  t: string,
  toolCtx: AssistantToolContext,
  recent: AssistantRecentMessage[] = [],
): Promise<string | null> {
  if (!matchEmployeeHoursPeriodIntent(t)) return null;

  const nameFragment =
    extractEmployeeNameFromHoursQuery(raw) || extractEmployeeNameFromRecentMessages(recent);
  let range = extractMonthRangeFromHoursQuery(t, toolCtx.referenceDateYsMmDd);
  if (!range) {
    range = extractMonthRangeFromHoursQuery(
      recent
        .slice(-6)
        .map((m) => m.content)
        .join(' '),
      toolCtx.referenceDateYsMmDd,
    );
  }
  if (!range) {
    try {
      const ref = parseRefYmd(extractMonthRefYmdFromRecentMessages(recent, toolCtx.referenceDateYsMmDd));
      range = monthRangeYsMmDd(ref.y, ref.m);
    } catch {
      return null;
    }
  }
  if (!nameFragment) return null;

  const search = await ejecutarBuscarEmpleadosPorNombre(toolCtx, { texto: nameFragment, limite: 6 });
  const searchErr = String(search.error ?? '').trim();
  if (searchErr) {
    if (searchErr === 'sin_permiso_para_buscar_personal') {
      return 'Tu perfil no tiene permiso para buscar legajos. Pedí acceso de lectura a **RRHH** o **Planificación**.';
    }
    return null;
  }

  const coincidencias = (search.coincidencias ?? []) as Array<{ idFirestore?: string; nombreLegible?: string }>;
  if (coincidencias.length === 0) {
    return `No encontré legajos en **Firestore** que coincidan con «${nameFragment}». Probá apellido y nombre o número de legajo.`;
  }
  if (search.ambigua === true && coincidencias.length >= 2) {
    const lista = coincidencias
      .slice(0, 6)
      .map((c) => `**${c.nombreLegible ?? c.idFirestore}**`)
      .join(', ');
    return `Hay varias personas similares a «${nameFragment}»: ${lista}. Decime el apellido exacto o el número de legajo.`;
  }

  const emp = coincidencias[0];
  const empId = String(emp.idFirestore ?? '').trim();
  if (!empId) return null;

  const resumen = await ejecutarResumenHorasEmpleadoPeriodo(toolCtx, {
    id_firestore_empleado: empId,
    fecha_desde: range.desde,
    fecha_hasta: range.hasta,
  });
  const err = String(resumen.error ?? '').trim();
  if (err) {
    console.warn('[assistant] deterministic hours tool error', { err, empId, range });
    const detalle = String((resumen as Record<string, unknown>).detalle ?? '').trim();
    if (err === 'sin_permiso_para_consultar_turnos') {
      return `Encontré a **${emp.nombreLegible ?? nameFragment}**, pero tu perfil no tiene permiso para consultar turnos. Necesitás lectura en **Planificación**, **Operaciones** o **Reportes**.`;
    }
    if (err === 'error_consulta_turnos_firestore') {
      return `Encontré a **${emp.nombreLegible ?? nameFragment}**, pero falló la consulta de turnos en Firestore${detalle ? ` (${detalle})` : ''}. Probá de nuevo en unos segundos o revisá **Reportes** para el detalle del mes.`;
    }
    return `Encontré a **${emp.nombreLegible ?? nameFragment}** pero no pude calcular las horas (${err}${detalle ? `: ${detalle}` : ''}). Revisá **Reportes** o probá de nuevo.`;
  }

  const empBlock = resumen.empleado as { nombreLegible?: string } | undefined;
  const nombre = String(empBlock?.nombreLegible ?? emp.nombreLegible ?? nameFragment);
  const reply = formatDeterministicHoursReply(nombre, range.label, resumen);
  console.info('[assistant] deterministic hours reply', { empId, range, chars: reply.length });
  return reply.slice(0, 7500);
}

function normText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function recentTurnosHoyThread(recent: AssistantRecentMessage[]): boolean {
  for (let i = recent.length - 1; i >= 0 && i >= recent.length - 8; i--) {
    const tc = normText(recent[i].content || '');
    if (matchWhoOnShiftTodayIntent(tc)) return true;
    if (/\b(listado_turnos_operativos|turnos visible|consulto quien|de turno hoy|segun firestore.*operaciones)\b/i.test(recent[i].content || '')) {
      return true;
    }
    if (/\b(20\d{2}-\d{2}-\d{2})\b/.test(recent[i].content || '') && /\b(turno|hoy)\b/i.test(recent[i].content || '')) {
      return true;
    }
  }
  return false;
}

/** Seguimiento: «no hay nadie?», «si» tras preguntar turnos de hoy, etc. */
function matchTurnosHoyFollowUpIntent(t: string, recent: AssistantRecentMessage[]): boolean {
  if (matchWhoOnShiftTodayIntent(t)) return true;
  if (/^(si|sí|dale|ok|bueno|perfecto)\.?$/i.test(t.trim()) && recentTurnosHoyThread(recent)) return true;
  if (
    /\b(no hay nadie|nadie trabaja|esta vacio|está vacío|sin nadie|no hay turno|no hay guardia|hay alguien|alguien trabaja)\b/.test(t) &&
    recentTurnosHoyThread(recent)
  ) {
    return true;
  }
  return false;
}

function extractFechaFromRecentTurnosThread(recent: AssistantRecentMessage[], fallback: string): string {
  for (let i = recent.length - 1; i >= 0 && i >= recent.length - 8; i--) {
    const iso = (recent[i].content || '').match(/\b(20\d{2}-\d{2}-\d{2})\b/);
    if (iso?.[1]) return iso[1];
  }
  return fallback;
}

function recentFrancoRetThread(recent: AssistantRecentMessage[]): boolean {
  for (let i = recent.length - 1; i >= 0 && i >= recent.length - 10; i--) {
    const c = normText(recent[i].content || '');
    if (/\b(franco|ret\b|reten)\b/.test(c)) return true;
    if (/\b(codigos? de legajo|empleados con franco|en ret)\b/.test(c)) return true;
    if (/\bresumen_por_objetivo\b/.test(recent[i].content || '')) return true;
  }
  return false;
}

function matchFrancoRetFollowUpIntent(t: string, recent: AssistantRecentMessage[]): boolean {
  const trimmed = t.trim();
  if (/^(cuantos|cuántas?)\s+son\.?$/i.test(trimmed) && recentFrancoRetThread(recent)) return true;
  if (/^(quienes|quiénes|quien|quién)\s*(son|es|estan|están)?\.?$/i.test(trimmed)) {
    return recentFrancoRetThread(recent);
  }
  if (/\b(quienes|quiénes)\s+(son|estan|están|es)\b/.test(t) && recentFrancoRetThread(recent)) return true;
  if (/\b(nombres|nombralos|nombrarlos|decime los nombres)\b/.test(t) && recentFrancoRetThread(recent)) return true;
  return false;
}

function matchFrancoRetDiaIntent(t: string, recent: AssistantRecentMessage[]): boolean {
  if (matchFrancoRetFollowUpIntent(t, recent)) return true;
  if (!/\b(franco|ret\b|reten)\b/.test(t)) return false;
  if (/\b(quien|quién|quienes|quiénes|cuantos|cuántos|lista|hay|cuenta)\b/.test(t)) return true;
  if (/\b(codigo|cod)\s*f\b/.test(t)) return true;
  return false;
}

function extractFrancoRetTipoFromQuery(t: string, recent: AssistantRecentMessage[]): 'franco' | 'ret' | 'ambos' {
  const blob = [t, ...recent.slice(-4).map((m) => m.content)].join(' ');
  const n = normText(blob);
  const hasFranco = /\bfranco\b/.test(n) || /\bcodigo\s*f\b/.test(n);
  const hasRet = /\bret\b|\breten\b/.test(n);
  if (hasRet && !hasFranco) return 'ret';
  if (hasFranco && !hasRet) return 'franco';
  return 'ambos';
}

function extractObjectiveSiteFromQuery(t: string): string | null {
  let m = t.match(/\b(?:en|del|de)\s+(?:el\s+)?(?:hospital|h\.?)\s*([a-záéíóúñ0-9.\s]{2,50}?)(?:\s+hoy|\s*\?|$)/i);
  if (m?.[1]?.trim()) return m[1].trim();
  m = t.match(/\b(?:en|del|de)\s+(?:el\s+)?([a-záéíóúñ0-9.\s]{3,55}?)(?:\s+hoy|\s*\?|$)/i);
  if (m?.[1]?.trim()) {
    const frag = m[1].trim();
    if (!/\b(franco|ret|turno|tarde|mañana|noche|personas?|cuantos|cuántos)\b/i.test(frag)) return frag;
  }
  m = t.match(/\b(?:hospital|h\.?)\s*([a-záéíóúñ\s]{3,40})/i);
  if (m?.[1]?.trim()) return m[1].trim();
  return null;
}

async function tryDeterministicFrancoRetDiaReply(
  t: string,
  toolCtx: AssistantToolContext,
  recent: AssistantRecentMessage[],
): Promise<string | null> {
  if (!matchFrancoRetDiaIntent(t, recent)) return null;

  const fecha = extractFechaFromRecentTurnosThread(recent, toolCtx.referenceDateYsMmDd);
  const tipo = extractFrancoRetTipoFromQuery(t, recent);

  const siteHint =
    extractObjectiveSiteFromQuery(t) ||
    extractObjectiveHintFromRecentMessages(recent) ||
    extractObjectiveSiteFromQuery(recent.map((m) => m.content).join(' '));

  let listadoArgs: { fecha: string; tipo: 'franco' | 'ret' | 'ambos'; limite: number; id_objetivo_cercania?: string } = {
    fecha,
    tipo,
    limite: 120,
  };

  if (siteHint && siteHint.length >= 3) {
    const found = await ejecutarBuscarObjetivosPorNombre(toolCtx, { texto: siteHint, limite: 6 });
    const coincidencias = (found.coincidencias ?? []) as Array<{ id_objetivo?: string; nombre_objetivo?: string }>;
    if (coincidencias.length === 1 && coincidencias[0].id_objetivo) {
      listadoArgs = { ...listadoArgs, id_objetivo_cercania: coincidencias[0].id_objetivo };
    } else if (coincidencias.length === 0) {
      return `No encontré el objetivo «${siteHint}» en **Clientes y Objetivos**. Probá «H. Misericordia», «Misericordia» o el nombre del cliente.`;
    } else if (coincidencias.length > 1) {
      const lista = coincidencias
        .slice(0, 5)
        .map((c) => `**${c.nombre_objetivo}**`)
        .join(', ');
      return `Hay varias sedes parecidas a «${siteHint}»: ${lista}. Decime cuál.`;
    }
  }

  const data = await ejecutarListadoFrancoRetDia(toolCtx, listadoArgs);
  const err = String(data.error ?? '').trim();
  if (err) {
    if (err === 'sin_permiso_requiere_modulo_operaciones_planificacion_o_similar') {
      return 'Tu perfil no tiene permiso para listar francos/RET. Necesitás lectura en **Operaciones** o **Planificación**.';
    }
    return `No pude listar francos/RET (${err}).`;
  }

  return formatListadoFrancoRetParaChat(data).slice(0, 7500);
}

/** «¿Quién tiene turno hoy?» y variantes — respuesta acotada vía listado operativo. */
function matchTurnosObjetivoHoyIntent(t: string): boolean {
  if (!/\b(hoy|el dia|el día)\b/.test(t)) return false;
  if (!/\b(turno|tarde|mañana|noche|personas?|alguien|viene|vienen)\b/.test(t)) return false;
  return /\b(en|del|de)\s+(?:el\s+)?(?:h\.?|hospital|[a-záéíóúñ])/i.test(t);
}

function matchWhoOnShiftTodayIntent(t: string): boolean {
  if (/\b(franco|ret\b|reten|cercan)\b/.test(t)) return false;
  if (matchTurnosObjetivoHoyIntent(t)) return true;
  if (!/\b(quien|quién|quienes|quiénes)\b/.test(t) && !/\bturno\s+hoy\b/.test(t)) {
    if (!/\b(hoy|el dia|el día)\b/.test(t) || !/\b(turno|trabaja|guardia|personal)\b/.test(t)) return false;
  }
  if (/\b(quien|quién|quienes|quiénes)\b/.test(t) && /\b(turno|trabaja|trabajan|guardia|guardias|personal)\b/.test(t)) {
    return /\b(hoy|el dia|el día|este dia|este día)\b/.test(t) || /\bturno\s+hoy\b/.test(t);
  }
  return /\bturno\s+hoy\b/.test(t) || (/\b(hoy)\b/.test(t) && /\b(tiene|tienen|esta|están|hay)\b/.test(t));
}

/** Preguntas abiertas (listados genéricos, cómo…) — dejan de lado el atajo y va el LLM + tools. */
function shouldSkipDeterministicRouter(raw: string, recent: AssistantRecentMessage[] = []): boolean {
  const t = normText(raw);
  if (matchWhoOnShiftTodayIntent(t)) return false;
  if (matchFrancoRetDiaIntent(t, recent)) return false;
  if (matchAffirmativeShortIntent(t) && recentOffersSlaAllObjectivesBatch(recent)) return false;
  if (raw.length > 240) return true;
  if (/\b(quien|quién|listado|lista|mostrame|mostrá|mostrar|nombres de|cual|cuáles|decime todos)\b/.test(t)) return true;
  if (/\b(cómo|como|donde|dónde|por que|por qué|paso a paso|tutorial|explic)\b/.test(t)) return true;
  return false;
}

/** Evita "cuántos empleados en el obrador X" → conteo global incorrecto. */
function employeeCountLooksGlobalOnly(t: string): boolean {
  if (/\ben\s+(el|los|la|las)\s+[^.\n?]{5,}/.test(t)) {
    if (/\b(nomina|nómina|plantilla|empresa|total)\b/.test(t)) return true;
    return false;
  }
  return true;
}

function matchEmployeeCountIntent(
  t: string,
  moduleKey: string | null,
  pathname: string,
  recent: AssistantRecentMessage[] = [],
): boolean {
  if (recentFrancoRetThread(recent) && /^(cuantos|cuántas?|quienes|quiénes)\s+son\.?$/i.test(t.trim())) {
    return false;
  }
  if (!employeeCountLooksGlobalOnly(t)) return false;
  const rrhhCtx = moduleKey === 'RRHH' || moduleKey === 'DASHBOARD' || /rrhh/i.test(pathname);
  if (/\b(cuántos|cuantos)\s+(somos|tenemos|hay)\b/.test(t) && rrhhCtx) return true;
  if (
    rrhhCtx &&
    /\b(cuántos|cuantos)\b/.test(t) &&
    /\b(somos|tenemos)\b/.test(t) &&
    /\b(empleados|vigiladores|personal|legajos|guardias)\b/.test(t)
  ) {
    return true;
  }
  if (
    /\b(cuántos|cuantos|cuántas|cuantas|numero|número|total)\b/.test(t) &&
    /\b(empleados|empleado|vigiladores|vigilador|legajos|legajo|personal|guardias|guardia)\b/.test(t)
  ) {
    return true;
  }
  if (
    /\b(empleados|vigiladores|legajos)\s+en\s+(nómina|nomina|plantilla)\b/.test(t) &&
    /\b(cuántos|cuantos|cuántas|cuantas|cuanto|cuánto|numero|número|total)\b/.test(t)
  ) {
    return true;
  }
  return false;
}

function matchClientCountIntent(t: string): boolean {
  if (!/\b(cuántos|cuantos|cuántas|cuantas|numero|número|total)\b/.test(t)) return false;
  return /\b(clientes?)\b/.test(t);
}

function extractClientNameFromQuery(t: string): string | null {
  const m1 = t.match(/\bobjetivos?\s+(?:de|del)\s+(?:cliente\s+)?(.+?)(?:\?|$)/i);
  if (m1?.[1]) return m1[1].trim();
  const m2 = t.match(/\b(?:cliente\s+)?([a-záéíóúñ0-9][a-záéíóúñ0-9\s.-]{2,48})\s+tiene\b/i);
  if (m2?.[1] && !/\b(cuántos|cuantos|objetivos?|sedes?)\b/i.test(m2[1])) return m2[1].trim();
  const m3 = t.match(/\b(?:sedes?|objetivos?)\s+(?:de|del)\s+(.+?)(?:\?|$)/i);
  if (m3?.[1]) return m3[1].trim();
  const known = t.match(/\b(casisa|loteria|lotería|ministerio|bacarsa|ypf|shell)\b/i);
  if (known?.[1]) return known[1].trim();
  return null;
}

function matchClientObjectivesIntent(t: string): boolean {
  if (/\bobjetivos?\b/.test(t) && /\b(cliente|empresa)\b/.test(t)) return true;
  if (/\bobjetivos?\b/.test(t) && extractClientNameFromQuery(t)) return true;
  if (/\b(sedes?|ubicaciones?)\b/.test(t) && extractClientNameFromQuery(t)) return true;
  if (/\b(cuántos|cuantos|cuántas|cuantas)\b/.test(t) && /\bobjetivos?\b/.test(t) && extractClientNameFromQuery(t)) {
    return true;
  }
  return false;
}

function matchSlaCountIntent(t: string): boolean {
  if (!/\b(servicios|contratos)\b/.test(t)) return false;
  if (
    /\b(cuántos|cuantos|cuántas|cuantas|numero|número|total|cuanto|cuánto|hay|tenemos)\b/.test(t) ||
    /\b(servicios|contratos).{0,48}\b(hay|tenemos|cuántos|cuantos)\b/.test(t)
  ) {
    return true;
  }
  return false;
}

function matchHoursToPlanIntent(t: string): boolean {
  return (
    /\bhoras?\s+(?:a\s+)?planif/.test(t) ||
    /\b(?:cuantas|cuántas)\s+horas\b.{0,28}\bplanif/.test(t) ||
    /\bhoras?\s+vendid/.test(t) ||
    /\bfalta\s+planif/.test(t)
  );
}

function recentMentionsSlaOrContrato(recent: AssistantRecentMessage[]): boolean {
  for (let i = recent.length - 1; i >= 0 && i >= recent.length - 8; i--) {
    const t = normText(recent[i].content || '');
    if (/\b(servicios?\s+activ|contrato\s+es|servicios_sla|objetivo\s+distinto\s+con\s+sla)\b/.test(t)) {
      return true;
    }
    if (/\ben\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/.test(t)) {
      if (/\b(servicio|contrato|sla|kpi)\b/.test(t)) return true;
    }
    if (/\bcliente\s*[-–]\s*objetivo\b/.test(t) || /\bcasisa\b/.test(t)) return true;
  }
  return false;
}

export type ClienteObjetivoPar = { cliente: string; objetivo: string; texto: string };

function extractClienteObjetivoPairsFromContent(c: string): ClienteObjetivoPar[] {
  const pairs: ClienteObjetivoPar[] = [];
  const seen = new Set<string>();

  const add = (clienteRaw: string, objetivoRaw: string) => {
    const cliente = clienteRaw.replace(/\*\*/g, '').trim();
    const objetivo = objetivoRaw.replace(/\*\*/g, '').trim();
    const texto = objetivo.length >= 2 ? objetivo : `${cliente} ${objetivo}`.trim();
    const key = normText(`${cliente}|${objetivo}`);
    if (key.length < 4 || seen.has(key)) return;
    seen.add(key);
    pairs.push({ cliente, objetivo, texto });
  };

  const reBullet = /(?:^|\n)\s*[*•\-]+\s*([^-\n–]+?)\s*[-–]\s*([^\n]+)/gim;
  let m: RegExpExecArray | null;
  while ((m = reBullet.exec(c)) !== null) {
    add(m[1], m[2]);
  }

  const reBold = /\*\*([^*]+)\*\*\s*[-–]\s*([^\n*]+)/g;
  while ((m = reBold.exec(c)) !== null) {
    add(m[1], m[2]);
  }

  return pairs;
}

function extractClienteObjetivoPairsFromRecent(recent: AssistantRecentMessage[]): ClienteObjetivoPar[] {
  const all: ClienteObjetivoPar[] = [];
  const seen = new Set<string>();
  for (let i = recent.length - 1; i >= 0 && i >= recent.length - 10; i--) {
    for (const p of extractClienteObjetivoPairsFromContent(recent[i].content || '')) {
      const k = normText(`${p.cliente}|${p.objetivo}`);
      if (seen.has(k)) continue;
      seen.add(k);
      all.push(p);
    }
  }
  return all;
}

/** Varios contratos listados en el hilo + pregunta por SLA/horas de cada uno. */
function matchMultiSlaFromListIntent(t: string, recent: AssistantRecentMessage[]): boolean {
  const pairs = extractClienteObjetivoPairsFromRecent(recent);
  if (pairs.length < 2) return false;
  if (/\b(cada uno|cada una|todos esos|esos servicios|esos contratos|de la lista|los listados|los cuatro|los 4)\b/.test(t)) {
    if (/\b(sla|horas?|contrato|servicio|planif|vendid|detalle)\b/.test(t)) return true;
  }
  if (/\b(que|qué)\s+sla\b/.test(t) && /\b(cada|cual|todos)\b/.test(t)) return true;
  if (/\bhoras?\b/.test(t) && /\b(cada|todos|esos)\b/.test(t)) return true;
  return false;
}

function matchAffirmativeShortIntent(t: string): boolean {
  return /^(si|sí|ok|dale|bueno|perfecto|por favor|porfa|de acuerdo|esta bien|está bien|mostrame|mostrá|mostrar|si por favor)\.?$/i.test(
    t.trim(),
  );
}

/** El asistente ofreció resumen SLA vendidas/planificadas/pendientes para todos los objetivos del mes. */
function recentOffersSlaAllObjectivesBatch(recent: AssistantRecentMessage[]): boolean {
  for (let i = recent.length - 1; i >= 0 && i >= recent.length - 8; i--) {
    if (recent[i].role !== 'assistant') continue;
    const n = normText(recent[i].content || '');
    if (!/\b(sla|servicios activos)\b/.test(n)) continue;
    if (
      /\b(horas vendidas|ya planificadas|pendientes a planificar|planificadas en turnos)\b/.test(n) &&
      /\b(todos los objetivos|todos los servicios|servicios activos)\b/.test(n)
    ) {
      return true;
    }
    if (
      /\b(te gustaria|te gustaría|quieres|queres|puedo mostrarte|resumen)\b/.test(n) &&
      /\b(vendidas|planificad|pendiente)\b/.test(n) &&
      /\b(sla|objetivos|servicios activos)\b/.test(n)
    ) {
      return true;
    }
  }
  return false;
}

function matchSlaAllActiveServicesIntent(t: string, recent: AssistantRecentMessage[] = []): boolean {
  const blob = normText([t, ...recent.slice(-5).map((m) => m.content)].join(' '));
  if (
    /\b(todos los servicios|todos los contratos|todos los objetivos|cada servicio activo|servicios activos)\b/.test(
      blob,
    ) &&
    /\b(sla|horas?|planif|vendid|pendiente)\b/.test(blob)
  ) {
    return true;
  }
  if (matchAffirmativeShortIntent(t) && recentOffersSlaAllObjectivesBatch(recent)) return true;
  return false;
}

/** Seguimiento corto tras listar un SLA («cantidad de horas?», «las horas», etc.). */
function matchSlaContractHoursIntent(t: string, recent: AssistantRecentMessage[]): boolean {
  if (matchMultiSlaFromListIntent(t, recent) || matchSlaAllActiveServicesIntent(t, recent)) return false;
  if (/\b(que|qué)\s+sla\b/.test(t) && recentMentionsSlaOrContrato(recent)) return true;
  if (!new RegExp(RE_HORA).test(t)) return false;
  if (matchHoursToPlanIntent(t)) return true;
  if (/\bhoras?\s+(?:del|de)\s+(?:servicio|contrato|sla)\b/.test(t)) return true;
  if (/\b(cantidad|cuantas|cuántas|cuanto|cuánto|total|numero|número)\b/.test(t) && /\bhoras?\b/.test(t)) {
    return recentMentionsSlaOrContrato(recent);
  }
  if (/^(?:y\s+)?(?:las\s+)?horas?\s*\??\s*$/i.test(t.trim()) && recentMentionsSlaOrContrato(recent)) return true;
  return false;
}

function extractObjectiveHintFromRecentMessages(recent: AssistantRecentMessage[]): string | null {
  for (let i = recent.length - 1; i >= 0 && i >= recent.length - 8; i--) {
    const m = recent[i];
    const c = m.content || '';

    const boldPair = c.match(/\*\*([^*]+)\*\*\s*[-–]\s*([^\n*]+)/);
    if (boldPair?.[2]) return boldPair[2].trim();

    const listPair = c.match(
      /(?:^|\n)\s*[*•\-]+\s*([A-Za-zÁÉÍÓÚÑ0-9][A-Za-zÁÉÍÓÚÑ0-9\s]{1,40}?)\s*[-–]\s*([A-Za-zÁÉÍÓÚÑ][^\n(]+?)(?:\s*\(|\.|,|\n|$)/im,
    );
    if (listPair?.[2]) return listPair[2].trim();

    const plainPair = c.match(/\b(?:servicio|contrato)\s+activo\s+es:?\s*\n?\s*[-*]?\s*([^\n]+)\s*[-–]\s*([^\n]+)/i);
    if (plainPair?.[2]) return plainPair[2].trim();

    const anyPair = c.match(/\b([A-Z][A-Z0-9\s]{2,36})\s*[-–]\s*([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ0-9\s]{4,56})/);
    if (anyPair?.[2] && /\b(contrato|servicio|sla|junio|mayo)\b/i.test(c)) return anyPair[2].trim();
    if (anyPair?.[1] && anyPair?.[2]) return `${anyPair[1].trim()} ${anyPair[2].trim()}`;

    const soloObj = c.match(/\bobjetivo\s+([A-ZÁÉÍÓÚÑ0-9][^\n.,]{4,60})/i);
    if (soloObj?.[1]) return soloObj[1].trim();
  }
  return null;
}

function extractMonthRefYmdFromRecentMessages(recent: AssistantRecentMessage[], fallbackYmd: string): string {
  for (let i = recent.length - 1; i >= 0 && i >= recent.length - 8; i--) {
    const t = normText(recent[i].content || '');
    const range = extractMonthRangeFromHoursQuery(t, fallbackYmd);
    if (range) return `${range.desde.slice(0, 7)}-15`;
  }
  return fallbackYmd;
}

function formatMultiSlaHoursReply(batch: Record<string, unknown>): string {
  const mes = String(batch.mes_yyyy_mm ?? '');
  const resultados = (batch.resultados ?? []) as Array<Record<string, unknown>>;
  if (resultados.length === 0) {
    return 'No encontré contratos SLA para comparar en ese mes. Revisá **Servicios y SLA**.';
  }

  let body = `Horas **SLA** del mes **${mes}** (vendidas del contrato vs ya planificadas en turnos):\n\n`;
  for (const r of resultados) {
    const err = String(r.error ?? '').trim();
    const cliente = String(r.cliente ?? '').trim();
    const objetivo = String(r.objetivo ?? r.texto_busqueda ?? '—');
    const titulo = cliente ? `**${cliente}** — **${objetivo}**` : `**${objetivo}**`;
    if (err) {
      const msg = formatSlaHoursToolError(String(r.texto_busqueda ?? objetivo), err, r);
      body += `${titulo}\n- ${msg ?? err}\n\n`;
      continue;
    }
    const vend = Number(r.horas_vendidas_sla_mes ?? 0);
    const plan = Number(r.horas_ya_planificadas_turnos_mes ?? 0);
    const pend = Number(r.horas_pendientes_a_planificar ?? 0);
    const puestos = Number(r.puestos_en_contrato ?? 0);
    body += `${titulo}\n`;
    body += `- **Horas vendidas SLA:** **${vend}** h`;
    if (puestos > 0) body += ` (${puestos} puesto(s) en contrato)`;
    body += `\n- **Ya planificadas:** **${plan}** h`;
    if (pend > 0) body += ` | **Pendiente a planificar:** **${pend}** h`;
    body += '\n\n';
  }
  const fail = Number(batch.con_error ?? 0);
  if (fail > 0) body += `*${fail} sitio(s) no se pudieron resolver; revisá el nombre en **Servicios y SLA**.*\n`;
  body += 'Detalle de puestos y fechas del contrato: **Servicios y SLA**; grilla mensual: **Planificación y Turnos**.';
  return body.trim();
}

function formatDeterministicSlaHoursToPlanReply(resumen: Record<string, unknown>): string {
  const obj = (resumen.objetivo ?? {}) as Record<string, unknown>;
  const tot = (resumen.totales ?? {}) as Record<string, unknown>;
  const mes = String(resumen.mes_yyyy_mm ?? '');
  const nombre = String(obj.nombre ?? 'objetivo');
  const cliente = String(obj.cliente ?? '').trim();
  const vendidas = Number(tot.horas_vendidas_sla_mes ?? 0);
  const plan = Number(tot.horas_ya_planificadas_turnos_mes ?? 0);
  const pend = Number(tot.horas_pendientes_a_planificar ?? 0);
  const exceso = Number(tot.horas_planificadas_sobre_vendidas ?? 0);
  const trunc = resumen.truncado_consulta_turnos_limite === true;

  let body = `Según **Firestore** (contrato **servicios_sla** + turnos del objetivo), **${nombre}**`;
  if (cliente) body += ` (${cliente})`;
  body += ` en **${mes}**:\n\n`;
  body += `- **Horas vendidas del SLA (a cubrir en el mes):** **${vendidas}** h\n`;
  body += `- **Horas ya planificadas en turnos:** **${plan}** h\n`;
  if (pend > 0) {
    body += `- **Horas pendientes a planificar** (vendidas − cargadas): **${pend}** h\n`;
  } else if (exceso > 0) {
    body += `- **Planificado por encima del SLA:** **${exceso}** h de más respecto a vendidas (revisá en **Planificación**)\n`;
  } else {
    body += `- **Pendiente a planificar:** 0 h (planificado alineado o superior al SLA)\n`;
  }
  if (trunc) body += `\n*Nota:* la consulta de turnos alcanzó el límite; el planificado puede estar incompleto.\n`;
  body += `\nCompará con la grilla de **Planificación** («Hs. Plan.» vs vendidas).`;
  return body;
}

function formatSlaHoursToolError(objHint: string, err: string, resumen: Record<string, unknown>): string | null {
  const detalle = String(resumen.detalle ?? '').trim();
  if (err === 'objetivo_ambiguo') {
    const coincidencias = (resumen.coincidencias ?? []) as Array<{ nombre?: string }>;
    const lista = coincidencias.map((c) => `**${c.nombre ?? '?'}**`).join(', ');
    return `Hay varios objetivos similares a «${objHint}»: ${lista}. Decime el nombre exacto del sitio.`;
  }
  if (err === 'objetivo_no_encontrado') {
    return `No encontré el objetivo «${objHint}» en **Firestore**. Probá el nombre del sitio como en **Servicios y SLA**.`;
  }
  if (err === 'sin_sla_activo_para_objetivo_en_ese_mes') {
    return `Encontré el objetivo «${objHint}» pero no hay contrato **servicios_sla** que solape ese mes en Firestore. Revisá fechas del contrato en **Servicios y SLA**.`;
  }
  if (err === 'sin_permiso_servicios_o_planificacion_requiere_MODULES_READ') {
    return 'Tu perfil no tiene permiso para consultar contratos SLA. Necesitás lectura en **Servicios y SLA** o **Planificación**.';
  }
  if (err === 'error_consulta_turnos_firestore') {
    return `Calculé las horas vendidas del SLA, pero falló la lectura de turnos planificados${detalle ? ` (${detalle})` : ''}. Probá de nuevo o revisá **Planificación**.`;
  }
  if (err) {
    return `No pude completar las horas para «${objHint}» (${err}${detalle ? `: ${detalle}` : ''}). Revisá **Servicios y SLA** y **Planificación**.`;
  }
  return null;
}

function formatDeterministicTurnosHoyReply(fecha: string, r: Record<string, unknown>): string {
  const total = Number(r.cuenta_total_turnos_visibles ?? 0);
  const muestra = (r.muestra_turnos ?? []) as Array<Record<string, unknown>>;
  const truncLista = r.muestra_truncada_vs_total === true;
  const truncQuery = r.truncado_limite_turnos_consultados === true;

  if (total === 0) {
    return `Según **Firestore** (misma regla de visibilidad que **Operaciones**), para **${fecha}** no hay turnos visibles con guardia asignado o vacante reportada a planificación.`;
  }

  const bySite = new Map<string, string[]>();
  for (const row of muestra) {
    const key = `${String(row.cliente ?? '—')} · ${String(row.objetivo ?? '—')}`;
    const line = `**${String(row.persona ?? '—')}** (${String(row.codigo ?? '—')}, ${String(row.hora_inicio_cor ?? '—')}, ${String(row.estado_presencia ?? '—')})`;
    const arr = bySite.get(key) ?? [];
    arr.push(line);
    bySite.set(key, arr);
  }

  let body = `Según **Firestore** (**Operaciones**, día **${fecha}**, zona Argentina/Córdoba), hay **${total}** turno(s) visible(s).\n\n`;
  for (const [site, lines] of bySite) {
    body += `**${site}**\n`;
    for (const ln of lines.slice(0, 12)) body += `- ${ln}\n`;
    if (lines.length > 12) body += `- … y ${lines.length - 12} más en este sitio (en la muestra).\n`;
    body += '\n';
  }
  if (truncLista || truncQuery) {
    body += `*Nota:* la lista está acotada; para el detalle completo abrí **Operaciones**.\n`;
  }
  return body.trim();
}

async function tryDeterministicCrmReply(t: string, toolCtx: AssistantToolContext): Promise<string | null> {
  if (!canQueryClientsCrm(toolCtx)) return null;

  if (matchClientCountIntent(t)) {
    const r = await ejecutarContarClientesEmpresa(toolCtx, {});
    const err = String(r.error ?? '').trim();
    if (err) {
      if (err === 'sin_permiso_crm_clientes_requiere_modulo_clientes_o_similar') {
        return 'Tu perfil no tiene permiso para consultar **Clientes y Objetivos**. Necesitás lectura en ese módulo.';
      }
      return null;
    }
    const activos = Number(r.cuenta_clientes_activos ?? 0);
    const inactivos = Number(r.cuenta_clientes_inactivos ?? 0);
    const objs = Number(r.cuenta_objetivos_embebidos_en_clientes ?? 0);
    let body = `Según **Firestore** (CRM, clientes de la empresa), hay **${activos}** cliente(s) **activo(s)**`;
    if (inactivos > 0) body += ` y **${inactivos}** inactivo(s)`;
    body += ` (**${activos + inactivos}** en total). Objetivos/sedes cargados en CRM: **${objs}**.`;
    if (r.truncado_loteFirestore_480 === true) {
      body += '\n\n*Nota:* el conteo puede estar acotado por límite de consulta; para el detalle completo abrí **Clientes y Objetivos**.';
    }
    return body;
  }

  if (matchClientObjectivesIntent(t)) {
    const hint = extractClientNameFromQuery(t);
    if (!hint || hint.length < 2) return null;
    const r = await ejecutarListarObjetivosCliente(toolCtx, { texto_cliente: hint, limite: 48 });
    const err = String(r.error ?? '').trim();
    if (err === 'cliente_no_encontrado') {
      return `No encontré el cliente «${hint}» en **Firestore** (CRM). Probá el nombre comercial exacto como en **Clientes y Objetivos**.`;
    }
    if (err) return null;
    if (r.ambigua === true) {
      const lista = ((r.clientes_coincidentes ?? []) as Array<{ nombre_cliente?: string }>)
        .map((c) => `**${c.nombre_cliente ?? '?'}**`)
        .join(', ');
      return `Hay varios clientes similares a «${hint}»: ${lista}. Decime cuál querés consultar.`;
    }
    const nombre = String(r.nombre_cliente ?? hint);
    const cuenta = Number(r.cuenta_objetivos ?? 0);
    const objs = (r.objetivos ?? []) as Array<{ nombre_objetivo?: string }>;
    if (cuenta === 0) {
      return `El cliente **${nombre}** no tiene objetivos/sedes cargados en CRM.`;
    }
    let body = `El cliente **${nombre}** tiene **${cuenta}** objetivo(s)/sede(s) en CRM:\n\n`;
    for (const o of objs.slice(0, 24)) {
      body += `- **${String(o.nombre_objetivo ?? '—')}**\n`;
    }
    if (cuenta > objs.length) body += `\n*… y ${cuenta - objs.length} más (abrí CRM para la lista completa).*\n`;
    if (r.truncado_por_limite === true) body += '\n*Lista acotada en el chat.*\n';
    return body.trim();
  }

  return null;
}

async function tryDeterministicTurnosHoyReply(
  t: string,
  toolCtx: AssistantToolContext,
  recent: AssistantRecentMessage[],
): Promise<string | null> {
  if (!matchTurnosHoyFollowUpIntent(t, recent) && !matchTurnosObjetivoHoyIntent(t)) return null;

  const fecha = extractFechaFromRecentTurnosThread(recent, toolCtx.referenceDateYsMmDd);
  const siteHint = extractObjectiveSiteFromQuery(t) || extractObjectiveHintFromRecentMessages(recent);
  let idObj: string | undefined;
  if (siteHint && siteHint.length >= 3) {
    const found = await ejecutarBuscarObjetivosPorNombre(toolCtx, { texto: siteHint, limite: 4 });
    const coincidencias = (found.coincidencias ?? []) as Array<{ id_objetivo?: string }>;
    if (coincidencias.length === 1) idObj = coincidencias[0].id_objetivo;
  }

  const r = await ejecutarListadoTurnosOperativosDia(toolCtx, {
    fecha,
    limite: 96,
    id_objetivo: idObj,
  });
  const err = String(r.error ?? '').trim();
  if (err) {
    const detalle = String(r.detalle ?? '').trim();
    if (err === 'sin_permiso_resumen_operaciones_requiere_modulo_operaciones_planificacion_o_similar') {
      return 'Tu perfil no tiene permiso para ver turnos del día. Necesitás lectura en **Operaciones** o **Planificación**.';
    }
    return `No pude listar turnos de hoy (${err}${detalle ? `: ${detalle}` : ''}). Probá de nuevo o abrí **Operaciones**.`;
  }

  const fechaOut = String(r.fecha_referencia ?? fecha);
  const reply = formatDeterministicTurnosHoyReply(fechaOut, r);
  console.info('[assistant] deterministic turnos hoy', { fecha: fechaOut, total: r.cuenta_total_turnos_visibles });
  return reply.slice(0, 7500);
}

function matchPlanningUiOnlyIntent(t: string, moduleKey: string | null): boolean {
  if (moduleKey !== 'PLANNING' && moduleKey !== 'PLANNING_AI') return false;
  if (/\b(cuántos|cuantas|horas?|quien|quién|sla|turno\s+hoy|presentes|ausentes|legajo|nomina|nómina)\b/.test(t)) {
    return false;
  }
  return /\b(como|cómo|donde|dónde|planificar|publicar|grilla|asignar|auto|cronograma|mes|columna|fila)\b/.test(t);
}

function tryDeterministicPlanningUiReply(moduleKey: string | null): string | null {
  if (!moduleKey || (moduleKey !== 'PLANNING' && moduleKey !== 'PLANNING_AI')) return null;
  const guide = operationalGuideForModuleKey('PLANNING');
  if (!guide.trim()) return null;
  const body = guide.replace(/^GUÍA OPERATIVA[^\n]*\n/, '').trim();
  return (
    `**Planificación en COSP**\n\n${body.slice(0, 1500)}\n\n` +
    `Para **quién trabaja hoy** o **horas vendidas vs planificadas** de un objetivo, decime cliente/objetivo y mes y lo consulto en Firestore. Para ver o editar la grilla completa, usá **Planificación y Turnos**.`
  ).slice(0, 7500);
}

/** Evita snapshot Firestore pesado antes de Gemini cuando no hace falta. */
export function shouldPrefetchMetricsSnapshot(
  lastUser: string,
  moduleKey: string | null | undefined,
  recentMessages: AssistantRecentMessage[] = [],
): boolean {
  const raw = lastUser.trim();
  if (!raw) return false;
  if (/^(si|sí|dale|ok|bueno)\.?$/i.test(raw)) return false;
  const t = normText(raw);
  const recent = recentMessages.slice(-8);
  if (matchTurnosHoyFollowUpIntent(t, recent)) return false;
  if (matchPlanningUiOnlyIntent(t, typeof moduleKey === 'string' ? moduleKey.trim() || null : null)) return false;
  const mk = typeof moduleKey === 'string' && moduleKey.trim() ? moduleKey.trim() : null;
  if (mk === 'PLANNING' || mk === 'PLANNING_AI') {
    if (!/\b(cuántos|cuantas|horas|presentes|ausentes|servicios|sla|empleados|turno|nomina|nómina)\b/.test(t)) {
      return false;
    }
  }
  if (/\b(como|cómo|donde|dónde|ayuda|tutorial|grilla|publicar)\b/.test(t) && !/\b(cuántos|cuantas|horas|presentes|ausentes)\b/.test(t)) {
    return false;
  }
  return true;
}

export function shouldPrefetchOperationsMetricsInSnapshot(lastUser: string): boolean {
  return matchOpsDayAggregateIntent(normText(lastUser));
}

async function tryDeterministicMultiSlaHoursReply(
  t: string,
  toolCtx: AssistantToolContext,
  recent: AssistantRecentMessage[],
): Promise<string | null> {
  const pairs = extractClienteObjetivoPairsFromRecent(recent);
  const allActive = matchSlaAllActiveServicesIntent(t, recent);
  if (!matchMultiSlaFromListIntent(t, recent) && !allActive) return null;
  if (!allActive && pairs.length < 2) return null;

  const fechaRef = extractMonthRefYmdFromRecentMessages(recent, toolCtx.referenceDateYsMmDd);
  const batch = await ejecutarResumenHorasSlaVariosObjetivos(toolCtx, {
    textos_objetivo: allActive ? undefined : pairs.map((p) => p.texto),
    fecha_referencia: fechaRef,
    todos_servicios_activos_mes: allActive,
    limite: Math.max(pairs.length, 12),
  });

  const err = String(batch.error ?? '').trim();
  if (err) {
    if (err === 'sin_permiso_servicios_o_planificacion_requiere_MODULES_READ') {
      return 'Tu perfil no tiene permiso para consultar contratos SLA. Necesitás lectura en **Servicios y SLA** o **Planificación**.';
    }
    return `No pude consultar los SLA del mes (${err}). Revisá **Servicios y SLA**.`;
  }

  const reply = formatMultiSlaHoursReply(batch);
  console.info('[assistant] deterministic multi sla', {
    consultados: batch.consultados,
    con_datos: batch.con_datos,
    mes: batch.mes_yyyy_mm,
  });
  return reply.slice(0, 7500);
}

async function tryDeterministicSlaHoursToPlanReply(
  lastUser: string,
  t: string,
  toolCtx: AssistantToolContext,
  recent: AssistantRecentMessage[],
): Promise<string | null> {
  if (!matchSlaContractHoursIntent(t, recent)) return null;

  const objHint =
    extractObjectiveHintFromRecentMessages(recent) ||
    (() => {
      const m = t.match(/\b(?:en|del|de)\s+(?:el\s+)?(?:objetivo\s+)?([a-záéíóúñ0-9][a-záéíóúñ0-9\s]{3,50}?)(?:\s+en\s+|\s*$)/);
      return m?.[1]?.trim() || null;
    })();

  if (!objHint || objHint.length < 3) return null;

  const fechaRef = extractMonthRefYmdFromRecentMessages(recent, toolCtx.referenceDateYsMmDd);

  const resumen = await ejecutarResumenHorasObjetivoSlaPeriodo(toolCtx, {
    texto_objetivo: objHint,
    fecha_referencia: fechaRef,
  });

  const err = String(resumen.error ?? '').trim();
  if (err) {
    const msg = formatSlaHoursToolError(objHint, err, resumen);
    if (msg) {
      console.warn('[assistant] deterministic sla hours error', { err, objHint, fechaRef });
      return msg;
    }
    return null;
  }

  const reply = formatDeterministicSlaHoursToPlanReply(resumen);
  console.info('[assistant] deterministic sla hours reply', { objHint, fechaRef, chars: reply.length });
  return reply.slice(0, 7500);
}

function matchOpsDayAggregateIntent(t: string): boolean {
  if (/\b(quien|quién|franco|ret\b|reten|listado|lista|cercan|proxim)\b/.test(t)) return false;
  if (/\b(presentes|ausentes)\b/.test(t) && /\b(hoy|el dia|el día|dia de|día de|este dia|este día)\b/.test(t)) return true;
  if (/\b(resumen)\b.{0,24}\b(operaciones|turnos)\b/.test(t) && !/\b(por objetivo|cada objetivo)\b/.test(t)) return true;
  if (/\bturnos visibles\b/.test(t) && /\b(cuántos|cuantos|cuanto|cuánto|numero|número)\b/.test(t)) return true;
  return false;
}

/**
 * Respuesta 100 % desde lecturas Firestore (sin Gemini) para preguntas de totales muy acotadas.
 * Si devuelve null, sigue el flujo normal con modelo + herramientas.
 */
export async function tryDeterministicDataReply(
  lastUser: string,
  toolCtx: AssistantToolContext,
  toolsEnabled: boolean,
  moduleKey: string | null | undefined,
  pathname: string,
  recentMessages: AssistantRecentMessage[] = [],
): Promise<string | null> {
  if (!toolsEnabled || toolCtx.persona !== 'SYSTEM' || !toolCtx.empresaId.trim()) return null;

  const raw = lastUser.trim();
  const recent = recentMessages.slice(-8);
  if (!raw || shouldSkipDeterministicRouter(raw, recent)) return null;

  const t = normText(raw);
  const mk = typeof moduleKey === 'string' && moduleKey.trim() ? moduleKey.trim() : null;

  try {
    const francoRet = await tryDeterministicFrancoRetDiaReply(t, toolCtx, recent);
    if (francoRet?.trim()) return francoRet.trim();
  } catch (e) {
    console.warn('[assistant] tryDeterministicFrancoRetDiaReply', e);
  }

  try {
    const turnosHoy = await tryDeterministicTurnosHoyReply(t, toolCtx, recent);
    if (turnosHoy?.trim()) return turnosHoy.trim();
  } catch (e) {
    console.warn('[assistant] tryDeterministicTurnosHoyReply', e);
  }

  try {
    const crm = await tryDeterministicCrmReply(t, toolCtx);
    if (crm?.trim()) return crm.trim();
  } catch (e) {
    console.warn('[assistant] tryDeterministicCrmReply', e);
  }

  if (matchPlanningUiOnlyIntent(t, mk)) {
    const planUi = tryDeterministicPlanningUiReply(mk);
    if (planUi?.trim()) return planUi.trim();
  }

  if (!shouldSkipDeterministicRouter(raw, recent)) {
    try {
      const liqEmp = await tryDeterministicLiquidacionEmpresaReply(t, toolCtx, recent);
      if (liqEmp?.trim()) return liqEmp.trim();
    } catch (e) {
      console.warn('[assistant] tryDeterministicLiquidacionEmpresaReply', e);
    }
    try {
      const multiSla = await tryDeterministicMultiSlaHoursReply(t, toolCtx, recent);
      if (multiSla?.trim()) return multiSla.trim();
    } catch (e) {
      console.warn('[assistant] tryDeterministicMultiSlaHoursReply', e);
    }
    try {
      const slaPlanReply = await tryDeterministicSlaHoursToPlanReply(raw, t, toolCtx, recent);
      if (slaPlanReply?.trim()) return slaPlanReply.trim();
    } catch (e) {
      console.warn('[assistant] tryDeterministicSlaHoursToPlanReply', e);
    }
    try {
      const turnosDet = await tryDeterministicEmployeeTurnosDetailReply(raw, t, toolCtx, recent);
      if (turnosDet?.trim()) return turnosDet.trim();
    } catch (e) {
      console.warn('[assistant] tryDeterministicEmployeeTurnosDetailReply', e);
    }
    try {
      const hoursReply = await tryDeterministicEmployeeHoursReply(raw, t, toolCtx, recent);
      if (hoursReply?.trim()) return hoursReply.trim();
    } catch (e) {
      console.warn('[assistant] tryDeterministicEmployeeHoursReply', e);
    }
  }

  const wantEmp = matchEmployeeCountIntent(t, mk, pathname, recent);
  const wantSla = matchSlaCountIntent(t);
  const wantOps = matchOpsDayAggregateIntent(t);
  const wantClients = matchClientCountIntent(t);
  const wantClientObjs = matchClientObjectivesIntent(t);

  if (!wantEmp && !wantSla && !wantOps && !wantClients && !wantClientObjs) return null;

  const blocks: string[] = [];

  if (wantClients || wantClientObjs) {
    const crm = await tryDeterministicCrmReply(t, toolCtx);
    if (crm?.trim()) blocks.push(crm.trim());
  }

  if (wantEmp) {
    const r = await ejecutarContarEmpleadosPlantillaEmpresa(toolCtx, {});
    if (String(r.error ?? '').trim()) {
      blocks.push(
        'No pude contar la nómina desde Firestore (revisá permiso en **RRHH**). La cifra oficial está en la tarjeta **Empleados en nómina** del **Panel principal**.',
      );
    } else {
      const n = Number(r.cuenta_para_tarjeta_panel_empleados_nomina ?? 0);
      const amplio = Number(r.cuenta_legajos_operativos_criterio_rrhh_incluye_sin_estado ?? 0);
      blocks.push(
        `Según **Firestore** (legajos de la empresa), hay **${n}** empleado(s) en nómina con status activo (misma regla que la tarjeta **Empleados en nómina** del panel). Criterio amplio RRHH (incluye sin estado explícito): **${amplio}**.`,
      );
      if (r.truncado_loteFirestore_900 === true) {
        blocks.push('*Nota:* el conteo puede estar incompleto por límite de consulta; verificá en **RRHH y legajos**.');
      }
    }
  }

  if (wantSla) {
    const r = await ejecutarContarServiciosSlaVigentesEmpresa(toolCtx, {});
    if (String(r.error ?? '').trim()) {
      if (!wantEmp && !blocks.length && !wantOps) return null;
    } else {
      const n = Number(r.cuenta_para_tarjeta_servicios_activos_del_mes ?? 0);
      const obj = Number(r.cuenta_objetivos_distintos_con_sla_en_ese_mes ?? 0);
      const fecha = String(r.fecha_referencia ?? toolCtx.referenceDateYsMmDd);
      blocks.push(
        `Según **Firestore** (colección **servicios_sla**, contratos cuyo período solapa el mes de la fecha de referencia **${fecha}**, alineado al KPI del módulo Servicios y SLA), hay **${n}** contratos.\n\nObjetivos distintos con SLA en ese mes: **${obj}**.`,
      );
    }
  }

  if (wantOps) {
    const r = await ejecutarResumenPresenciasObjetivosDia(toolCtx, {});
    if (String(r.error ?? '').trim()) {
      if (blocks.length === 0) return null;
    } else {
      const tot = r.totales as Record<string, unknown> | undefined;
      if (!tot) {
        if (blocks.length === 0) return null;
      } else {
        const fecha = String(r.fecha_referencia ?? toolCtx.referenceDateYsMmDd);
        blocks.push(
          `Según **Firestore** (turnos visibles como en **Operaciones** para **${fecha}**, zona Argentina/Córdoba): **${tot.turnos_visibles_en_dia ?? 0}** turnos visibles; **${tot.presentes ?? 0}** presentes, **${tot.ausentes ?? 0}** ausentes, **${tot.sin_marcacion_relevante ?? 0}** sin marcación relevante.`,
        );
      }
    }
  }

  if (blocks.length === 0) return null;

  const reply = blocks.join('\n\n---\n\n');
  console.info('[assistant] deterministic data reply', { wantEmp, wantSla, wantOps, chars: reply.length });
  return reply.slice(0, 7500);
}
