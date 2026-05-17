import { operationalGuideForModuleKey } from './cospKnowledge';
import {
  ejecutarBuscarEmpleadosPorNombre,
  ejecutarContarServiciosSlaVigentesEmpresa,
  ejecutarResumenHorasEmpleadoPeriodo,
  ejecutarListadoTurnosOperativosDia,
  ejecutarResumenHorasObjetivoSlaPeriodo,
  ejecutarResumenHorasSlaVariosObjetivos,
  ejecutarResumenPresenciasObjetivosDia,
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

function extractEmployeeNameFromHoursQuery(raw: string): string | null {
  const t = normText(raw);
  const monthNames = Object.keys(SPANISH_MONTHS).join('|');
  const periodTail = `(?:en|durante|para|del)\\s+(?:el\\s+)?(?:mes\\s+de\\s+)?(?:${monthNames}|este mes|mes actual|mes pasado|20\\d{2})`;

  let m = t.match(new RegExp(`${RE_HORA}.{0,24}\\b(?:de|del)\\s+(.+?)\\s+${periodTail}`));
  if (m?.[1] && m[1].trim().length >= 3) return m[1].trim();

  m = t.match(new RegExp(`\\b(?:cuantas|cuántas)\\s+horas?\\b.{0,32}\\b(?:de|del)\\s+(.+?)\\s+${periodTail}`));
  if (m?.[1] && m[1].trim().length >= 3) return m[1].trim();

  m = t.match(new RegExp(`${RE_HORA}.{0,16}\\b(?:trabaj|planific|fichad)\\w*\\s+(?:de\\s+)?(.+?)\\s+${periodTail}`));
  if (m?.[1] && m[1].trim().length >= 3) return m[1].trim();

  m = t.match(/\b(?:de|del)\s+([a-záéíóúñ][a-záéíóúñ\s]{2,40}?)\s+en\s+(?:el\s+)?(?:mes\s+de\s+)?(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/);
  if (m?.[1] && m[1].trim().length >= 3) return m[1].trim();

  m = t.match(new RegExp(`${RE_HORA}\\s+(?:de|del)\\s+([a-záéíóúñ][a-záéíóúñ\\s]{2,48})\\s+en\\s+(?:${monthNames})\\b`));
  if (m?.[1] && m[1].trim().length >= 3) return m[1].trim();

  return null;
}

function matchEmployeeHoursPeriodIntent(t: string): boolean {
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
  body += `\nPara nocturnas, feriados y liquidación oficial usá el módulo **Reportes y liquidación**.`;
  return body;
}

async function tryDeterministicEmployeeHoursReply(
  raw: string,
  t: string,
  toolCtx: AssistantToolContext,
): Promise<string | null> {
  if (!matchEmployeeHoursPeriodIntent(t)) return null;

  const nameFragment = extractEmployeeNameFromHoursQuery(raw);
  const range = extractMonthRangeFromHoursQuery(t, toolCtx.referenceDateYsMmDd);
  if (!nameFragment || !range) return null;

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

/** «¿Quién tiene turno hoy?» y variantes — respuesta acotada vía listado operativo. */
function matchWhoOnShiftTodayIntent(t: string): boolean {
  if (/\b(franco|ret\b|reten|cercan)\b/.test(t)) return false;
  if (!/\b(quien|quién|quienes|quiénes)\b/.test(t) && !/\bturno\s+hoy\b/.test(t)) {
    if (!/\b(hoy|el dia|el día)\b/.test(t) || !/\b(turno|trabaja|guardia|personal)\b/.test(t)) return false;
  }
  if (/\b(quien|quién|quienes|quiénes)\b/.test(t) && /\b(turno|trabaja|trabajan|guardia|guardias|personal)\b/.test(t)) {
    return /\b(hoy|el dia|el día|este dia|este día)\b/.test(t) || /\bturno\s+hoy\b/.test(t);
  }
  return /\bturno\s+hoy\b/.test(t) || (/\b(hoy)\b/.test(t) && /\b(tiene|tienen|esta|están|hay)\b/.test(t));
}

/** Preguntas abiertas (listados genéricos, cómo…) — dejan de lado el atajo y va el LLM + tools. */
function shouldSkipDeterministicRouter(raw: string): boolean {
  const t = normText(raw);
  if (matchWhoOnShiftTodayIntent(t)) return false;
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

function matchEmployeeCountIntent(t: string, moduleKey: string | null, pathname: string): boolean {
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

function matchSlaAllActiveServicesIntent(t: string): boolean {
  return (
    /\b(todos los servicios|todos los contratos|cada servicio activo|servicios activos del mes)\b/.test(t) &&
    /\b(sla|horas?|planif|vendid)\b/.test(t)
  );
}

/** Seguimiento corto tras listar un SLA («cantidad de horas?», «las horas», etc.). */
function matchSlaContractHoursIntent(t: string, recent: AssistantRecentMessage[]): boolean {
  if (matchMultiSlaFromListIntent(t, recent) || matchSlaAllActiveServicesIntent(t)) return false;
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

async function tryDeterministicTurnosHoyReply(
  t: string,
  toolCtx: AssistantToolContext,
  recent: AssistantRecentMessage[],
): Promise<string | null> {
  if (!matchTurnosHoyFollowUpIntent(t, recent)) return null;

  const fecha = extractFechaFromRecentTurnosThread(recent, toolCtx.referenceDateYsMmDd);

  const r = await ejecutarListadoTurnosOperativosDia(toolCtx, {
    fecha,
    limite: 96,
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
  const allActive = matchSlaAllActiveServicesIntent(t);
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
  if (!raw || shouldSkipDeterministicRouter(raw)) return null;

  const t = normText(raw);
  const mk = typeof moduleKey === 'string' && moduleKey.trim() ? moduleKey.trim() : null;
  const recent = recentMessages.slice(-8);

  try {
    const turnosHoy = await tryDeterministicTurnosHoyReply(t, toolCtx, recent);
    if (turnosHoy?.trim()) return turnosHoy.trim();
  } catch (e) {
    console.warn('[assistant] tryDeterministicTurnosHoyReply', e);
  }

  if (matchPlanningUiOnlyIntent(t, mk)) {
    const planUi = tryDeterministicPlanningUiReply(mk);
    if (planUi?.trim()) return planUi.trim();
  }

  if (!shouldSkipDeterministicRouter(raw)) {
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
      const hoursReply = await tryDeterministicEmployeeHoursReply(raw, t, toolCtx);
      if (hoursReply?.trim()) return hoursReply.trim();
    } catch (e) {
      console.warn('[assistant] tryDeterministicEmployeeHoursReply', e);
    }
  }

  const wantEmp = matchEmployeeCountIntent(t, mk, pathname);
  const wantSla = matchSlaCountIntent(t);
  const wantOps = matchOpsDayAggregateIntent(t);

  if (!wantEmp && !wantSla && !wantOps) return null;

  const blocks: string[] = [];

  if (wantEmp) {
    blocks.push(
      'El total de **empleados en nómina** (legajos activos en plantilla) está en la tarjeta **Empleados en nómina** del **Panel principal** — es la misma cifra que ves en el dashboard, sin necesidad de consultarla acá.\n\nPara buscar una persona, ver legajos o gestionar altas y bajas, usá **RRHH y legajos**.',
    );
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
