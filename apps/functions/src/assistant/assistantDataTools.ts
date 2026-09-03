import * as admin from 'firebase-admin';
import { Timestamp, type QueryDocumentSnapshot } from 'firebase-admin/firestore';
import {
  belongsToEmpresa,
  empresaClientIdsSetScoped,
  queryClientsDocsScoped,
  queryCollectionDocsScoped,
  queryEmpleadosDocsScoped,
  turnoRowBelongsToEmpresa,
} from './assistantEmpresaScope';
import { aggregateLiquidacionEmpresaPeriodo } from './assistantLiquidacionAggregate';
import { slaHorasVendidasMesCalendario } from './assistantSlaHours';
import type { AssistantPersona } from './resolveAssistantUser';
import {
  planificacionEstadoLookupDocIds,
  planificacionEstadoLookupKey,
  ymCordobaParts,
} from './planificacionEstadoKeys';

/** Zona operativa alineada al planificador web (Argentina). */
const AR_DAY_OFFSET = '-03:00';

/** Límite por consulta día en asistente (evita timeouts en snapshot y listados). */
export const ASSISTANT_TURNOS_DIA_QUERY_LIMIT = 900;

export type AssistantToolContext = {
  persona: AssistantPersona;
  empresaId: string;
  /** Bacarsa sin migrar: false (ve legacy sin empresaId). Empresas nuevas/migradas: true. */
  scopeEmpresa: boolean;
  readableModuleKeys: string[];
  selfEmployeeFirestoreId: string | null;
  referenceDateYsMmDd: string;
};

function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** Tokens útiles para matchear «hospital misericordia», «H. MISERICORDIA», «hosp misericordia». */
function objectiveSearchTokens(textoRaw: string): string[] {
  const t = norm(textoRaw.replace(/\./g, ' ').replace(/,/g, ' '));
  const words = t.split(/\s+/).filter((w) => w.length >= 2);
  const out = new Set(words);
  if (words.some((w) => w === 'hosp' || w === 'hospital' || w === 'h')) {
    out.add('misericordia');
    out.add('san');
    out.add('roque');
  }
  if (t.includes('misericordia')) out.add('misericordia');
  if (t.includes('malagueno') || t.includes('malagueño')) out.add('malagueno');
  if (t.includes('cruz') && t.includes('eje')) {
    out.add('cruz');
    out.add('eje');
  }
  return [...out].filter((w) => w.length >= 3);
}

function objectiveHaystackMatchesNeedle(needleRaw: string, oname: string, clientName: string): boolean {
  const hay = norm(`${oname} ${clientName}`);
  const needle = norm(needleRaw.replace(/\./g, ' '));
  if (!needle || needle.length < 2) return false;
  if (hay.includes(needle)) return true;
  const compactNeedle = needle.replace(/\s+/g, '');
  const compactHay = hay.replace(/\s+/g, '');
  if (compactHay.includes(compactNeedle)) return true;

  const tokens = objectiveSearchTokens(needleRaw);
  if (tokens.length === 0) return hay.includes(needle);
  let hits = 0;
  for (const tok of tokens) {
    if (hay.includes(tok)) hits += 1;
  }
  if (hits >= Math.max(1, tokens.length - 1)) return true;
  if (tokens.includes('misericordia') && hay.includes('misericordia')) return true;
  if (tokens.includes('roque') && hay.includes('roque') && hay.includes('san')) return true;
  return false;
}

/** Texto normalizado para buscar persona: apellido, nombre, campo name (suele ser "APELLIDO, NOMBRE"), legajo. */
function buildEmpleadoSearchHaystack(data: Record<string, unknown>): string {
  const ln = String(data.lastName ?? '').trim();
  const fn = String(data.firstName ?? '').trim();
  const nameRaw = String(data.name ?? '').trim().replace(/,/g, ' ');
  const nom = String(data.nombre ?? '').trim().replace(/,/g, ' ');
  const leg = String(data.fileNumber ?? '').trim();
  const chunks = [ln, fn, nameRaw, nom, leg].filter(Boolean);
  const joined = chunks.join(' ').replace(/\s+/g, ' ');
  return norm(joined);
}

/** Coincide si el fragmento está contenido o si son varias palabras y todas aparecen (orden libre). */
function matchesEmpleadoSearchNeedle(needle: string, haystack: string): boolean {
  if (!needle || !haystack) return false;
  if (haystack.includes(needle)) return true;
  const tokens = needle.split(/\s+/).filter((t) => t.length >= 2);
  if (tokens.length < 2) return false;
  return tokens.every((t) => haystack.includes(t));
}

function canUseEmployeeSearch(ctx: AssistantToolContext): boolean {
  if (ctx.persona !== 'SYSTEM') return false;
  return ctx.readableModuleKeys.some((k) =>
    ['RRHH', 'PLANNING', 'OPERATIONS', 'REPORTS', 'ANALYSIS', 'CONFIG', 'SERVICES'].includes(k),
  );
}

function canQueryShifts(ctx: AssistantToolContext): boolean {
  if (ctx.persona === 'CLIENT') return false;
  if (ctx.persona === 'EMPLOYEE') return !!ctx.selfEmployeeFirestoreId;
  return ctx.readableModuleKeys.some((k) =>
    ['OPERATIONS', 'PLANNING', 'REPORTS', 'ANALYSIS', 'DASHBOARD', 'RRHH'].includes(k),
  );
}

/** Agregados tipo «cuántos presentes hay hoy» — sólo backoffice con módulos operativos/planificación. */
function canQueryOperationsDaySummary(ctx: AssistantToolContext): boolean {
  if (ctx.persona !== 'SYSTEM') return false;
  if (!ctx.empresaId.trim()) return false;
  return ctx.readableModuleKeys.some((k) =>
    ['OPERATIONS', 'DASHBOARD', 'ANALYSIS', 'REPORTS', 'PLANNING'].includes(k),
  );
}

/** Consulta colección servicios_sla para la empresa («cuántos servicios activos hoy», etc.). */
function canQueryServiciosSlaResumen(ctx: AssistantToolContext): boolean {
  if (ctx.persona !== 'SYSTEM') return false;
  if (!ctx.empresaId.trim()) return false;
  return ctx.readableModuleKeys.some((k) =>
    ['SERVICES', 'PLANNING', 'OPERATIONS', 'DASHBOARD', 'ANALYSIS', 'CONFIG', 'CLIENTS'].includes(k),
  );
}

/** Objetivos embebidos en clients de la empresa — para resolver nombre → id (cercanía Franco/RET, etc.). */
function canSearchObjectivesCrm(ctx: AssistantToolContext): boolean {
  if (ctx.persona !== 'SYSTEM') return false;
  if (!ctx.empresaId.trim()) return false;
  return ctx.readableModuleKeys.some((k) =>
    ['CLIENTS', 'PLANNING', 'OPERATIONS', 'SERVICES', 'ANALYSIS', 'DASHBOARD', 'REPORTS', 'CONFIG'].includes(k),
  );
}

/** Clientes y objetivos embebidos en `clients` — conteos y listados CRM. */
export function canQueryClientsCrm(ctx: AssistantToolContext): boolean {
  if (ctx.persona !== 'SYSTEM') return false;
  if (!ctx.empresaId.trim()) return false;
  return ctx.readableModuleKeys.some((k) =>
    ['CLIENTS', 'DASHBOARD', 'CONFIG', 'PLANNING', 'SERVICES', 'OPERATIONS'].includes(k),
  );
}

function clientHaystackMatchesNeedle(needleRaw: string, clientName: string): boolean {
  const needle = norm(needleRaw);
  const hay = norm(clientName);
  if (!needle || needle.length < 2 || !hay) return false;
  if (hay.includes(needle) || needle.includes(hay)) return true;
  const nTok = needle.split(/\s+/).filter((t) => t.length >= 2);
  if (nTok.length === 0) return hay.includes(needle);
  return nTok.every((t) => hay.includes(t));
}

/** Legajos `empleados` de la empresa — conteos «cuántos en plantilla». */
function canQueryEmpleadosPlantillaResumen(ctx: AssistantToolContext): boolean {
  if (ctx.persona !== 'SYSTEM') return false;
  if (!ctx.empresaId.trim()) return false;
  return ctx.readableModuleKeys.some((k) =>
    ['RRHH', 'PLANNING', 'OPERATIONS', 'DASHBOARD', 'ANALYSIS', 'CONFIG', 'REPORTS'].includes(k),
  );
}

function ymCordoba(dt: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Argentina/Cordoba',
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(dt);
  const y = Number(parts.find((p) => p.type === 'year')?.value);
  const m = Number(parts.find((p) => p.type === 'month')?.value);
  return `${y}_${m}`;
}

function isSameCordobaCalendarDay(dt: Date, ymdHyphen: string): boolean {
  const s = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Cordoba',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(dt);
  return s === ymdHyphen;
}

/** Ventana de consulta como useOperacionesMonitor: ref D → [D−1 12:00 .. D+1 23:59:59], zona AR. */
function monitorWideWindow(referenceYsMmDd: string): { start: FirebaseFirestore.Timestamp; end: FirebaseFirestore.Timestamp } {
  parseYmd(referenceYsMmDd);
  const dNoonMs = Date.parse(`${referenceYsMmDd}T12:00:00.000${AR_DAY_OFFSET}`);
  const dEndMs = Date.parse(`${referenceYsMmDd}T23:59:59.999${AR_DAY_OFFSET}`);
  const startMs = dNoonMs - 86400000;
  const endMs = dEndMs + 86400000;
  return {
    start: Timestamp.fromMillis(startMs),
    end: Timestamp.fromMillis(endMs),
  };
}

type OperacionesDiaRowPublico = {
  oid: string;
  isPresent: boolean;
  isAbsent: boolean;
  codigo: string;
  puesto: string;
  empleado_etiqueta: string;
  employee_firestore_id: string;
  cliente: string;
  objetivo_nombre: string;
  h_inicio_cordoba: string;
};

type OperacionesDiaRowSorted = OperacionesDiaRowPublico & { shiftTsMs: number };

function horaHmCordoba(dt: Date): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Argentina/Cordoba',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(dt);
}

function enrichOperacionesDiaRowsWithNombres(
  rows: OperacionesDiaRowPublico[],
  nombres: Map<string, string>,
): OperacionesDiaRowPublico[] {
  return rows.map((r) => {
    if (!r.employee_firestore_id) return r;
    const resolved = nombres.get(r.employee_firestore_id);
    let etiqueta = r.empleado_etiqueta;
    if (resolved) etiqueta = resolved;
    else if (empleadoEtiquetaPareceIdFirestore(etiqueta, r.employee_firestore_id)) {
      etiqueta = '(sin nombre en legajo RRHH)';
    } else {
      etiqueta = etiquetaEmpleadoParaUsuario(etiqueta, r.employee_firestore_id);
    }
    return { ...r, empleado_etiqueta: etiqueta };
  });
}

/** Turnos visibles en fecha (día Cordoba), mismas reglas que el monitor de Operaciones. */
async function queryTurnosVisiblesOperacionesEmpresaDia(
  db: FirebaseFirestore.Firestore,
  empresaId: string,
  objectiveMap: Map<string, { name: string; clientId: string; clientName: string }>,
  fecha: string,
  scopeEmpresa: boolean,
): Promise<{ rows: OperacionesDiaRowPublico[]; truncadoConsultaTurnos: boolean }> {
  const objectiveIds = new Set(objectiveMap.keys());
  const { start, end } = monitorWideWindow(fecha);
  let qsnap: FirebaseFirestore.QuerySnapshot;
  try {
    qsnap = await db
      .collection('turnos')
      .where('startTime', '>=', start)
      .where('startTime', '<=', end)
      .limit(ASSISTANT_TURNOS_DIA_QUERY_LIMIT)
      .get();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[assistant] queryTurnosVisiblesOperacionesEmpresaDia', { fecha, msg });
    throw new Error(`error_consulta_turnos_operaciones: ${msg.slice(0, 240)}`);
  }

  type PreCand = {
    oid: string;
    needsPubCheck: boolean;
    shiftDateObj: Date;
    isPresent: boolean;
    isAbsent: boolean;
    codigo: string;
    puesto: string;
    empleado_etiqueta: string;
    employee_firestore_id: string;
    cliente: string;
    objetivo_nombre: string;
    h_inicio_cordoba: string;
  };

  const pre: PreCand[] = [];
  const pubLookupKeys = new Map<string, { primaryId: string; legacyId: string | null }>();

  for (const docSnap of qsnap.docs) {
    const shift = docSnap.data() as Record<string, unknown>;
    const st = readFirestoreTs(shift, 'startTime');
    if (!st) continue;
    const shiftDateObj = st.toDate();
    if (!isSameCordobaCalendarDay(shiftDateObj, fecha)) continue;

    const oid = String(shift.objectiveId ?? '').trim();
    if (!oid || !objectiveIds.has(oid)) continue;

    if (shift.draft === true) continue;
    if (shift.status === 'COVERED') continue;
    const rawPos = String(shift.positionName ?? '').trim();
    if (!rawPos || rawPos === 'Sin Puesto' || rawPos === 'General') continue;

    const isOp =
      shift.origin === 'RETEN' ||
      shift.origin === 'OPERATIONS_COVERAGE' ||
      shift.origin === 'SLA_VIRTUAL' ||
      !!shift.isReten ||
      shift.resolvedBy === 'OPERACIONES';
    const isAlreadyProcessed =
      !!shift.isPresent ||
      shift.status === 'PRESENT' ||
      shift.status === 'COMPLETED' ||
      !!shift.isReportedToPlanning ||
      !!shift.isReported;

    const empId = String(shift.employeeId ?? '');
    const isValidEmployee = !!(empId && empId !== 'VACANTE');
    const isReportedToPlanning = shift.status === 'REPORTED_TO_PLANNING' || shift.isReported === true;
    const isUnassigned = !isValidEmployee;
    if (isUnassigned && !isReportedToPlanning) continue;

    const needsPubCheck = !isOp && !isAlreadyProcessed;
    if (needsPubCheck) {
      const { year, month, ym } = ymCordobaParts(shiftDateObj);
      const lookupKey = planificacionEstadoLookupKey(oid, ym);
      if (!pubLookupKeys.has(lookupKey)) {
        const ids = planificacionEstadoLookupDocIds(empresaId, oid, year, month);
        pubLookupKeys.set(lookupKey, {
          primaryId: ids[0],
          legacyId: ids.length > 1 ? ids[1] : null,
        });
      }
    }

    const isAbsent = !!shift.isAbsent;
    const isPresent = !!shift.isPresent && isValidEmployee && !isAbsent;
    const meta = objectiveMap.get(oid);
    const nombreEmp = String(shift.employeeName ?? '').trim();
    const etiquetaTurno =
      isValidEmployee && nombreEmp && !empleadoEtiquetaPareceIdFirestore(nombreEmp, empId) ? nombreEmp : '';
    const empleado_etiqueta = isValidEmployee
      ? etiquetaTurno || empId.slice(0, 12) || '(legajo)'
      : 'VACANTE / sin asignar';

    pre.push({
      oid,
      needsPubCheck,
      shiftDateObj,
      isPresent,
      isAbsent,
      codigo: String(shift.code ?? shift.type ?? '').trim() || '—',
      puesto: rawPos,
      empleado_etiqueta,
      employee_firestore_id: isValidEmployee ? empId : '',
      cliente: (meta?.clientName ?? String(shift.clientName ?? '').trim()) || '—',
      objetivo_nombre: (meta?.name ?? String(shift.objectiveName ?? '').trim()) || oid,
      h_inicio_cordoba: horaHmCordoba(shiftDateObj),
    });
  }

  const pubMap = new Map<string, boolean>();
  const docIdToLookup = new Map<string, string>();
  const refs: FirebaseFirestore.DocumentReference[] = [];
  for (const [lookupKey, { primaryId, legacyId }] of pubLookupKeys) {
    refs.push(db.collection('planificacion_estados').doc(primaryId));
    docIdToLookup.set(primaryId, lookupKey);
    if (legacyId) {
      refs.push(db.collection('planificacion_estados').doc(legacyId));
      docIdToLookup.set(legacyId, lookupKey);
    }
  }
  const snaps = await firestoreGetAllRefs(db, refs);
  for (let j = 0; j < snaps.length; j++) {
    if (!snaps[j].exists) continue;
    const lk = docIdToLookup.get(refs[j].id);
    if (lk) pubMap.set(lk, true);
  }

  const rows: OperacionesDiaRowSorted[] = [];
  for (const c of pre) {
    if (c.needsPubCheck) {
      const k = planificacionEstadoLookupKey(c.oid, ymCordobaParts(c.shiftDateObj).ym);
      if (!pubMap.get(k)) continue;
    }
    rows.push({
      oid: c.oid,
      isPresent: c.isPresent,
      isAbsent: c.isAbsent,
      codigo: c.codigo,
      puesto: c.puesto,
      empleado_etiqueta: c.empleado_etiqueta,
      employee_firestore_id: c.employee_firestore_id,
      cliente: c.cliente,
      objetivo_nombre: c.objetivo_nombre,
      h_inicio_cordoba: c.h_inicio_cordoba,
      shiftTsMs: c.shiftDateObj.getTime(),
    });
  }

  rows.sort((a, b) => {
    const c0 = `${a.cliente} ${a.objetivo_nombre}`.localeCompare(`${b.cliente} ${b.objetivo_nombre}`, 'es');
    if (c0 !== 0) return c0;
    return a.shiftTsMs - b.shiftTsMs;
  });

  let outMapped: OperacionesDiaRowPublico[] = rows.map(({ shiftTsMs, ...rest }) => rest);
  const empIds = [...new Set(outMapped.map((r) => r.employee_firestore_id).filter(Boolean))];
  if (empIds.length > 0 && empresaId) {
    const nombresMap = await empleadosNombresBatch(db, empresaId, empIds, scopeEmpresa);
    outMapped = enrichOperacionesDiaRowsWithNombres(outMapped, nombresMap);
  }

  return { rows: outMapped, truncadoConsultaTurnos: qsnap.size >= ASSISTANT_TURNOS_DIA_QUERY_LIMIT };
}

async function objectivesMapForEmpresa(
  db: FirebaseFirestore.Firestore,
  empresaId: string,
  filterObjectiveId: string | undefined,
  scopeEmpresa: boolean,
): Promise<Map<string, { name: string; clientId: string; clientName: string }>> {
  const out = new Map<string, { name: string; clientId: string; clientName: string }>();
  const filt = filterObjectiveId?.trim();
  const docs = await queryClientsDocsScoped(db, empresaId, scopeEmpresa, 480);
  for (const d of docs) {
    const data = d.data() as Record<string, unknown>;
    const clientName = String(data.name ?? '').trim() || d.id;
    const objetivos = data.objetivos;
    if (Array.isArray(objetivos)) {
      for (const o of objetivos as Array<Record<string, unknown>>) {
        const oid = String(o?.id ?? '').trim();
        if (!oid) continue;
        if (filt && oid !== filt) continue;
        const name = String(o?.name ?? '').trim() || oid;
        out.set(oid, { name, clientId: d.id, clientName });
      }
    } else if (!objetivos) {
      /* cliente sin objetivos explícitos: el doc mismo es el “objetivo” en algunos modelos legacy */
      if (filt && d.id !== filt) continue;
      out.set(d.id, {
        name: clientName,
        clientId: d.id,
        clientName,
      });
    }
  }
  return out;
}

type ObjectiveMetaCoords = { name: string; clientId: string; clientName: string; lat: number | null; lng: number | null };

/** Igual que objectivesMapForEmpresa pero con lat/lng del objetivo (CRM) para distancias. */
async function objectivesMapWithCoordsForEmpresa(
  db: FirebaseFirestore.Firestore,
  empresaId: string,
  filterObjectiveId: string | undefined,
  scopeEmpresa: boolean,
): Promise<Map<string, ObjectiveMetaCoords>> {
  const out = new Map<string, ObjectiveMetaCoords>();
  const filt = filterObjectiveId?.trim();
  const docs = await queryClientsDocsScoped(db, empresaId, scopeEmpresa, 480);
  for (const d of docs) {
    const data = d.data() as Record<string, unknown>;
    const clientName = String(data.name ?? '').trim() || d.id;
    const objetivos = data.objetivos;
    const readLatLng = (o: Record<string, unknown>) => {
      const lat = o?.lat != null ? Number(o.lat) : NaN;
      const lng = o?.lng != null ? Number(o.lng) : NaN;
      return {
        lat: Number.isFinite(lat) ? lat : null,
        lng: Number.isFinite(lng) ? lng : null,
      };
    };
    if (Array.isArray(objetivos)) {
      for (const o of objetivos as Array<Record<string, unknown>>) {
        const oid = String(o?.id ?? '').trim();
        if (!oid) continue;
        if (filt && oid !== filt) continue;
        const name = String(o?.name ?? '').trim() || oid;
        const { lat, lng } = readLatLng(o);
        out.set(oid, { name, clientId: d.id, clientName, lat, lng });
      }
    } else if (!objetivos) {
      if (filt && d.id !== filt) continue;
      const lat = data.lat != null ? Number(data.lat) : NaN;
      const lng = data.lng != null ? Number(data.lng) : NaN;
      out.set(d.id, {
        name: clientName,
        clientId: d.id,
        clientName,
        lat: Number.isFinite(lat) ? lat : null,
        lng: Number.isFinite(lng) ? lng : null,
      });
    }
  }
  return out;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

type FrancoRetRowInternal = {
  employee_firestore_id: string;
  empleado_etiqueta: string;
  codigo: string;
  cliente: string;
  objetivo: string;
  objetivo_id: string;
  hora_inicio_cor: string;
};

async function collectFrancoRetTurnosDia(
  db: FirebaseFirestore.Firestore,
  objectiveMap: Map<string, { name: string; clientId: string; clientName: string }>,
  fecha: string,
  tipo: 'franco' | 'ret' | 'ambos',
): Promise<{ rows: FrancoRetRowInternal[]; truncado: boolean }> {
  const { start, end } = monitorWideWindow(fecha);
  const qsnap = await db
    .collection('turnos')
    .where('startTime', '>=', start)
    .where('startTime', '<=', end)
    .limit(ASSISTANT_TURNOS_DIA_QUERY_LIMIT)
    .get();

  const FRANCO_CODES = new Set(['F', 'FF', 'FP', 'FT']);
  const rows: FrancoRetRowInternal[] = [];

  for (const docSnap of qsnap.docs) {
    const shift = docSnap.data() as Record<string, unknown>;
    if (shift.status === 'Canceled') continue;
    const st = readFirestoreTs(shift, 'startTime');
    if (!st) continue;
    const shiftDateObj = st.toDate();
    if (!isSameCordobaCalendarDay(shiftDateObj, fecha)) continue;

    const oid = String(shift.objectiveId ?? '').trim();
    if (!oid || !objectiveMap.has(oid)) continue;

    const empId = String(shift.employeeId ?? '').trim();
    if (!empId || empId === 'VACANTE') continue;

    const codeRaw = String(shift.code ?? shift.type ?? '').trim();
    const codeU = codeRaw.toUpperCase();
    const isFranco = FRANCO_CODES.has(codeU);
    const isRet = codeU === 'RET';

    const wantF = tipo === 'franco' || tipo === 'ambos';
    const wantR = tipo === 'ret' || tipo === 'ambos';
    if (!(isFranco && wantF) && !(isRet && wantR)) continue;

    const meta = objectiveMap.get(oid)!;
    const nombreEmp = String(shift.employeeName ?? '').trim();
    const etiquetaTurno =
      nombreEmp && !empleadoEtiquetaPareceIdFirestore(nombreEmp, empId) ? nombreEmp : '';
    rows.push({
      employee_firestore_id: empId,
      empleado_etiqueta: etiquetaTurno || empId,
      codigo: codeRaw || codeU,
      cliente: meta.clientName,
      objetivo: meta.name,
      objetivo_id: oid,
      hora_inicio_cor: horaHmCordoba(shiftDateObj),
    });
  }

  rows.sort((a, b) => {
    const c0 = `${a.cliente} ${a.objetivo}`.localeCompare(`${b.cliente} ${b.objetivo}`, 'es');
    if (c0 !== 0) return c0;
    return a.empleado_etiqueta.localeCompare(b.empleado_etiqueta, 'es');
  });

  return { rows, truncado: qsnap.size >= ASSISTANT_TURNOS_DIA_QUERY_LIMIT };
}

function nombreLegibleFromEmpleadoRow(row: Record<string, unknown>): string {
  const ln = String(row.lastName ?? '').trim();
  const fn = String(row.firstName ?? '').trim();
  if (ln && fn) return `${ln} ${fn}`;
  if (ln || fn) return [ln, fn].filter(Boolean).join(' ');
  const nameRaw = String(row.name ?? row.nombre ?? '').trim();
  if (nameRaw) return nameRaw.replace(/,\s*/g, ' ').replace(/\s+/g, ' ').trim();
  return '';
}

function empleadoEtiquetaPareceIdFirestore(etiqueta: string, empId: string): boolean {
  const e = etiqueta.trim();
  if (!e) return true;
  if (e === empId || e === empId.slice(0, 12)) return true;
  return e.length >= 10 && !/\s/.test(e) && /^[a-zA-Z0-9_-]+$/.test(e);
}

/** Mapa id → nombre (misma lógica que Operaciones: apellido + nombre desde RRHH). */
async function empleadosNombreMapEmpresa(
  db: FirebaseFirestore.Firestore,
  empresaId: string,
  scopeEmpresa: boolean,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!empresaId && scopeEmpresa) return out;
  const docs = await queryEmpleadosDocsScoped(db, empresaId, scopeEmpresa, 900);
  for (const d of docs) {
    const row = d.data() as Record<string, unknown>;
    const ln = String(row.lastName ?? '').trim();
    const fn = String(row.firstName ?? '').trim();
    const nombre =
      (ln && fn ? `${ln} ${fn}` : '') ||
      nombreLegibleFromEmpleadoRow(row);
    if (nombre) out.set(d.id, nombre);
  }
  return out;
}

async function empleadosNombresBatch(
  db: FirebaseFirestore.Firestore,
  empresaId: string,
  empIds: string[],
  scopeEmpresa: boolean,
): Promise<Map<string, string>> {
  const out = await empleadosNombreMapEmpresa(db, empresaId, scopeEmpresa);
  const uniq = [...new Set(empIds)].filter(Boolean);
  const missing = uniq.filter((id) => {
    const n = out.get(id);
    return !n || empleadoEtiquetaPareceIdFirestore(n, id);
  });
  if (missing.length === 0) return out;

  const refs = missing.map((id) => db.collection('empleados').doc(id));
  const snaps = await firestoreGetAllRefs(db, refs);
  for (let j = 0; j < snaps.length; j++) {
    const s = snaps[j];
    if (!s.exists) continue;
    const row = s.data() as Record<string, unknown>;
    const empE = String(row.empresaId ?? '').trim();
    if (scopeEmpresa && empresaId && empE.toLowerCase() !== empresaId.toLowerCase()) continue;
    const nombre = nombreLegibleFromEmpleadoRow(row);
    if (nombre) out.set(s.id, nombre);
  }
  return out;
}

function enrichFrancoRetRowsWithNombres(
  rows: FrancoRetRowInternal[],
  nombres: Map<string, string>,
): FrancoRetRowInternal[] {
  return rows.map((r) => {
    const resolved = nombres.get(r.employee_firestore_id);
    if (resolved) return { ...r, empleado_etiqueta: resolved };
    if (empleadoEtiquetaPareceIdFirestore(r.empleado_etiqueta, r.employee_firestore_id)) {
      return { ...r, empleado_etiqueta: '(sin nombre en legajo RRHH)' };
    }
    return r;
  });
}

function etiquetaEmpleadoParaUsuario(etiqueta: string, empId = ''): string {
  if (empleadoEtiquetaPareceIdFirestore(etiqueta, empId || etiqueta)) {
    return '(sin nombre en legajo RRHH)';
  }
  return etiqueta;
}

/** Texto listo para chat: solo nombres legibles, nunca IDs Firestore. */
export function formatListadoFrancoRetParaChat(data: Record<string, unknown>): string {
  const resumen = (data.resumen_por_objetivo ?? []) as Array<{
    cliente: string;
    objetivo: string;
    cantidad: number;
    empleados: string[];
  }>;
  const fecha = String(data.fecha_referencia ?? '').trim();
  const tipo = String(data.tipo_filtro ?? 'franco');
  const cuenta = Number(data.cuenta_filas ?? 0);
  const trunc = data.truncado_consulta_turnos === true;

  let fechaLabel = fecha;
  try {
    const p = parseYmd(fecha);
    fechaLabel = new Intl.DateTimeFormat('es-AR', {
      timeZone: 'America/Argentina/Cordoba',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(new Date(`${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}T12:00:00.000-03:00`));
  } catch {
    /* keep iso */
  }

  const tipoLabel =
    tipo === 'ret' ? 'en **RET**' : tipo === 'ambos' ? 'en **franco** o **RET**' : 'de **franco**';

  if (resumen.length === 0) {
    return `No hay colaboradores ${tipoLabel} registrados en turnos para el **${fechaLabel}**.`;
  }

  let body = `Colaboradores ${tipoLabel} el **${fechaLabel}**`;
  if (cuenta > 0) body += ` (**${cuenta}** turno(s) en total)`;
  body += ':\n\n';

  for (const g of resumen) {
    body += `**${g.cliente}** — **${g.objetivo}** (${g.cantidad}):\n`;
    for (const emp of g.empleados) {
      body += `- **${etiquetaEmpleadoParaUsuario(emp)}**\n`;
    }
    body += '\n';
  }

  if (trunc) {
    body += '*Nota:* la consulta alcanzó el límite de turnos del día; puede haber más registros en **Planificación**.\n';
  }
  return body.trim();
}

function buildFrancoRetResumenPorObjetivo(rows: FrancoRetRowInternal[]): Array<{
  cliente: string;
  objetivo: string;
  cantidad: number;
  empleados: string[];
}> {
  const map = new Map<string, { cliente: string; objetivo: string; empleados: string[] }>();
  for (const r of rows) {
    let g = map.get(r.objetivo_id);
    if (!g) {
      g = { cliente: r.cliente, objetivo: r.objetivo, empleados: [] };
      map.set(r.objetivo_id, g);
    }
    if (!g.empleados.includes(r.empleado_etiqueta)) g.empleados.push(r.empleado_etiqueta);
  }
  return Array.from(map.values())
    .map((g) => ({
      cliente: g.cliente,
      objetivo: g.objetivo,
      cantidad: g.empleados.length,
      empleados: g.empleados.sort((a, b) => a.localeCompare(b, 'es')),
    }))
    .sort((a, b) => `${a.cliente} ${a.objetivo}`.localeCompare(`${b.cliente} ${b.objetivo}`, 'es'));
}

async function empleadosCoordsBatch(
  db: FirebaseFirestore.Firestore,
  empresaId: string,
  empIds: string[],
  scopeEmpresa: boolean,
): Promise<Map<string, { lat: number; lng: number }>> {
  const out = new Map<string, { lat: number; lng: number }>();
  const uniq = [...new Set(empIds)].filter(Boolean);
  const refs = uniq.map((id) => db.collection('empleados').doc(id));
  const snaps = await firestoreGetAllRefs(db, refs);
  for (let j = 0; j < snaps.length; j++) {
    const s = snaps[j];
    if (!s.exists) continue;
    const row = s.data() as Record<string, unknown>;
    const empE = String(row.empresaId ?? '').trim();
    if (scopeEmpresa && empresaId && empE.toLowerCase() !== empresaId.toLowerCase()) continue;
    const lat = row.lat != null ? Number(row.lat) : NaN;
    const lng = row.lng != null ? Number(row.lng) : NaN;
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      out.set(s.id, { lat, lng });
    }
  }
  return out;
}

export async function ejecutarListadoFrancoRetDia(
  ctx: AssistantToolContext,
  args: {
    fecha?: string;
    tipo?: string;
    id_objetivo_cercania?: string;
    limite?: number;
  },
): Promise<Record<string, unknown>> {
  if (!canQueryOperationsDaySummary(ctx)) {
    return { error: 'sin_permiso_requiere_modulo_operaciones_planificacion_o_similar' };
  }

  const fecha = String(args.fecha ?? ctx.referenceDateYsMmDd).trim();
  const tipoRaw = String(args.tipo ?? 'ambos').trim().toLowerCase();
  const tipo: 'franco' | 'ret' | 'ambos' =
    tipoRaw === 'franco' || tipoRaw === 'ret' || tipoRaw === 'ambos' ? (tipoRaw as 'franco' | 'ret' | 'ambos') : 'ambos';

  try {
    parseYmd(fecha);
  } catch (e: any) {
    return { error: e?.message ?? 'fecha_invalida' };
  }

  let lim = Math.floor(Number(args.limite ?? 80));
  if (!Number.isFinite(lim)) lim = 80;
  lim = Math.max(8, Math.min(160, lim));

  const db = admin.firestore();
  const objectiveMap = await objectivesMapForEmpresa(db, ctx.empresaId, undefined, ctx.scopeEmpresa);
  if (objectiveMap.size === 0) {
    return { fecha_referencia: fecha, nota: 'sin_objetivos_para_esta_empresa', cuenta: 0, filas: [] };
  }

  const { rows: rawCollected, truncado } = await collectFrancoRetTurnosDia(db, objectiveMap, fecha, tipo);
  const empIdsAll = [...new Set(rawCollected.map((r) => r.employee_firestore_id))];
  const nombresMap = await empleadosNombresBatch(db, ctx.empresaId, empIdsAll, ctx.scopeEmpresa);
  const raw = enrichFrancoRetRowsWithNombres(rawCollected, nombresMap);
  const resumen_por_objetivo = buildFrancoRetResumenPorObjetivo(raw);

  const idCerc = String(args.id_objetivo_cercania ?? '').trim();
  if (idCerc) {
    const withCoords = await objectivesMapWithCoordsForEmpresa(db, ctx.empresaId, undefined, ctx.scopeEmpresa);
    const target = withCoords.get(idCerc);
    if (!target) {
      return { error: 'objetivo_no_encontrado_en_empresa', hint: 'usar id Firestore del objetivo (CRM).' };
    }
    if (target.lat == null || target.lng == null) {
      return {
        error: 'objetivo_sin_coordenadas_en_crm',
        objetivo: target.name,
        hint: 'Cargá lat/lng del objetivo en Clientes y Objetivos para calcular distancias.',
      };
    }

    const empIds = [...new Set(raw.map((r) => r.employee_firestore_id))];
    const coords = await empleadosCoordsBatch(db, ctx.empresaId, empIds, ctx.scopeEmpresa);

    type Scored = FrancoRetRowInternal & { distancia_km: number | null };
    const scored: Scored[] = [];
    const sinCoord: string[] = [];
    for (const r of raw) {
      const c = coords.get(r.employee_firestore_id);
      if (!c) {
        if (!sinCoord.includes(r.empleado_etiqueta)) sinCoord.push(r.empleado_etiqueta);
        scored.push({ ...r, distancia_km: null });
        continue;
      }
      scored.push({
        ...r,
        distancia_km: haversineKm(c.lat, c.lng, target.lat!, target.lng!),
      });
    }

    scored.sort((a, b) => {
      if (a.distancia_km == null && b.distancia_km == null) return 0;
      if (a.distancia_km == null) return 1;
      if (b.distancia_km == null) return -1;
      return a.distancia_km - b.distancia_km;
    });

    const filas = scored.slice(0, lim).map((r) => ({
      empleado: r.empleado_etiqueta,
      codigo: r.codigo,
      cliente: r.cliente,
      objetivo_turno: r.objetivo,
      hora_inicio_cor: r.hora_inicio_cor,
      distancia_km_al_objetivo_pedido: r.distancia_km != null ? Math.round(r.distancia_km * 100) / 100 : null,
    }));

    const resumenFiltrado = buildFrancoRetResumenPorObjetivo(raw.filter((r) => r.objetivo_id === idCerc));

    return {
      fecha_referencia: fecha,
      tipo_filtro: tipo,
      objetivo_referencia_distancia: { id: idCerc, nombre: target.name, cliente: target.clientName },
      criterios:
        'Turnos del día (zona AR) con código F/FF/FP/FT (franco) o RET, objetivos de la empresa; incluye borradores/planificación. Distancia = Haversine entre lat/lng del legajo (RRHH) y el objetivo pedido.',
      cuenta_filas: raw.filter((r) => r.objetivo_id === idCerc).length,
      truncado_consulta_turnos: truncado,
      muestra_cap: lim,
      filas,
      empleados_sin_coordenadas_en_legajo_muestra: sinCoord.slice(0, 24),
      resumen_por_objetivo: resumenFiltrado,
      nota_tras_herramienta:
        'Ordená por distancia_km_al_objetivo_pedido ascendente; los null no tienen geolocalización en el legajo. Mostrá **empleado** (nombre y apellido); **nunca** IDs Firestore al usuario.',
    };
  }

  const filas = raw.slice(0, lim).map((r) => ({
    empleado: r.empleado_etiqueta,
    codigo: r.codigo,
    cliente: r.cliente,
    objetivo: r.objetivo,
    hora_inicio_cor: r.hora_inicio_cor,
  }));

  return {
    fecha_referencia: fecha,
    tipo_filtro: tipo,
    criterios:
      'Turnos del día (zona AR) con código F/FF/FP/FT (franco) o RET en objetivos de la empresa; incluye planificación/borrador. No es la misma vista filtrada que el monitor de cobertura operativa.',
    cuenta_filas: raw.length,
    truncado_consulta_turnos: truncado,
    muestra_cap: lim,
    resumen_por_objetivo,
    filas,
    nota_tras_herramienta:
      'Para «quién está de franco» o «quién en RET» usá **resumen_por_objetivo** (cliente, objetivo, lista **empleados** con nombres) o filas[].empleado. **Nunca** muestres IDs técnicos de Firestore al usuario. Si pedís cercanía a un objetivo, llamá de nuevo con id_objetivo_cercania.',
  };
}

const LEAVE_SHIFT_CODES = new Set(['V', 'L', 'E', 'A', 'PG', 'AA']);

const RRHH_ABSENCE_TYPE_TO_CODE: Record<string, string> = {
  vacaciones: 'V',
  vacacion: 'V',
  enfermedad: 'E',
  art: 'A',
  autorizada: 'A',
  'licencia esp.': 'L',
  'licencia especial': 'L',
  licencia: 'L',
  'pg permiso gremial': 'PG',
  'permiso gremial': 'PG',
  injustificada: 'AA',
  'falta injustificada': 'AA',
};

function inferAbsenceCodeFromRrhhDoc(doc: Record<string, unknown>): string {
  const direct = String(doc.absenceType ?? '').toUpperCase().trim();
  if (LEAVE_SHIFT_CODES.has(direct)) return direct;
  const code = String(doc.code ?? '').toUpperCase().trim();
  if (LEAVE_SHIFT_CODES.has(code)) return code;
  const typeKey = norm(String(doc.type ?? ''));
  return RRHH_ABSENCE_TYPE_TO_CODE[typeKey] ?? 'L';
}

function ymdInInclusiveRange(fecha: string, start: string, end: string): boolean {
  const f = String(fecha).trim();
  const s = String(start).trim();
  const e = String(end || start).trim();
  if (!f || !s) return false;
  return f >= s && f <= e;
}

type AusenteLicenciaRowInternal = {
  employee_firestore_id: string;
  empleado_etiqueta: string;
  codigo: string;
  categoria: 'ausente_operativo' | 'licencia_turno' | 'licencia_rrhh';
  cliente: string;
  objetivo: string;
  objetivo_id: string;
  hora_inicio_cor: string;
  puesto: string;
  detalle_rrhh?: string;
};

function buildAusentesLicenciasResumenPorObjetivo(rows: AusenteLicenciaRowInternal[]): Array<{
  cliente: string;
  objetivo: string;
  cantidad: number;
  empleados: Array<{ nombre: string; codigo: string; categoria: string }>;
}> {
  const map = new Map<
    string,
    { cliente: string; objetivo: string; empleados: Array<{ nombre: string; codigo: string; categoria: string }> }
  >();
  for (const r of rows) {
    let g = map.get(r.objetivo_id);
    if (!g) {
      g = { cliente: r.cliente, objetivo: r.objetivo, empleados: [] };
      map.set(r.objetivo_id, g);
    }
    g.empleados.push({
      nombre: r.empleado_etiqueta,
      codigo: r.codigo,
      categoria: r.categoria,
    });
  }
  return Array.from(map.values())
    .map((g) => ({
      cliente: g.cliente,
      objetivo: g.objetivo,
      cantidad: g.empleados.length,
      empleados: g.empleados,
    }))
    .sort((a, b) => `${a.cliente} ${a.objetivo}`.localeCompare(`${b.cliente} ${b.objetivo}`, 'es'));
}

function enrichAusentesLicenciasRowsWithNombres(
  rows: AusenteLicenciaRowInternal[],
  nombres: Map<string, string>,
): AusenteLicenciaRowInternal[] {
  return rows.map((r) => {
    if (!r.employee_firestore_id) return r;
    const resolved = nombres.get(r.employee_firestore_id);
    let etiqueta = r.empleado_etiqueta;
    if (resolved) etiqueta = resolved;
    else if (empleadoEtiquetaPareceIdFirestore(etiqueta, r.employee_firestore_id)) {
      etiqueta = '(sin nombre en legajo RRHH)';
    } else {
      etiqueta = etiquetaEmpleadoParaUsuario(etiqueta, r.employee_firestore_id);
    }
    return { ...r, empleado_etiqueta: etiqueta };
  });
}

/** Texto listo para chat: ausentes operativos y/o licencias del día. */
export function formatListadoAusentesLicenciasParaChat(data: Record<string, unknown>): string {
  const fecha = String(data.fecha_referencia ?? '').trim();
  const tipo = String(data.tipo_filtro ?? 'ambos');
  const cuentaAus = Number(data.cuenta_ausentes_operativos ?? 0);
  const cuentaLic = Number(data.cuenta_licencias ?? 0);
  const resumen = (data.resumen_por_objetivo ?? []) as Array<{
    cliente: string;
    objetivo: string;
    cantidad: number;
    empleados: Array<{ nombre: string; codigo: string; categoria: string }>;
  }>;
  const licenciasSinTurno = (data.licencias_rrhh_sin_turno_visible ?? []) as Array<{
    empleado: string;
    codigo: string;
    tipo_rrhh: string;
  }>;
  const trunc = data.truncado_consulta_turnos === true;

  let fechaLabel = fecha;
  try {
    const p = parseYmd(fecha);
    fechaLabel = new Intl.DateTimeFormat('es-AR', {
      timeZone: 'America/Argentina/Cordoba',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(new Date(`${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}T12:00:00.000-03:00`));
  } catch {
    /* keep iso */
  }

  if (tipo === 'ausentes' && cuentaAus === 0) {
    return `No hay colaboradores marcados **ausentes** en **Operaciones** para el **${fechaLabel}**.`;
  }
  if (tipo === 'licencias' && cuentaLic === 0 && licenciasSinTurno.length === 0) {
    return `No hay colaboradores con **licencia** registrada para el **${fechaLabel}**.`;
  }
  if (cuentaAus === 0 && cuentaLic === 0 && licenciasSinTurno.length === 0) {
    return `No hay **ausentes** ni **licencias** registradas para el **${fechaLabel}**.`;
  }

  let body = '';
  if (tipo === 'ausentes' || tipo === 'ambos') {
    body += `**Ausentes** en Operaciones el **${fechaLabel}** (**${cuentaAus}**):\n\n`;
  } else {
    body += `**Licencias** el **${fechaLabel}** (**${cuentaLic}** en turnos + RRHH):\n\n`;
  }

  const rowsToShow =
    tipo === 'licencias'
      ? resumen.map((g) => ({
          ...g,
          empleados: g.empleados.filter((e) => e.categoria !== 'ausente_operativo'),
          cantidad: g.empleados.filter((e) => e.categoria !== 'ausente_operativo').length,
        })).filter((g) => g.cantidad > 0)
      : tipo === 'ausentes'
        ? resumen.map((g) => ({
            ...g,
            empleados: g.empleados.filter((e) => e.categoria === 'ausente_operativo'),
            cantidad: g.empleados.filter((e) => e.categoria === 'ausente_operativo').length,
          })).filter((g) => g.cantidad > 0)
        : resumen;

  if (rowsToShow.length === 0 && tipo !== 'licencias') {
    body += 'Ninguno por objetivo en la muestra consultada.\n\n';
  }

  for (const g of rowsToShow) {
    body += `**${g.cliente}** — **${g.objetivo}** (${g.cantidad}):\n`;
    for (const emp of g.empleados) {
      const catLabel =
        emp.categoria === 'ausente_operativo'
          ? 'ausente'
          : emp.categoria === 'licencia_rrhh'
            ? 'licencia RRHH'
            : 'licencia';
      body += `- **${etiquetaEmpleadoParaUsuario(emp.nombre)}** — ${emp.codigo} (${catLabel})\n`;
    }
    body += '\n';
  }

  if ((tipo === 'licencias' || tipo === 'ambos') && licenciasSinTurno.length > 0) {
    body += `**Licencias en RRHH** sin turno visible ese día:\n`;
    for (const r of licenciasSinTurno.slice(0, 40)) {
      body += `- **${etiquetaEmpleadoParaUsuario(r.empleado)}** — ${r.codigo} (${r.tipo_rrhh})\n`;
    }
    body += '\n';
  }

  if (trunc) {
    body += '*Nota:* la consulta alcanzó el límite de turnos del día; puede haber más registros en **Operaciones** o **RRHH**.\n';
  }
  return body.trim();
}

export async function ejecutarListadoAusentesLicenciasDia(
  ctx: AssistantToolContext,
  args: {
    fecha?: string;
    id_objetivo?: string;
    tipo?: string;
    limite?: number;
  },
): Promise<Record<string, unknown>> {
  if (!canQueryOperationsDaySummary(ctx)) {
    return { error: 'sin_permiso_requiere_modulo_operaciones_planificacion_o_similar' };
  }

  const fecha = String(args.fecha ?? ctx.referenceDateYsMmDd).trim();
  const tipoRaw = String(args.tipo ?? 'ambos').trim().toLowerCase();
  const tipo: 'ausentes' | 'licencias' | 'ambos' =
    tipoRaw === 'ausentes' || tipoRaw === 'licencias' || tipoRaw === 'ambos'
      ? (tipoRaw as 'ausentes' | 'licencias' | 'ambos')
      : 'ambos';

  try {
    parseYmd(fecha);
  } catch (e: any) {
    return { error: e?.message ?? 'fecha_invalida' };
  }

  let lim = Math.floor(Number(args.limite ?? 120));
  if (!Number.isFinite(lim)) lim = 120;
  lim = Math.max(8, Math.min(160, lim));

  const db = admin.firestore();
  const filterObj = String(args.id_objetivo ?? '').trim() || undefined;
  const objectiveMap = await objectivesMapForEmpresa(db, ctx.empresaId, filterObj, ctx.scopeEmpresa);
  if (objectiveMap.size === 0) {
    return {
      fecha_referencia: fecha,
      nota: filterObj ? 'objetivo_no_encontrado_en_empresa' : 'sin_objetivos_para_esta_empresa',
      cuenta_ausentes_operativos: 0,
      cuenta_licencias: 0,
      resumen_por_objetivo: [],
      filas: [],
    };
  }

  let visibleRows: OperacionesDiaRowPublico[];
  let truncadoConsultaTurnos: boolean;
  try {
    ({ rows: visibleRows, truncadoConsultaTurnos } = await queryTurnosVisiblesOperacionesEmpresaDia(
      db,
      ctx.empresaId,
      objectiveMap,
      fecha,
      ctx.scopeEmpresa,
    ));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: 'error_consulta_turnos_operaciones', detalle: msg.slice(0, 280) };
  }

  const collected: AusenteLicenciaRowInternal[] = [];
  const seenTurnoKeys = new Set<string>();

  for (const r of visibleRows) {
    if (!r.employee_firestore_id) continue;
    const codeU = String(r.codigo ?? '').trim().toUpperCase();
    const keyBase = `${r.employee_firestore_id}|${r.oid}|${codeU}`;

    if (r.isAbsent && (tipo === 'ausentes' || tipo === 'ambos')) {
      if (seenTurnoKeys.has(`aus|${keyBase}`)) continue;
      seenTurnoKeys.add(`aus|${keyBase}`);
      collected.push({
        employee_firestore_id: r.employee_firestore_id,
        empleado_etiqueta: r.empleado_etiqueta,
        codigo: r.codigo || 'AA',
        categoria: 'ausente_operativo',
        cliente: r.cliente,
        objetivo: r.objetivo_nombre,
        objetivo_id: r.oid,
        hora_inicio_cor: r.h_inicio_cordoba,
        puesto: r.puesto,
      });
    }

    if (
      !r.isAbsent &&
      !r.isPresent &&
      LEAVE_SHIFT_CODES.has(codeU) &&
      (tipo === 'licencias' || tipo === 'ambos')
    ) {
      if (seenTurnoKeys.has(`lic|${keyBase}`)) continue;
      seenTurnoKeys.add(`lic|${keyBase}`);
      collected.push({
        employee_firestore_id: r.employee_firestore_id,
        empleado_etiqueta: r.empleado_etiqueta,
        codigo: codeU,
        categoria: 'licencia_turno',
        cliente: r.cliente,
        objetivo: r.objetivo_nombre,
        objetivo_id: r.oid,
        hora_inicio_cor: r.h_inicio_cordoba,
        puesto: r.puesto,
      });
    }
  }

  const licenciasRrhhSinTurno: Array<{ employeeId: string; empleado: string; codigo: string; tipo_rrhh: string }> =
    [];
  const empIdsFromTurnos = new Set(collected.map((r) => r.employee_firestore_id));

  if (tipo === 'licencias' || tipo === 'ambos') {
    const ausDocs = await queryCollectionDocsScoped(db, 'ausencias', ctx.empresaId, ctx.scopeEmpresa, 600);
    for (const docSnap of ausDocs) {
      const row = docSnap.data() as Record<string, unknown>;
      if (!belongsToEmpresa(row, ctx.empresaId, ctx.scopeEmpresa)) continue;
      const status = String(row.status ?? '').trim();
      if (/^rechazada$/i.test(status)) continue;
      const startDate = String(row.startDate ?? '').trim();
      const endDate = String(row.endDate ?? startDate).trim();
      if (!ymdInInclusiveRange(fecha, startDate, endDate)) continue;

      const empId = String(row.employeeId ?? '').trim();
      if (!empId) continue;
      const code = inferAbsenceCodeFromRrhhDoc(row);
      const tipoRrhh = String(row.type ?? row.reason ?? 'Licencia').trim();
      const nombreEmp = String(row.employeeName ?? '').trim();

      if (empIdsFromTurnos.has(empId)) continue;

      licenciasRrhhSinTurno.push({
        employeeId: empId,
        empleado: nombreEmp || empId.slice(0, 12),
        codigo: code,
        tipo_rrhh: tipoRrhh,
      });
    }
  }

  const empIdsAll = [
    ...new Set([
      ...collected.map((r) => r.employee_firestore_id),
      ...licenciasRrhhSinTurno.map((r) => r.employeeId),
    ]),
  ];
  const nombresMap = await empleadosNombresBatch(db, ctx.empresaId, empIdsAll, ctx.scopeEmpresa);
  const enriched = enrichAusentesLicenciasRowsWithNombres(collected, nombresMap);
  const resumen_por_objetivo = buildAusentesLicenciasResumenPorObjetivo(enriched);

  const licenciasSinTurnoVisible = licenciasRrhhSinTurno.map((r) => {
    const resolved = nombresMap.get(r.employeeId);
    const empleado =
      resolved ||
      (empleadoEtiquetaPareceIdFirestore(r.empleado, r.employeeId)
        ? '(sin nombre en legajo RRHH)'
        : r.empleado);
    return { empleado, codigo: r.codigo, tipo_rrhh: r.tipo_rrhh };
  });

  const cuentaAus = enriched.filter((r) => r.categoria === 'ausente_operativo').length;
  const cuentaLicTurno = enriched.filter((r) => r.categoria !== 'ausente_operativo').length;
  const cuentaLic = cuentaLicTurno + licenciasSinTurnoVisible.length;

  const filas = enriched.slice(0, lim).map((r) => ({
    empleado: r.empleado_etiqueta,
    codigo: r.codigo,
    categoria: r.categoria,
    cliente: r.cliente,
    objetivo: r.objetivo,
    hora_inicio_cor: r.hora_inicio_cor,
    puesto: r.puesto,
  }));

  return {
    fecha_referencia: fecha,
    tipo_filtro: tipo,
    criterios:
      'Ausentes operativos = turnos visibles (Operaciones) con isAbsent true. Licencias = códigos V/L/E/A/PG/AA en turnos visibles sin presente, más docs ausencias RRHH que cubren la fecha.',
    cuenta_ausentes_operativos: cuentaAus,
    cuenta_licencias: cuentaLic,
    cuenta_licencias_en_turnos: cuentaLicTurno,
    cuenta_licencias_rrhh_sin_turno: licenciasSinTurnoVisible.length,
    truncado_consulta_turnos: truncadoConsultaTurnos,
    resumen_por_objetivo,
    licencias_rrhh_sin_turno: licenciasSinTurnoVisible.slice(0, 48),
    filas,
    nota_tras_herramienta:
      '**Faltaron / ausentes** ≠ **franco (F)**. Respondé con resumen_por_objetivo y nombres legibles; nunca IDs Firestore. Si preguntan licencias, incluí licencias_rrhh_sin_turno.',
  };
}

export function assistantToolsEnabledForContext(ctx: AssistantToolContext): boolean {
  if (!ctx.empresaId) return false;
  if (ctx.persona === 'CLIENT') return false;
  return (
    canQueryShifts(ctx) ||
    canUseEmployeeSearch(ctx) ||
    canQueryServiciosSlaResumen(ctx) ||
    canQueryEmpleadosPlantillaResumen(ctx) ||
    canSearchObjectivesCrm(ctx)
  );
}

function parseYmd(s: string): { y: number; m: number; d: number } {
  const rex = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s).trim());
  if (!rex) throw new Error('fecha debe ser YYYY-MM-DD');
  const y = Number(rex[1]);
  const mo = Number(rex[2]);
  const d = Number(rex[3]);
  if (!y || mo < 1 || mo > 12 || d < 1 || d > 31) throw new Error('fecha inválida');
  return { y, m: mo, d };
}

function slaCampoFechaYmD(raw: unknown): string {
  if (raw == null) return '';
  if (typeof raw === 'string') return raw.trim().slice(0, 10);
  if (raw instanceof Timestamp) {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Argentina/Cordoba',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(raw.toDate());
  }
  if (typeof raw === 'object' && raw !== null && 'seconds' in raw) {
    const o = raw as { seconds: number; nanoseconds?: number };
    try {
      const ts = new Timestamp(o.seconds, o.nanoseconds ?? 0);
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Argentina/Cordoba',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(ts.toDate());
    } catch {
      return '';
    }
  }
  return '';
}

async function empresaClientIdsSet(
  db: FirebaseFirestore.Firestore,
  empresaId: string,
  scopeEmpresa: boolean,
): Promise<Set<string>> {
  return empresaClientIdsSetScoped(db, empresaId, scopeEmpresa);
}

function chunkIds<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** Misma comparación por strings YYYY-MM-DD que dashboard.tsx y KPI en Servicios (solapa el mes de referencia). */
function servicioSlaSolapaMesReferencia(desdeYmd: string, hastaYmd: string, refYmd: string): boolean {
  const ym = refYmd.slice(0, 7);
  const sd = (desdeYmd || '').trim().slice(0, 10);
  const ed = (hastaYmd || '').trim().slice(0, 10);
  if (sd.length < 10 || ed.length < 10) return false;
  return sd <= `${ym}-31` && ed >= `${ym}-01`;
}

function servicioSlaVigenteEnDiaInclusivo(desdeYmd: string, hastaYmd: string, refYmd: string): boolean {
  const sd = (desdeYmd || '').trim().slice(0, 10);
  const ed = (hastaYmd || '').trim().slice(0, 10);
  if (sd.length < 10 || ed.length < 10) return false;
  return sd <= refYmd && ed >= refYmd;
}

/** Alineado a badges «Activo» en UI: activo/active/activa o sin estado; excluye inactive/inactivo. */
function slaStatusOperativoComoPantallaServicios(row: Record<string, unknown>): boolean {
  const s = String(row.status ?? '').trim().toLowerCase();
  if (!s) return true;
  if (s === 'active' || s === 'activo' || s === 'activa') return true;
  if (s === 'inactive' || s === 'inactivo' || s === 'expired' || s === 'vencido') return false;
  return true;
}

/** Inicio inclusivo AR y fin inclusivo para rango ISO (mismo día válido si from===to). */
function arRangeTimestamps(desdeYsMmDd: string, hastaYsMmDd: string): { start: FirebaseFirestore.Timestamp; end: FirebaseFirestore.Timestamp } {
  const a = parseYmd(desdeYsMmDd);
  const b = parseYmd(hastaYsMmDd);
  const t0 = Date.parse(`${a.y}-${String(a.m).padStart(2, '0')}-${String(a.d).padStart(2, '0')}T00:00:00.000${AR_DAY_OFFSET}`);
  const t1 = Date.parse(`${b.y}-${String(b.m).padStart(2, '0')}-${String(b.d).padStart(2, '0')}T23:59:59.999${AR_DAY_OFFSET}`);
  if (Number.isNaN(t0) || Number.isNaN(t1) || t1 < t0) throw new Error('rango de fechas inválido');
  if ((t1 - t0) / 86400000 > 98) throw new Error('el rango no puede superar ~98 días');
  return {
    start: Timestamp.fromMillis(t0),
    end: Timestamp.fromMillis(t1),
  };
}

async function assertEmployeeInEmpresa(
  db: FirebaseFirestore.Firestore,
  employeeDocId: string,
  empresaId: string,
  scopeEmpresa: boolean,
): Promise<FirebaseFirestore.DocumentData | null> {
  const ref = db.collection('empleados').doc(employeeDocId);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  if (!belongsToEmpresa(data, empresaId, scopeEmpresa)) return null;
  return data;
}

export async function resolveSelfEmployeeFirestoreId(uid: string): Promise<string | null> {
  const db = admin.firestore();
  const q = await db.collection('empleados').where('uid', '==', uid).limit(1).get();
  if (q.empty) return null;
  return q.docs[0].id;
}

export async function ejecutarBuscarEmpleadosPorNombre(
  ctx: AssistantToolContext,
  args: { texto?: string; limite?: number },
): Promise<Record<string, unknown>> {
  if (!canUseEmployeeSearch(ctx)) {
    return { error: 'sin_permiso_para_buscar_personal' };
  }
  const textoRaw = String(args.texto ?? '').trim();
  if (textoRaw.length < 2) return { error: 'pedir_al_usuario_fragmento_de_nombre_mas_largo' };

  let limite = Math.floor(Number(args.limite ?? 8));
  if (!Number.isFinite(limite) || limite < 1) limite = 8;
  limite = Math.min(15, limite);

  const db = admin.firestore();
  const empDocs = await queryEmpleadosDocsScoped(db, ctx.empresaId, ctx.scopeEmpresa, 400);
  const needle = norm(textoRaw.replace(/,/g, ' ').replace(/\s+/g, ' '));
  type Row = { id: string; nombre: string | null; clienteId?: string; preferredObjectiveId?: string };
  const out: Row[] = [];
  for (const d of empDocs) {
    const data = d.data() as Record<string, unknown>;
    const hay = buildEmpleadoSearchHaystack(data);
    if (!hay) continue;
    if (!matchesEmpleadoSearchNeedle(needle, hay)) continue;

    const ln = String(data.lastName ?? '').trim();
    const fn = String(data.firstName ?? '').trim();
    const name = String(data.name ?? data.nombre ?? '').trim();
    const nombreLegible =
      [ln, fn].filter(Boolean).join(', ') ||
      name ||
      [fn, ln].filter(Boolean).join(' ') ||
      '(sin nombre en legajo)';

    out.push({
      id: d.id,
      nombre: nombreLegible,
      clienteId: (data.clientId as string | undefined) ?? undefined,
      preferredObjectiveId: (data.preferredObjectiveId as string | undefined) ?? undefined,
    });
    if (out.length >= limite * 4) break;
  }

  const sliced = out.slice(0, limite);
  if (sliced.length === 0) {
    return {
      coincidencias: [],
      nota: 'ningún resultado; probá apellido, nombre, ambos en cualquier orden, o número de legajo (fileNumber)',
    };
  }

  const ambigua = sliced.length >= 2;
  return {
    coincidencias: sliced.map((r) => ({ idFirestore: r.id, nombreLegible: r.nombre })),
    ambigua,
    nota_ambigua:
      ambigua && sliced.length <= limite
        ? 'varias personas similares: pedí al usuario aclaración o segundo apellido y volvé a buscar antes de declarar estado de presencia.'
        : undefined,
    nota_tras_herramienta:
      'La búsqueda usa apellido, nombre, el campo name del legajo (incluye formato «APELLIDO, NOMBRE») y legajo; el orden de las palabras que escribió el usuario no importa si todas las partes aparecen en el legajo.',
  };
}

/**
 * Lista legajos de la empresa con nombre legible (y opcionalmente filtro como buscar_empleados_por_nombre).
 * Para «quiénes trabajan acá», «nómina de nombres», «listado de empleados».
 */
export async function ejecutarListadoEmpleadosEmpresa(
  ctx: AssistantToolContext,
  args: { filtro_texto?: string; limite?: number; solo_activos_nomina_panel?: boolean },
): Promise<Record<string, unknown>> {
  if (!canUseEmployeeSearch(ctx)) {
    return { error: 'sin_permiso_para_buscar_personal' };
  }

  let limite = Math.floor(Number(args.limite ?? 48));
  if (!Number.isFinite(limite) || limite < 8) limite = 48;
  limite = Math.min(120, limite);

  const filtroRaw = String(args.filtro_texto ?? '').trim();
  const needle = filtroRaw.length >= 2 ? norm(filtroRaw.replace(/,/g, ' ').replace(/\s+/g, ' ')) : '';
  const soloPanel = args.solo_activos_nomina_panel === true;

  const db = admin.firestore();
  const qsnap = await queryEmpleadosDocsScoped(db, ctx.empresaId, ctx.scopeEmpresa, 900);

  type Row = { id: string; nombreLegible: string; legajo: string; estado: string; sortKey: string };
  const rows: Row[] = [];

  for (const d of qsnap) {
    const data = d.data() as Record<string, unknown>;
    if (soloPanel && !esEmpleadoNominaTarjetaDashboard(data.status)) continue;

    const ln = String(data.lastName ?? '').trim();
    const fn = String(data.firstName ?? '').trim();
    const nombreLegible =
      [ln, fn].filter(Boolean).join(', ') ||
      String(data.name ?? data.nombre ?? '').trim() ||
      '(sin nombre en legajo)';

    const hay = buildEmpleadoSearchHaystack(data);
    const effectiveHay = hay || norm(nombreLegible.replace(/,/g, ' ').replace(/\s+/g, ' '));

    if (needle) {
      if (!matchesEmpleadoSearchNeedle(needle, effectiveHay)) continue;
    }

    const sortKey = norm(`${ln} ${fn} ${nombreLegible}`);
    rows.push({
      id: d.id,
      nombreLegible: nombreLegible.slice(0, 120),
      legajo: String(data.fileNumber ?? '').trim(),
      estado: String(data.status ?? '').trim(),
      sortKey,
    });
  }

  rows.sort((a, b) => a.sortKey.localeCompare(b.sortKey, 'es', { sensitivity: 'base' }));

  const sliced = rows.slice(0, limite);
  const truncadoLista = rows.length > limite;
  const truncadoFirestore = qsnap.length >= 900;

  return {
    filtro_texto_usado: filtroRaw || null,
    solo_activos_nomina_panel: soloPanel,
    cuenta_en_resultado: rows.length,
    muestra_empleados: sliced.map((r) => ({
      id_firestore: r.id,
      nombre: r.nombreLegible,
      legajo: r.legajo || undefined,
      estado: r.estado || undefined,
    })),
    truncado_por_limite_muestra: truncadoLista,
    truncado_loteFirestore_900: truncadoFirestore,
    nota_tras_herramienta:
      'Listá nombres tal cual vienen en muestra_empleados; no inventes filas. Si truncado_por_limite_muestra o truncado_loteFirestore_900, pedí acotar con filtro_texto (apellido o legajo) o más contexto en Reportes/RRHH. Para una persona puntual seguí usando buscar_empleados_por_nombre.',
  };
}

export async function ejecutarBuscarObjetivosPorNombre(
  ctx: AssistantToolContext,
  args: { texto?: string; limite?: number },
): Promise<Record<string, unknown>> {
  if (!canSearchObjectivesCrm(ctx)) {
    return { error: 'sin_permiso_buscar_objetivos_crm' };
  }
  const textoRaw = String(args.texto ?? '').trim();
  if (textoRaw.length < 2) return { error: 'pedir_fragmento_de_nombre_mas_largo' };

  let limite = Math.floor(Number(args.limite ?? 12));
  if (!Number.isFinite(limite) || limite < 1) limite = 12;
  limite = Math.min(20, limite);

  const db = admin.firestore();
  const snap = await queryClientsDocsScoped(db, ctx.empresaId, ctx.scopeEmpresa, 480);
  type ObjRow = {
    id_objetivo: string;
    nombre_objetivo: string;
    id_cliente: string;
    nombre_cliente: string;
    tiene_coordenadas: boolean;
  };
  const out: ObjRow[] = [];

  const pushObj = (clientDocId: string, clientName: string, oid: string, oname: string, o: Record<string, unknown>) => {
    const lat = o?.lat != null ? Number(o.lat) : NaN;
    const lng = o?.lng != null ? Number(o.lng) : NaN;
    const has = Number.isFinite(lat) && Number.isFinite(lng);
    out.push({
      id_objetivo: oid,
      nombre_objetivo: oname.slice(0, 120),
      id_cliente: clientDocId,
      nombre_cliente: clientName.slice(0, 120),
      tiene_coordenadas: has,
    });
  };

  for (const d of snap) {
    const data = d.data() as Record<string, unknown>;
    const clientName = String(data.name ?? '').trim() || d.id;
    const objetivosRaw = data.objetivos ?? data.objectives;
    const objetivos = Array.isArray(objetivosRaw) ? objetivosRaw : undefined;
    if (Array.isArray(objetivos)) {
      for (const o of objetivos as Array<Record<string, unknown>>) {
        const oid = String(o?.id ?? '').trim();
        if (!oid) continue;
        const oname = String(o?.name ?? '').trim() || oid;
        if (!objectiveHaystackMatchesNeedle(textoRaw, oname, clientName)) continue;
        pushObj(d.id, clientName, oid, oname, o);
        if (out.length >= limite * 5) break;
      }
    } else if (!objetivos) {
      const oid = d.id;
      const oname = clientName;
      if (!objectiveHaystackMatchesNeedle(textoRaw, oname, clientName)) continue;
      pushObj(d.id, clientName, oid, oname, data as Record<string, unknown>);
    }
    if (out.length >= limite * 5) break;
  }

  const sliced = out.slice(0, limite);
  if (sliced.length === 0) {
    return { coincidencias: [], nota: 'ningún objetivo; probá otro fragmento del nombre del sitio o del cliente' };
  }

  const ambigua = sliced.length >= 2;
  return {
    coincidencias: sliced.map((r) => ({
      id_objetivo: r.id_objetivo,
      nombre_objetivo: r.nombre_objetivo,
      id_cliente: r.id_cliente,
      nombre_cliente: r.nombre_cliente,
      tiene_coordenadas: r.tiene_coordenadas,
    })),
    ambigua,
    nota_tras_herramienta:
      (ambigua
        ? 'Varias sedes: pedí aclaración (cliente o parte del nombre) o que el usuario elija id_objetivo antes de listado_franco_ret_dia con id_objetivo_cercania.'
        : 'Si el usuario sólo dijo el nombre del sitio, usá id_objetivo de la coincidencia en listado_franco_ret_dia(id_objetivo_cercania=…).') +
      ' No inventes ids.',
  };
}

export async function ejecutarContarClientesEmpresa(
  ctx: AssistantToolContext,
  _args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!canQueryClientsCrm(ctx)) {
    return { error: 'sin_permiso_crm_clientes_requiere_modulo_clientes_o_similar' };
  }

  const db = admin.firestore();
  const snap = await queryClientsDocsScoped(db, ctx.empresaId, ctx.scopeEmpresa, 480);

  let activos = 0;
  let inactivos = 0;
  let objetivosTotal = 0;
  const muestraActivos: string[] = [];

  for (const d of snap) {
    const data = d.data() as Record<string, unknown>;
    const st = String(data.status ?? 'ACTIVO').trim().toUpperCase();
    const inactivo = st === 'INACTIVO';
    if (inactivo) inactivos += 1;
    else activos += 1;

    const objsRaw = data.objetivos ?? data.objectives;
    if (Array.isArray(objsRaw)) objetivosTotal += objsRaw.length;

    const cname = String(data.name ?? '').trim() || d.id;
    if (!inactivo && muestraActivos.length < 10) muestraActivos.push(cname.slice(0, 100));
  }

  return {
    cuenta_clientes_activos: activos,
    cuenta_clientes_inactivos: inactivos,
    cuenta_total_clientes: activos + inactivos,
    cuenta_objetivos_embebidos_en_clientes: objetivosTotal,
    truncado_loteFirestore_480: snap.length >= 480,
    muestra_primeros_clientes_activos: muestraActivos,
    nota_tras_herramienta:
      'Respondé cuenta_clientes_activos (o total si preguntan todos) en la primera oración. Para **lista completa** de nombres usá **listado_clientes_empresa**, no esta muestra de 10.',
  };
}

/** Lista nombres de clientes CRM (activos por defecto). Hasta ~120 filas. */
export async function ejecutarListadoClientesEmpresa(
  ctx: AssistantToolContext,
  args: { solo_activos?: boolean; limite?: number },
): Promise<Record<string, unknown>> {
  if (!canQueryClientsCrm(ctx)) {
    return { error: 'sin_permiso_crm_clientes_requiere_modulo_clientes_o_similar' };
  }

  let limite = Math.floor(Number(args.limite ?? 120));
  if (!Number.isFinite(limite) || limite < 8) limite = 120;
  limite = Math.min(120, limite);
  const soloActivos = args.solo_activos !== false;

  const db = admin.firestore();
  const snap = await queryClientsDocsScoped(db, ctx.empresaId, ctx.scopeEmpresa, 480);

  type Row = { nombre: string; status: string; sortKey: string };
  const rows: Row[] = [];
  let activos = 0;
  let inactivos = 0;

  for (const d of snap) {
    const data = d.data() as Record<string, unknown>;
    const st = String(data.status ?? 'ACTIVO').trim().toUpperCase();
    const inactivo = st === 'INACTIVO';
    if (inactivo) inactivos += 1;
    else activos += 1;
    if (soloActivos && inactivo) continue;

    const nombre = String(data.name ?? '').trim() || d.id;
    rows.push({
      nombre: nombre.slice(0, 120),
      status: st || 'ACTIVO',
      sortKey: norm(nombre),
    });
  }

  rows.sort((a, b) => a.sortKey.localeCompare(b.sortKey, 'es', { sensitivity: 'base' }));
  const sliced = rows.slice(0, limite);

  return {
    solo_activos: soloActivos,
    cuenta_clientes_activos: activos,
    cuenta_clientes_inactivos: inactivos,
    cuenta_en_resultado: sliced.length,
    muestra_clientes: sliced.map((r) => ({ nombre: r.nombre, status: r.status })),
    truncado_por_limite_muestra: rows.length > limite,
    truncado_loteFirestore_480: snap.length >= 480,
    nota_tras_herramienta:
      'Listá **todos** los nombres de muestra_clientes en orden alfabético. Si cuenta_en_resultado < cuenta_clientes_activos, decí cuántos faltan por límite del chat; no digas «lista completa» si truncado_por_limite_muestra.',
  };
}

function campoCrmLleno(val: unknown): boolean {
  if (val == null) return false;
  if (typeof val === 'number') return Number.isFinite(val);
  return String(val).trim().length > 0;
}

function objetivosClienteCrm(data: Record<string, unknown>): Array<Record<string, unknown>> {
  const raw = data.objetivos ?? data.objectives;
  if (!Array.isArray(raw)) return [];
  return raw.filter((o) => o && typeof o === 'object') as Array<Record<string, unknown>>;
}

function auditarCompletitudClienteCrm(data: Record<string, unknown>): {
  completo: boolean;
  campos_faltantes: string[];
  advertencias_objetivos: string[];
  cantidad_objetivos: number;
} {
  const campos_faltantes: string[] = [];
  const advertencias_objetivos: string[] = [];

  if (!campoCrmLleno(data.taxId)) campos_faltantes.push('CUIT');
  if (!campoCrmLleno(data.legalName)) campos_faltantes.push('razón social');
  const tieneContacto =
    campoCrmLleno(data.contactName) || campoCrmLleno(data.phone) || campoCrmLleno(data.email);
  if (!tieneContacto) campos_faltantes.push('contacto (nombre, teléfono o email)');
  if (!campoCrmLleno(data.address) && !campoCrmLleno(data.city)) {
    campos_faltantes.push('dirección o ciudad');
  }

  const objs = objetivosClienteCrm(data);
  if (objs.length === 0) {
    campos_faltantes.push('objetivo/sede (al menos uno)');
  } else {
    for (const o of objs) {
      const oname = String(o.name ?? '').trim() || 'objetivo sin nombre';
      if (!campoCrmLleno(o.name)) {
        advertencias_objetivos.push(`${oname}: sin nombre`);
        continue;
      }
      if (!campoCrmLleno(o.address)) advertencias_objetivos.push(`${oname}: sin dirección`);
      const lat = o.lat ?? o.latitude;
      const lng = o.lng ?? o.longitude;
      const tieneCoords =
        lat != null &&
        lng != null &&
        String(lat).trim() !== '' &&
        String(lng).trim() !== '' &&
        Number.isFinite(Number(lat)) &&
        Number.isFinite(Number(lng));
      if (campoCrmLleno(o.address) && !tieneCoords) {
        advertencias_objetivos.push(`${oname}: sin coordenadas GPS`);
      }
    }
  }

  return {
    completo: campos_faltantes.length === 0,
    campos_faltantes,
    advertencias_objetivos,
    cantidad_objetivos: objs.length,
  };
}

/** Audita campos recomendados de clientes CRM (CUIT, contacto, objetivos, etc.). */
export async function ejecutarAuditarCompletitudDatosClientesEmpresa(
  ctx: AssistantToolContext,
  args: { solo_activos?: boolean; limite?: number; texto_cliente?: string },
): Promise<Record<string, unknown>> {
  if (!canQueryClientsCrm(ctx)) {
    return { error: 'sin_permiso_crm_clientes_requiere_modulo_clientes_o_similar' };
  }

  let limite = Math.floor(Number(args.limite ?? 45));
  if (!Number.isFinite(limite) || limite < 5) limite = 45;
  limite = Math.min(60, limite);
  const soloActivos = args.solo_activos !== false;
  const filtroCliente = String(args.texto_cliente ?? '').trim().toLowerCase();

  const db = admin.firestore();
  const snap = await queryClientsDocsScoped(db, ctx.empresaId, ctx.scopeEmpresa, 480);

  type Row = {
    nombre: string;
    id_cliente: string;
    status: string;
    completo: boolean;
    campos_faltantes: string[];
    advertencias_objetivos: string[];
    cantidad_objetivos: number;
    sortKey: string;
  };

  const rows: Row[] = [];
  let activos = 0;
  let inactivos = 0;
  let completos = 0;
  let incompletos = 0;

  for (const d of snap) {
    const data = d.data() as Record<string, unknown>;
    const st = String(data.status ?? 'ACTIVO').trim().toUpperCase();
    const inactivo = st === 'INACTIVO';
    if (inactivo) inactivos += 1;
    else activos += 1;
    if (soloActivos && inactivo) continue;

    const nombre = String(data.name ?? '').trim() || d.id;
    if (filtroCliente.length >= 2 && !norm(nombre).includes(norm(filtroCliente))) continue;

    const audit = auditarCompletitudClienteCrm(data);
    if (audit.completo) completos += 1;
    else incompletos += 1;

    rows.push({
      nombre: nombre.slice(0, 120),
      id_cliente: d.id,
      status: st || 'ACTIVO',
      completo: audit.completo,
      campos_faltantes: audit.campos_faltantes,
      advertencias_objetivos: audit.advertencias_objetivos.slice(0, 6),
      cantidad_objetivos: audit.cantidad_objetivos,
      sortKey: norm(nombre),
    });
  }

  rows.sort((a, b) => a.sortKey.localeCompare(b.sortKey, 'es', { sensitivity: 'base' }));
  const evaluados = rows.length;
  const incompletosRows = rows.filter((r) => !r.completo);
  const muestraIncompletos = incompletosRows.slice(0, limite).map((r) => ({
    nombre: r.nombre,
    status: r.status,
    campos_faltantes: r.campos_faltantes,
    advertencias_objetivos: r.advertencias_objetivos,
    cantidad_objetivos: r.cantidad_objetivos,
  }));

  return {
    solo_activos: soloActivos,
    filtro_texto_cliente: filtroCliente || undefined,
    cuenta_clientes_activos: activos,
    cuenta_clientes_inactivos: inactivos,
    cuenta_evaluados: evaluados,
    cuenta_completos: completos,
    cuenta_incompletos: incompletos,
    criterios_completitud: [
      'CUIT (taxId)',
      'razón social (legalName)',
      'contacto: nombre, teléfono o email',
      'dirección o ciudad',
      'al menos un objetivo/sede con nombre',
    ],
    advertencias_objetivos_no_bloquean:
      'Objetivos sin dirección o sin GPS se listan como advertencia; no impiden marcar al cliente como completo.',
    clientes_incompletos: muestraIncompletos,
    truncado_incompletos: incompletosRows.length > limite,
    truncado_loteFirestore_480: snap.length >= 480,
    pasos_completar_en_crm:
      'Clientes y Objetivos → elegir cliente → Datos fiscales (CUIT, razón social, contacto) → pestaña Objetivos (nombre, dirección, GPS).',
    nota_tras_herramienta:
      'Respondé cuántos completos vs incompletos. Listá **todos** los de clientes_incompletos con campos_faltantes. Si cuenta_incompletos=0, decí que están completos según criterios CRM. Indicá pasos_completar_en_crm si hay faltantes.',
  };
}

export async function ejecutarListarObjetivosCliente(
  ctx: AssistantToolContext,
  args: { texto_cliente?: string; limite?: number },
): Promise<Record<string, unknown>> {
  if (!canQueryClientsCrm(ctx)) {
    return { error: 'sin_permiso_crm_clientes_requiere_modulo_clientes_o_similar' };
  }

  const textoRaw = String(args.texto_cliente ?? '').trim();
  if (textoRaw.length < 2) return { error: 'pedir_nombre_cliente_mas_largo' };

  let limite = Math.floor(Number(args.limite ?? 40));
  if (!Number.isFinite(limite) || limite < 1) limite = 40;
  limite = Math.min(60, limite);

  const db = admin.firestore();
  const snap = await queryClientsDocsScoped(db, ctx.empresaId, ctx.scopeEmpresa, 480);

  type Match = {
    id_cliente: string;
    nombre_cliente: string;
    objetivos: Array<{ id_objetivo: string; nombre_objetivo: string }>;
  };
  const matches: Match[] = [];

  for (const d of snap) {
    const data = d.data() as Record<string, unknown>;
    const clientName = String(data.name ?? '').trim() || d.id;
    if (!clientHaystackMatchesNeedle(textoRaw, clientName)) continue;

    const objsRaw = data.objetivos ?? data.objectives;
    const objetivos: Array<{ id_objetivo: string; nombre_objetivo: string }> = [];
    if (Array.isArray(objsRaw)) {
      for (const o of objsRaw as Array<Record<string, unknown>>) {
        const oid = String(o?.id ?? '').trim();
        if (!oid) continue;
        objetivos.push({
          id_objetivo: oid,
          nombre_objetivo: String(o?.name ?? '').trim() || oid,
        });
      }
    }
    objetivos.sort((a, b) => a.nombre_objetivo.localeCompare(b.nombre_objetivo, 'es'));
    matches.push({ id_cliente: d.id, nombre_cliente: clientName, objetivos });
  }

  if (matches.length === 0) {
    return {
      error: 'cliente_no_encontrado',
      texto_buscado: textoRaw,
      nota: 'probá otro fragmento del nombre comercial (ej. CASISA, Lotería)',
    };
  }

  if (matches.length > 1) {
    return {
      ambigua: true,
      texto_buscado: textoRaw,
      clientes_coincidentes: matches.map((m) => ({
        id_cliente: m.id_cliente,
        nombre_cliente: m.nombre_cliente,
        cuenta_objetivos: m.objetivos.length,
      })),
      nota_tras_herramienta: 'Pedí al usuario que elija el cliente exacto antes de listar sedes.',
    };
  }

  const m = matches[0]!;
  const sliced = m.objetivos.slice(0, limite);
  return {
    id_cliente: m.id_cliente,
    nombre_cliente: m.nombre_cliente,
    cuenta_objetivos: m.objetivos.length,
    objetivos: sliced,
    truncado_por_limite: m.objetivos.length > sliced.length,
    nota_tras_herramienta:
      'Listá los nombres de objetivos tal cual en objetivos[].nombre_objetivo; no inventes sedes. Para SLA/horas usá resumen_horas_objetivo_sla_periodo.',
  };
}

export async function ejecutarConsultarTurnosEmpleado(
  ctx: AssistantToolContext,
  args: {
    id_firestore_empleado?: string;
    fecha_desde: string;
    fecha_hasta: string;
  },
): Promise<Record<string, unknown>> {
  if (!canQueryShifts(ctx)) {
    return { error: 'sin_permiso_para_consultar_turnos' };
  }

  let empId = String(args.id_firestore_empleado ?? '').trim();
  if (ctx.persona === 'EMPLOYEE') {
    if (!ctx.selfEmployeeFirestoreId) {
      return { error: 'portal_empleado_sin_legajo_vinculado' };
    }
    if (empId && empId !== ctx.selfEmployeeFirestoreId) {
      return { error: 'portal_empleado_solo_turnos_propios' };
    }
    empId = ctx.selfEmployeeFirestoreId;
  } else if (!empId) {
    return { error: 'falta_id_firestore_empleado_primero_usar_buscar_empleados' };
  }

  const db = admin.firestore();
  const empRow = await assertEmployeeInEmpresa(db, empId, ctx.empresaId, ctx.scopeEmpresa);
  if (!empRow) return { error: 'empleado_inexistente_o_fuera_de_empresa' };

  let desde = String(args.fecha_desde ?? '').trim();
  let hasta = String(args.fecha_hasta ?? '').trim();
  if (!desde || !hasta) {
    desde = hasta = ctx.referenceDateYsMmDd;
  }

  let start: FirebaseFirestore.Timestamp;
  let end: FirebaseFirestore.Timestamp;
  try {
    ({ start, end } = arRangeTimestamps(desde, hasta));
  } catch (e: any) {
    return { error: e?.message ?? 'fecha_invalida' };
  }

  let qsnap: FirebaseFirestore.QuerySnapshot;
  try {
    qsnap = await db
      .collection('turnos')
      .where('employeeId', '==', empId)
      .where('startTime', '>=', start)
      .where('startTime', '<=', end)
      .limit(32)
      .get();
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[assistant] consultar_turnos_empleado', { empId, desde, hasta, msg });
    return { error: 'error_consulta_turnos_firestore', detalle: msg.slice(0, 280) };
  }

  const turnos = qsnap.docs.map((docSnap) => {
    const t = docSnap.data() as Record<string, unknown>;
    const tsField = (key: string) => {
      const parsed = readFirestoreTs(t, key);
      return parsed ? parsed.toDate().toISOString() : null;
    };
    const code = String(t.code ?? t.type ?? '').trim();
    const present = !!(t.isPresent === true || t.checkInTime);
    const absent = !!(t.isAbsent === true);
    const done = !!(t.isCompleted === true);
    const draft = !!(t.draft === true);

    let presenciaHumana =
      absent ? 'ausente_según_turno'
      : present ? 'presente_marcó_o_checkin'
      : done ? 'turno_finalizado_sin_señal_de_checkin_explícito'
      : draft ? 'borrador_planeado_sin_operar_confirmado'
      : 'planeado_sin_marcacion_aun';

    if (present && absent) presenciaHumana = 'marcado_conflictivo_revisar_módulo_operaciones';

    return {
      idTurno: docSnap.id,
      inicioUtc: tsField('startTime'),
      finUtc: tsField('endTime'),
      codigo: code || undefined,
      objetivo: String(t.objectiveName ?? t.objectiveId ?? '') || undefined,
      puesto: String(t.positionName ?? '') || undefined,
      borrador: draft,
      publicado_inferido: draft ? 'posible_plan_borrador' : 'probable_turno_efectivo',
      campo_isPresent: t.isPresent ?? null,
      campo_isAbsent: t.isAbsent ?? null,
      campo_isCompleted: t.isCompleted ?? null,
      origen_OPERACION_planificado: String(t.origin ?? '') || undefined,
      resumen_presencia_para_usuario: presenciaHumana,
    };
  });

  turnos.sort((a, b) => String(a.inicioUtc ?? '').localeCompare(String(b.inicioUtc ?? '')));

  return {
    empleado: { idFirestore: empId, nombreLegible: String((empRow as any).name ?? (empRow as any).nombre ?? '') || '(sin nombre en legajo)' },
    rango: { desde_inclusive: desde, hasta_inclusive: hasta },
    turnos,
    cuenta: turnos.length,
    aclaracion:
      turnos.some((z) => z.borrador) && turnos.some((z) => !z.borrador)
        ? 'mezcla_borrador_y_no_borrador: aclarás qué registros pueden ser sólo planeación.'
        : undefined,
  };
}

const ASSISTANT_HOURS_NON_COVERAGE_CODES = new Set([
  'F',
  'FF',
  'FP',
  'FT',
  'V',
  'L',
  'A',
  'E',
  'AA',
  'PG',
  'RET',
]);

const ASSISTANT_SHIFT_HOURS_LOOKUP: Record<string, number> = {
  M: 8,
  T: 8,
  N: 8,
  D12: 12,
  N12: 12,
  PU: 12,
  GU: 8,
  EN: 9,
  C: 8,
  EV: 8,
  F: 0,
  FF: 0,
  FP: 0,
  FT: 0,
  V: 0,
  L: 0,
  A: 0,
  E: 0,
  AA: 0,
  PG: 0,
  RET: 0,
};

/** Firestore Admin: getAll admite como máximo ~10 referencias por llamada. */
async function firestoreGetAllRefs(
  db: FirebaseFirestore.Firestore,
  refs: FirebaseFirestore.DocumentReference[],
): Promise<FirebaseFirestore.DocumentSnapshot[]> {
  const out: FirebaseFirestore.DocumentSnapshot[] = [];
  const BATCH = 10;
  for (let i = 0; i < refs.length; i += BATCH) {
    const slice = refs.slice(i, i + BATCH);
    if (slice.length === 0) continue;
    const snaps = await db.getAll(...slice);
    out.push(...snaps);
  }
  return out;
}

function readFirestoreTs(row: Record<string, unknown>, key: string): Timestamp | null {
  const v = row[key];
  if (v instanceof Timestamp) return v;
  if (v && typeof v === 'object' && typeof (v as { toMillis?: unknown }).toMillis === 'function') {
    const ms = (v as { toMillis: () => number }).toMillis();
    if (Number.isFinite(ms)) return Timestamp.fromMillis(ms);
  }
  if (v && typeof v === 'object' && v !== null && 'seconds' in v) {
    const o = v as { seconds?: unknown; nanoseconds?: unknown };
    const s = Number(o.seconds);
    const n = Number(o.nanoseconds ?? 0);
    if (Number.isFinite(s)) return new Timestamp(Math.floor(s), Number.isFinite(n) ? Math.floor(n) : 0);
  }
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v.trim())) {
    const core = v.trim().slice(0, 10);
    const t0 = Date.parse(`${core}T12:00:00.000${AR_DAY_OFFSET}`);
    if (Number.isFinite(t0)) return Timestamp.fromMillis(t0);
  }
  return null;
}

/** Consulta turnos por legajo en rango; si falla el índice compuesto, filtra en memoria por employeeId. */
async function queryTurnosEmpleadoEnRango(
  db: FirebaseFirestore.Firestore,
  empId: string,
  start: Timestamp,
  end: Timestamp,
  lim: number,
): Promise<{ docs: FirebaseFirestore.QueryDocumentSnapshot[]; uso_fallback: boolean }> {
  try {
    const qsnap = await db
      .collection('turnos')
      .where('employeeId', '==', empId)
      .where('startTime', '>=', start)
      .where('startTime', '<=', end)
      .limit(lim)
      .get();
    return { docs: qsnap.docs, uso_fallback: false };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[assistant] queryTurnosEmpleadoEnRango fallback', { empId, msg: msg.slice(0, 200) });
    const qsnap = await db.collection('turnos').where('employeeId', '==', empId).limit(Math.min(900, lim * 3)).get();
    const t0 = start.toMillis();
    const t1 = end.toMillis();
    const docs = qsnap.docs.filter((d) => {
      const st = readFirestoreTs(d.data() as Record<string, unknown>, 'startTime');
      if (!st) return false;
      const ms = st.toMillis();
      return ms >= t0 && ms <= t1;
    });
    return { docs: docs.slice(0, lim), uso_fallback: true };
  }
}

function plannedCoverageHoursFromShiftRow(row: Record<string, unknown>): number {
  const rawCode = String(row.code ?? '').trim().toUpperCase();
  if (ASSISTANT_HOURS_NON_COVERAGE_CODES.has(rawCode)) return 0;
  const st = String(row.status ?? '').toLowerCase();
  if (st.includes('cancel') || st.includes('delet')) return 0;
  if (String(row.type ?? '').toUpperCase() === 'NOVEDAD') return 0;

  const stored = Number(row.hours);
  if (Number.isFinite(stored) && stored > 0) return Math.min(stored, 24);

  const s = readFirestoreTs(row, 'startTime');
  const e = readFirestoreTs(row, 'endTime');
  if (s && e) {
    const h = (e.toMillis() - s.toMillis()) / 3600000;
    if (h > 0 && h <= 24) return h;
    if (h > 24) return 24;
  }
  const lk = ASSISTANT_SHIFT_HOURS_LOOKUP[rawCode];
  if (typeof lk === 'number') return lk;
  return 8;
}

function realWorkedHoursFromShiftRow(row: Record<string, unknown>): number | null {
  if (row.isCompleted !== true) return null;
  const rs = readFirestoreTs(row, 'realStartTime') ?? readFirestoreTs(row, 'checkInTime');
  const re = readFirestoreTs(row, 'realEndTime') ?? readFirestoreTs(row, 'checkOutTime');
  if (!rs || !re) return null;
  const h = (re.toMillis() - rs.toMillis()) / 3600000;
  if (!Number.isFinite(h) || h <= 0 || h > 24) return null;
  return Math.round(h * 10) / 10;
}

/**
 * Agregados de horas por legajo en un rango (misma colección `turnos` que reportes/RRHH).
 * Aproximación operativa: no reemplaza liquidación legal ni pantalla Reportes completa (feriados, nocturnas, etc.).
 */
export async function ejecutarResumenHorasEmpleadoPeriodo(
  ctx: AssistantToolContext,
  args: {
    id_firestore_empleado?: string;
    fecha_desde: string;
    fecha_hasta: string;
  },
): Promise<Record<string, unknown>> {
  if (!canQueryShifts(ctx)) {
    return { error: 'sin_permiso_para_consultar_turnos' };
  }

  let empId = String(args.id_firestore_empleado ?? '').trim();
  if (ctx.persona === 'EMPLOYEE') {
    if (!ctx.selfEmployeeFirestoreId) {
      return { error: 'portal_empleado_sin_legajo_vinculado' };
    }
    if (empId && empId !== ctx.selfEmployeeFirestoreId) {
      return { error: 'portal_empleado_solo_turnos_propios' };
    }
    empId = ctx.selfEmployeeFirestoreId;
  } else if (!empId) {
    return { error: 'falta_id_firestore_empleado_primero_usar_buscar_empleados' };
  }

  const db = admin.firestore();
  const empRow = await assertEmployeeInEmpresa(db, empId, ctx.empresaId, ctx.scopeEmpresa);
  if (!empRow) return { error: 'empleado_inexistente_o_fuera_de_empresa' };

  const desde = String(args.fecha_desde ?? '').trim();
  const hasta = String(args.fecha_hasta ?? '').trim();
  let start: Timestamp;
  let end: Timestamp;
  try {
    ({ start, end } = arRangeTimestamps(desde, hasta));
  } catch (e: any) {
    return { error: e?.message ?? 'fecha_invalida' };
  }

  const LIM = 400;
  let turnoDocs: FirebaseFirestore.QueryDocumentSnapshot[];
  let usoFallback = false;
  try {
    const q = await queryTurnosEmpleadoEnRango(db, empId, start, end, LIM);
    turnoDocs = q.docs;
    usoFallback = q.uso_fallback;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[assistant] resumen_horas query turnos', { empId, desde, hasta, msg });
    return { error: 'error_consulta_turnos_firestore', detalle: msg.slice(0, 280) };
  }

  let horasPlanCobertura = 0;
  let horasReales = 0;
  let turnosConReal = 0;
  let omitidos = 0;
  const porCodigo = new Map<string, { n: number; hs: number }>();

  const muestra: Array<Record<string, unknown>> = [];

  for (const docSnap of turnoDocs) {
    const row = docSnap.data() as Record<string, unknown>;
    const st = String(row.status ?? '').toLowerCase();
    if (st.includes('cancel') || st.includes('delet')) {
      omitidos += 1;
      continue;
    }
    if (String(row.type ?? '').toUpperCase() === 'NOVEDAD') {
      omitidos += 1;
      continue;
    }

    const hp = plannedCoverageHoursFromShiftRow(row);
    horasPlanCobertura += hp;
    const code = String(row.code ?? '').trim().toUpperCase() || '(sin código)';
    const pc = porCodigo.get(code) ?? { n: 0, hs: 0 };
    pc.n += 1;
    pc.hs += hp;
    porCodigo.set(code, pc);

    const hr = realWorkedHoursFromShiftRow(row);
    if (hr != null) {
      horasReales += hr;
      turnosConReal += 1;
    }

    if (muestra.length < 14) {
      const s = readFirestoreTs(row, 'startTime');
      muestra.push({
        id_turno_corto: docSnap.id.slice(0, 12),
        dia_inicio_cordoba: s ? formatYmdCordobaFromTs(s) : undefined,
        codigo: code,
        horas_plan_cobertura: Math.round(hp * 10) / 10,
        horas_reales_fichada: hr,
        borrador: !!(row.draft === true),
        completado: !!(row.isCompleted === true),
      });
    }
  }

  const porCodigoArr = Array.from(porCodigo.entries())
    .map(([codigo, v]) => ({ codigo, turnos: v.n, horas_plan_cobertura: Math.round(v.hs * 10) / 10 }))
    .sort((a, b) => b.horas_plan_cobertura - a.horas_plan_cobertura)
    .slice(0, 16);

  const er = empRow as Record<string, unknown>;
  const ln = String(er.lastName ?? '').trim();
  const fn = String(er.firstName ?? '').trim();
  const nombreLegible =
    [ln, fn].filter(Boolean).join(', ') ||
    String(er.name ?? er.nombre ?? '').trim() ||
    [fn, ln].filter(Boolean).join(' ') ||
    '(sin nombre en legajo)';

  return {
    empleado: {
      idFirestore: empId,
      nombreLegible,
    },
    rango: { desde_inclusive: desde, hasta_inclusive: hasta },
    totales: {
      horas_planificadas_cobertura: Math.round(horasPlanCobertura * 10) / 10,
      horas_reales_fichadas_sumadas: Math.round(horasReales * 10) / 10,
      turnos_considerados: turnoDocs.length - omitidos,
      turnos_omitidos_cancelados_o_novedad: omitidos,
      turnos_con_horas_reales: turnosConReal,
    },
    por_codigo: porCodigoArr,
    truncado_consulta_turnos_limite: turnoDocs.length >= LIM,
    consulta_turnos_uso_fallback_sin_indice_compuesto: usoFallback,
    muestra_turnos: muestra,
    criterios: {
      horas_planificadas_cobertura:
        'Suma duración teórica de turnos con código de cobertura (excluye F/FF/FP/FT/V/L/A/E/AA/PG/RET y NOVEDAD/cancelados). Usa campo hours, o startTime–endTime, o tabla CCT básica M/T/N/D12/N12/PU/GU/EN/C.',
      horas_reales_fichadas_sumadas:
        'Suma (realStartTime–realEndTime) o (checkInTime–checkOutTime) solo si isCompleted=true y ambos extremos existen; no sustituye liquidación con reglas de noche/feriado.',
    },
    nota_tras_herramienta:
      'Respondé con totales.horas_planificadas_cobertura para «horas planificadas de puesto» en el período; totales.horas_reales_fichadas_sumadas solo si preguntan fichadas/reales y aclarar que es parcial si hay pocos turnos con real. Si truncado_consulta_turnos_limite=true, decí que puede faltar cola del período. Para liquidación oficial o nocturnas/feriados remití al módulo Reportes y liquidación.',
  };
}

function formatYmdCordobaFromTs(ts: Timestamp): string {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Argentina/Cordoba',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(ts.toDate());
  } catch {
    return '';
  }
}

/**
 * Conteos alineados al monitor de Operaciones (misma ventana y reglas básicas de visibilidad).
 * No incluye vacantes virtuales del SLA (sólo documentos en `turnos`).
 */
export async function ejecutarResumenPresenciasObjetivosDia(
  ctx: AssistantToolContext,
  args: { fecha?: string; id_objetivo?: string },
): Promise<Record<string, unknown>> {
  if (!canQueryOperationsDaySummary(ctx)) {
    return { error: 'sin_permiso_resumen_operaciones_requiere_modulo_operaciones_planificacion_o_similar' };
  }

  const fecha = String(args.fecha ?? ctx.referenceDateYsMmDd).trim();
  const filterObj = String(args.id_objetivo ?? '').trim() || undefined;
  try {
    parseYmd(fecha);
  } catch (e: any) {
    return { error: e?.message ?? 'fecha_invalida' };
  }

  const db = admin.firestore();
  const objectiveMap = await objectivesMapForEmpresa(db, ctx.empresaId, filterObj, ctx.scopeEmpresa);
  if (objectiveMap.size === 0) {
    return {
      fecha_referencia: fecha,
      nota: filterObj ? 'objetivo_no_encontrado_en_empresa' : 'sin_objetivos_para_esta_empresa',
      totales: { turnos_visibles_en_dia: 0, presentes: 0, ausentes: 0, sin_marcacion_relevante: 0 },
      por_objetivo: [],
    };
  }

  let visibleRows: OperacionesDiaRowPublico[];
  let truncadoConsultaTurnos: boolean;
  try {
    ({ rows: visibleRows, truncadoConsultaTurnos } = await queryTurnosVisiblesOperacionesEmpresaDia(
      db,
      ctx.empresaId,
      objectiveMap,
      fecha,
      ctx.scopeEmpresa,
    ));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: 'error_consulta_turnos_operaciones', detalle: msg.slice(0, 280) };
  }

  type PerObj = {
    objetivo_id: string;
    objetivo_nombre: string;
    cliente: string;
    presentes: number;
    ausentes: number;
    sin_marcacion: number;
    turnos_visibles: number;
  };
  const byObj = new Map<string, PerObj>();

  const ensureRow = (oid: string) => {
    let r = byObj.get(oid);
    if (!r) {
      const meta = objectiveMap.get(oid);
      r = {
        objetivo_id: oid,
        objetivo_nombre: meta?.name ?? oid,
        cliente: meta?.clientName ?? '',
        presentes: 0,
        ausentes: 0,
        sin_marcacion: 0,
        turnos_visibles: 0,
      };
      byObj.set(oid, r);
    }
    return r;
  };

  let presentes = 0;
  let ausentes = 0;
  let sinMarc = 0;
  let visibles = 0;

  for (const c of visibleRows) {
    const row = ensureRow(c.oid);
    row.turnos_visibles += 1;
    visibles += 1;
    if (c.isPresent) {
      row.presentes += 1;
      presentes += 1;
    } else if (c.isAbsent) {
      row.ausentes += 1;
      ausentes += 1;
    } else {
      row.sin_marcacion += 1;
      sinMarc += 1;
    }
  }

  const porObjetivo = Array.from(byObj.values())
    .filter((r) => r.turnos_visibles > 0)
    .sort((a, b) => (a.cliente + a.objetivo_nombre).localeCompare(b.cliente + b.objetivo_nombre, 'es'));

  return {
    fecha_referencia: fecha,
    zona: 'America/Argentina/Cordoba',
    criterio_presente: 'isPresent true, empleado asignado distinto de VACANTE, isAbsent false (como pantalla Operaciones)',
    truncado_limite_turnos_consultados: truncadoConsultaTurnos,
    totales: {
      turnos_visibles_en_dia: visibles,
      presentes,
      ausentes,
      sin_marcacion_relevante: sinMarc,
    },
    por_objetivo: porObjetivo.slice(0, 64),
    nota_tras_herramienta:
      'Respondé con los totales y, si preguntan por objetivos, mencioná los que más concentran guardias según por_objetivo.',
  };
}

/** Lista legible para «quién está de turno hoy»: mismos turnos que resumen_presencias_objetivos_dia. */
export async function ejecutarListadoTurnosOperativosDia(
  ctx: AssistantToolContext,
  args: {
    fecha?: string;
    id_objetivo?: string;
    limite?: number;
    hora_inicio_cor?: string;
    codigo_turno?: string;
    solo_estado_presencia?: 'presente' | 'ausente' | 'sin_marcacion';
  },
): Promise<Record<string, unknown>> {
  if (!canQueryOperationsDaySummary(ctx)) {
    return { error: 'sin_permiso_resumen_operaciones_requiere_modulo_operaciones_planificacion_o_similar' };
  }

  const fecha = String(args.fecha ?? ctx.referenceDateYsMmDd).trim();
  const filterObj = String(args.id_objetivo ?? '').trim() || undefined;
  try {
    parseYmd(fecha);
  } catch (e: any) {
    return { error: e?.message ?? 'fecha_invalida' };
  }

  let lim = Math.floor(Number(args.limite ?? 96));
  if (!Number.isFinite(lim)) lim = 96;
  lim = Math.max(8, Math.min(120, lim));

  const db = admin.firestore();
  let objectiveMap: Map<string, { name: string; clientId: string; clientName: string }>;
  try {
    objectiveMap = await objectivesMapForEmpresa(db, ctx.empresaId, filterObj, ctx.scopeEmpresa);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: 'error_consulta_objetivos', detalle: msg.slice(0, 280) };
  }
  if (objectiveMap.size === 0) {
    return {
      fecha_referencia: fecha,
      nota: filterObj ? 'objetivo_no_encontrado_en_empresa' : 'sin_objetivos_para_esta_empresa',
      cuenta_total_turnos_visibles: 0,
      muestra_turnos: [],
    };
  }

  let visibleRows: OperacionesDiaRowPublico[];
  let truncadoConsultaTurnos: boolean;
  try {
    ({ rows: visibleRows, truncadoConsultaTurnos } = await queryTurnosVisiblesOperacionesEmpresaDia(
      db,
      ctx.empresaId,
      objectiveMap,
      fecha,
      ctx.scopeEmpresa,
    ));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[assistant] ejecutarListadoTurnosOperativosDia', { fecha, msg });
    return { error: 'error_consulta_turnos_operaciones', detalle: msg.slice(0, 280) };
  }

  let filteredRows = visibleRows;
  const horaFiltro = String(args.hora_inicio_cor ?? '').trim().slice(0, 5);
  if (horaFiltro) {
    filteredRows = filteredRows.filter((r) => String(r.h_inicio_cordoba ?? '').startsWith(horaFiltro));
  }
  const codigoFiltro = String(args.codigo_turno ?? '').trim().toUpperCase();
  if (codigoFiltro) {
    filteredRows = filteredRows.filter((r) => String(r.codigo ?? '').trim().toUpperCase() === codigoFiltro);
  }
  const presFiltro = args.solo_estado_presencia;
  if (presFiltro === 'presente') {
    filteredRows = filteredRows.filter((r) => r.isPresent);
  } else if (presFiltro === 'ausente') {
    filteredRows = filteredRows.filter((r) => r.isAbsent);
  } else if (presFiltro === 'sin_marcacion') {
    filteredRows = filteredRows.filter((r) => !r.isPresent && !r.isAbsent);
  }

  const muestra = filteredRows.slice(0, lim).map((r) => ({
    cliente: r.cliente,
    objetivo: r.objetivo_nombre,
    hora_inicio_cor: r.h_inicio_cordoba,
    codigo: r.codigo,
    puesto: r.puesto,
    persona: r.empleado_etiqueta,
    estado_presencia:
      r.isPresent ? 'presente'
      : r.isAbsent ? 'ausente'
      : 'asignado_sin_marcacion_todavia',
  }));

  return {
    fecha_referencia: fecha,
    criterios: 'Misma vista que Operaciones para el día referencia en zona Cordoba.',
    cuenta_total_turnos_visibles: filteredRows.length,
    cuenta_sin_filtros: visibleRows.length,
    filtros_aplicados: {
      hora_inicio_cor: horaFiltro || null,
      codigo_turno: codigoFiltro || null,
      solo_estado_presencia: presFiltro ?? null,
    },
    muestra_cap: lim,
    truncado_limite_turnos_consultados: truncadoConsultaTurnos,
    muestra_truncada_vs_total: filteredRows.length > muestra.length,
    muestra_turnos: muestra,
    nota_tras_herramienta:
      'Contestá agrupando por cliente/objetivo; si muestra_truncada_vs_total=true o truncado_limite_turnos_consultados=true, aclaralo al usuario.',
  };
}

/** Conteo de SLA en `servicios_sla` por clientes de la empresa: mismo criterio de mes que KPI Servicios/Dashboard + vigencia en día opcional. */
export async function ejecutarContarServiciosSlaVigentesEmpresa(
  ctx: AssistantToolContext,
  args: { fecha?: string },
): Promise<Record<string, unknown>> {
  if (!canQueryServiciosSlaResumen(ctx)) {
    return { error: 'sin_permiso_servicios_o_planificacion_requiere_MODULES_READ' };
  }

  const fecha = String(args.fecha ?? ctx.referenceDateYsMmDd).trim();
  try {
    parseYmd(fecha);
  } catch (e: any) {
    return { error: e?.message ?? 'fecha_invalida' };
  }

  const db = admin.firestore();
  const clientIds = await empresaClientIdsSet(db, ctx.empresaId, ctx.scopeEmpresa);
  if (clientIds.size === 0) {
    return {
      fecha_referencia: fecha,
      mes_yyyy_mm: fecha.slice(0, 7),
      cuenta_para_tarjeta_servicios_activos_del_mes: 0,
      cuenta_objetivos_distintos_con_sla_en_ese_mes: 0,
      cuenta_contratos_vigentes_en_el_dia_referencia: 0,
      nota: 'ningún_cliente_de_esta_empresa_en_clients',
      muestra_contratos_en_mes: [],
    };
  }

  const idList = Array.from(clientIds);
  const byDocId = new Map<string, QueryDocumentSnapshot>();
  for (const batch of chunkIds(idList, 10)) {
    const qs = await db.collection('servicios_sla').where('clientId', 'in', batch).limit(500).get();
    for (const d of qs.docs) {
      if (!byDocId.has(d.id)) byDocId.set(d.id, d);
    }
  }

  let incompletosPeriodo = 0;
  let cuentaSolapaMes = 0;
  let cuentaVigentesDia = 0;
  const objetivosUnicosMes = new Set<string>();
  const vigentesParaMuestra: Array<Record<string, string>> = [];
  const incompletosMuestra: Array<Record<string, string>> = [];

  for (const docSnap of byDocId.values()) {
    const row = docSnap.data() as Record<string, unknown>;
    const cid = String(row.clientId ?? '').trim();
    if (!cid || !clientIds.has(cid)) continue;

    const desde = slaCampoFechaYmD(row.startDate ?? row.desde ?? row.inicioContrato ?? '');
    const hasta = slaCampoFechaYmD(row.endDate ?? row.hasta ?? row.finContrato ?? '');
    if (!desde || !hasta) {
      incompletosPeriodo += 1;
      if (incompletosMuestra.length < 6) {
        incompletosMuestra.push({
          cliente: String(row.clientName ?? '').slice(0, 80),
          objetivo: String(row.objectiveName ?? '').slice(0, 80),
          id_doc_corto: docSnap.id.slice(0, 12),
          motivo: 'falta_o_invalido_start_or_end_Date',
        });
      }
      continue;
    }

    const solapaMes = servicioSlaSolapaMesReferencia(desde, hasta, fecha);
    if (solapaMes) {
      cuentaSolapaMes += 1;
      const oid = String(row.objectiveId ?? '').trim() || String(row.objectiveName ?? '').trim() || docSnap.id;
      objetivosUnicosMes.add(`${cid}__${oid}`);
      const item = {
        cliente: String(row.clientName ?? cid).slice(0, 100),
        objetivo: String(row.objectiveName ?? row.objectiveId ?? '').slice(0, 100),
        desde,
        hasta,
        estado: String(row.status ?? '').slice(0, 24),
        id_servicio_firestore_corto: docSnap.id.slice(0, 14),
      };
      if (vigentesParaMuestra.length < 80) vigentesParaMuestra.push(item);
    }

    if (slaStatusOperativoComoPantallaServicios(row) && servicioSlaVigenteEnDiaInclusivo(desde, hasta, fecha)) {
      cuentaVigentesDia += 1;
    }
  }

  const muestraLista = [...vigentesParaMuestra]
    .sort((a, b) => `${a.cliente} ${a.objetivo}`.localeCompare(`${b.cliente} ${b.objetivo}`, 'es'))
    .slice(0, 36);

  return {
    fecha_referencia: fecha,
    mes_yyyy_mm: fecha.slice(0, 7),
    criterios: {
      tarjeta_panel_y_kpi_servicios:
        'Cuenta documentos en servicios_sla cuyo clientId pertenece a clients.empresaId actual y startDate/endDate solapan el mes calendario de fecha_referencia (misma regla string que dashboard y KPI «Servicios activos» del mes en la pantalla Servicios).',
      vigentes_en_un_dia:
        'cuenta_contratos_vigentes_en_el_dia_referencia = status operativo (activo/activo en español o vacío; excluye inactivo) y el día fecha_referencia está entre start y end inclusive.',
    },
    cuenta_para_tarjeta_servicios_activos_del_mes: cuentaSolapaMes,
    cuenta_objetivos_distintos_con_sla_en_ese_mes: objetivosUnicosMes.size,
    cuenta_contratos_vigentes_en_el_dia_referencia: cuentaVigentesDia,
    cuenta_activos_sin_rango_fechas_calendario: incompletosPeriodo,
    muestra_contratos_en_mes: muestraLista,
    muestra_activos_sin_fechas: incompletosMuestra,
    nota_tras_herramienta:
      'Respondé con cuenta_para_tarjeta_servicios_activos_del_mes cuando la pregunta sea «cuántos servicios activos» como en el panel o la tarjeta del mes (coincide con el KPI del módulo Servicios). Usá cuenta_objetivos_distintos_con_sla_en_ese_mes si hablan de «objetivos» o tarjetas por sitio. Usá cuenta_contratos_vigentes_en_el_dia_referencia solo si piden explícitamente vigentes «hoy» / en esa fecha con sentido contractual estricto. No inventes cifras. Si listan nombres de contratos o SLA, usá solo los textos del array muestra_contratos_en_mes (campos cliente y objetivo); si la muestra no alcanza, decí que hay más y que vean Servicios y SLA; no inventes títulos comerciales.',
  };
}

async function loadServiciosSlaDocsEmpresa(
  db: FirebaseFirestore.Firestore,
  empresaId: string,
  scopeEmpresa: boolean,
): Promise<Array<{ id: string; row: Record<string, unknown> }>> {
  const clientIds = await empresaClientIdsSet(db, empresaId, scopeEmpresa);
  if (clientIds.size === 0) return [];
  const idList = Array.from(clientIds);
  const byDocId = new Map<string, QueryDocumentSnapshot>();
  for (const batch of chunkIds(idList, 10)) {
    const qs = await db.collection('servicios_sla').where('clientId', 'in', batch).limit(500).get();
    for (const d of qs.docs) {
      if (!byDocId.has(d.id)) byDocId.set(d.id, d);
    }
  }
  return Array.from(byDocId.values()).map((d) => ({ id: d.id, row: d.data() as Record<string, unknown> }));
}

/**
 * Horas vendidas del SLA del objetivo en un mes + horas ya cargadas en turnos (planificación).
 * Alineado a Planificación («Vendidas» vs «Hs. Plan.») y pantalla Servicios.
 */
export async function ejecutarResumenHorasObjetivoSlaPeriodo(
  ctx: AssistantToolContext,
  args: {
    id_objetivo?: string;
    texto_objetivo?: string;
    fecha_referencia?: string;
    id_servicio_sla?: string;
  },
): Promise<Record<string, unknown>> {
  if (!canQueryServiciosSlaResumen(ctx)) {
    return { error: 'sin_permiso_servicios_o_planificacion_requiere_MODULES_READ' };
  }
  if (!canQueryShifts(ctx)) {
    return { error: 'sin_permiso_consultar_turnos' };
  }

  const fecha = String(args.fecha_referencia ?? ctx.referenceDateYsMmDd).trim();
  try {
    parseYmd(fecha);
  } catch (e: any) {
    return { error: e?.message ?? 'fecha_invalida' };
  }

  let objectiveId = String(args.id_objetivo ?? '').trim();
  const textoObj = String(args.texto_objetivo ?? '').trim();
  const slaIdFilter = String(args.id_servicio_sla ?? '').trim();

  if (!objectiveId && textoObj.length >= 2) {
    const found = await ejecutarBuscarObjetivosPorNombre(ctx, { texto: textoObj, limite: 6 });
    if (String(found.error ?? '').trim()) return found;
    const coincidencias = (found.coincidencias ?? []) as Array<{ id_objetivo?: string; nombre_objetivo?: string }>;
    if (coincidencias.length === 0) {
      return { error: 'objetivo_no_encontrado', texto_buscado: textoObj };
    }
    if (found.ambigua === true && coincidencias.length >= 2) {
      return {
        error: 'objetivo_ambiguo',
        coincidencias: coincidencias.slice(0, 6).map((c) => ({
          id_objetivo: c.id_objetivo,
          nombre: c.nombre_objetivo,
        })),
      };
    }
    objectiveId = String(coincidencias[0].id_objetivo ?? '').trim();
  }

  const db = admin.firestore();
  const allSla = await loadServiciosSlaDocsEmpresa(db, ctx.empresaId, ctx.scopeEmpresa);
  const matches: Array<{ id: string; row: Record<string, unknown>; vendidas: ReturnType<typeof slaHorasVendidasMesCalendario> }> = [];

  const needleNorm = textoObj.length >= 2 ? norm(textoObj.replace(/,/g, ' ')) : '';
  let metaNameNorm = '';
  if (objectiveId) {
    const objMeta = await objectivesMapForEmpresa(db, ctx.empresaId, objectiveId, ctx.scopeEmpresa);
    metaNameNorm = norm(String(objMeta.get(objectiveId)?.name ?? ''));
  }

  const slaMatchesObjective = (row: Record<string, unknown>): boolean => {
    const oid = String(row.objectiveId ?? '').trim();
    if (objectiveId && oid && oid === objectiveId) return true;
    if (!needleNorm && !metaNameNorm) return false;
    const oname = norm(String(row.objectiveName ?? '').replace(/,/g, ' '));
    const cliente = norm(String(row.clientName ?? row.cliente ?? '').replace(/,/g, ' '));
    const combo = `${cliente} ${oname}`.trim();
    if (metaNameNorm && oname && (oname.includes(metaNameNorm) || metaNameNorm.includes(oname))) return true;
    if (needleNorm) {
      if (oname && (oname.includes(needleNorm) || needleNorm.includes(oname))) return true;
      if (combo && (combo.includes(needleNorm) || needleNorm.includes(combo))) return true;
    }
    return false;
  };

  for (const { id, row } of allSla) {
    if (slaIdFilter && !id.startsWith(slaIdFilter) && id !== slaIdFilter) continue;
    if (!slaMatchesObjective(row)) continue;
    const desde = slaCampoFechaYmD(row.startDate ?? row.desde ?? row.inicioContrato ?? '');
    const hasta = slaCampoFechaYmD(row.endDate ?? row.hasta ?? row.finContrato ?? '');
    if (!desde || !hasta) continue;
    if (!servicioSlaSolapaMesReferencia(desde, hasta, fecha)) continue;
    const positions = Array.isArray(row.positions) ? (row.positions as unknown[]) : [];
    const vendidas = slaHorasVendidasMesCalendario(positions, desde, hasta, fecha);
    if (!objectiveId) {
      const oid = String(row.objectiveId ?? '').trim();
      if (oid) objectiveId = oid;
    }
    matches.push({ id, row, vendidas });
  }

  if (!objectiveId && matches.length === 0 && !textoObj) {
    return { error: 'falta_id_objetivo_o_texto_objetivo' };
  }

  if (matches.length === 0) {
    return {
      error: 'sin_sla_activo_para_objetivo_en_ese_mes',
      id_objetivo: objectiveId || undefined,
      texto_buscado: textoObj || undefined,
      mes_yyyy_mm: fecha.slice(0, 7),
    };
  }

  if (!objectiveId) {
    objectiveId = String(matches[0].row.objectiveId ?? '').trim();
  }
  if (!objectiveId) {
    return {
      error: 'sla_sin_id_objetivo_en_firestore',
      nota: 'El contrato existe pero no tiene objectiveId; revisá Servicios y SLA.',
      mes_yyyy_mm: fecha.slice(0, 7),
    };
  }

  const pick =
    matches.length === 1
      ? matches[0]
      : matches.find((m) => slaStatusOperativoComoPantallaServicios(m.row)) ?? matches[0];

  const mesStart = `${fecha.slice(0, 7)}-01`;
  const refParts = parseYmd(fecha);
  const lastD = new Date(refParts.y, refParts.m, 0).getDate();
  const mesEnd = `${fecha.slice(0, 7)}-${String(lastD).padStart(2, '0')}`;

  let horasPlanificadas = 0;
  let turnosConsiderados = 0;
  let truncadoTurnos = false;
  const LIM = 500;

  try {
    const { start, end } = arRangeTimestamps(mesStart, mesEnd);
    let turnoDocs: FirebaseFirestore.QueryDocumentSnapshot[];
    try {
      const qsnap = await db
        .collection('turnos')
        .where('objectiveId', '==', objectiveId)
        .where('startTime', '>=', start)
        .where('startTime', '<=', end)
        .limit(LIM)
        .get();
      turnoDocs = qsnap.docs;
      truncadoTurnos = qsnap.size >= LIM;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn('[assistant] resumen_horas_objetivo fallback turnos', { objectiveId, msg: msg.slice(0, 200) });
      const qsnap = await db.collection('turnos').where('objectiveId', '==', objectiveId).limit(Math.min(900, LIM * 3)).get();
      const t0 = start.toMillis();
      const t1 = end.toMillis();
      turnoDocs = qsnap.docs.filter((d) => {
        const st = readFirestoreTs(d.data() as Record<string, unknown>, 'startTime');
        if (!st) return false;
        const ms = st.toMillis();
        return ms >= t0 && ms <= t1;
      });
      truncadoTurnos = turnoDocs.length >= LIM;
      turnoDocs = turnoDocs.slice(0, LIM);
    }
    for (const docSnap of turnoDocs) {
      const row = docSnap.data() as Record<string, unknown>;
      const hp = plannedCoverageHoursFromShiftRow(row);
      if (hp <= 0) continue;
      horasPlanificadas += hp;
      turnosConsiderados += 1;
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: 'error_consulta_turnos_firestore', detalle: msg.slice(0, 280) };
  }

  horasPlanificadas = Math.round(horasPlanificadas * 10) / 10;
  const vendidas = pick.vendidas.horas_vendidas_mes;
  const pendiente = Math.round(Math.max(0, vendidas - horasPlanificadas) * 10) / 10;
  const exceso = Math.round(Math.max(0, horasPlanificadas - vendidas) * 10) / 10;

  const objMeta = await objectivesMapForEmpresa(db, ctx.empresaId, objectiveId, ctx.scopeEmpresa);
  const meta = objMeta.get(objectiveId);

  return {
    objetivo: {
      id_objetivo: objectiveId,
      nombre: meta?.name ?? String(pick.row.objectiveName ?? objectiveId),
      cliente: meta?.clientName ?? String(pick.row.clientName ?? ''),
    },
    mes_yyyy_mm: pick.vendidas.mes_yyyy_mm,
    fecha_referencia: fecha,
    contrato_sla: {
      id_firestore_corto: pick.id.slice(0, 14),
      vigencia_desde: slaCampoFechaYmD(pick.row.startDate ?? pick.row.desde ?? ''),
      vigencia_hasta: slaCampoFechaYmD(pick.row.endDate ?? pick.row.hasta ?? ''),
      puestos_en_contrato: Array.isArray(pick.row.positions) ? (pick.row.positions as unknown[]).length : 0,
      otros_contratos_mismo_objetivo_mes: matches.length > 1 ? matches.length - 1 : 0,
    },
    totales: {
      horas_vendidas_sla_mes: vendidas,
      horas_nocturnas_vendidas_sla_mes: pick.vendidas.horas_nocturnas_mes,
      dias_contrato_en_mes: pick.vendidas.dias_contrato_en_mes,
      horas_ya_planificadas_turnos_mes: horasPlanificadas,
      turnos_cobertura_considerados: turnosConsiderados,
      horas_pendientes_a_planificar: pendiente,
      horas_planificadas_sobre_vendidas: exceso,
    },
    truncado_consulta_turnos_limite: truncadoTurnos,
    criterios: {
      horas_vendidas_sla_mes:
        'Suma diaria de puestos del contrato servicios_sla (coverageType / allowedShiftTypes), mismo motor que la pantalla Servicios y SLA, solo días del mes que caen dentro del rango startDate–endDate del contrato.',
      horas_ya_planificadas_turnos_mes:
        'Suma horas de cobertura en turnos del objetivo en el mes calendario (excluye F/FF/RET/licencias; incluye borradores publicados en Firestore).',
      horas_pendientes_a_planificar:
        'max(0, vendidas − planificadas); referencia operativa para «cuántas horas faltan cargar» vs el SLA.',
    },
    nota_tras_herramienta:
      'Respondé con totales.horas_vendidas_sla_mes (vendidas del contrato) y totales.horas_pendientes_a_planificar si preguntan «horas a planificar». Mencioná horas_ya_planificadas_turnos_mes para lo ya cargado en la grilla. Si horas_planificadas_sobre_vendidas>0, hay más horas planificadas que vendidas (revisar en Planificación). Si truncado_consulta_turnos_limite=true, el total planificado puede estar incompleto.',
  };
}

function compactSlaHorasItemFromResumen(
  textoBusqueda: string,
  r: Record<string, unknown>,
): Record<string, unknown> {
  const err = String(r.error ?? '').trim();
  if (err) {
    return {
      texto_busqueda: textoBusqueda,
      error: err,
      detalle: String(r.detalle ?? '').slice(0, 200),
      coincidencias: r.coincidencias,
    };
  }
  const obj = (r.objetivo ?? {}) as Record<string, unknown>;
  const tot = (r.totales ?? {}) as Record<string, unknown>;
  const contrato = (r.contrato_sla ?? {}) as Record<string, unknown>;
  return {
    texto_busqueda: textoBusqueda,
    cliente: String(obj.cliente ?? ''),
    objetivo: String(obj.nombre ?? textoBusqueda),
    horas_vendidas_sla_mes: tot.horas_vendidas_sla_mes,
    horas_ya_planificadas_turnos_mes: tot.horas_ya_planificadas_turnos_mes,
    horas_pendientes_a_planificar: tot.horas_pendientes_a_planificar,
    horas_planificadas_sobre_vendidas: tot.horas_planificadas_sobre_vendidas,
    puestos_en_contrato: contrato.puestos_en_contrato,
    vigencia_desde: contrato.vigencia_desde,
    vigencia_hasta: contrato.vigencia_hasta,
    truncado_consulta_turnos_limite: r.truncado_consulta_turnos_limite === true,
  };
}

/**
 * Horas SLA de varios objetivos en un solo turno (lista del hilo o todos los activos del mes).
 */
function clienteMatchesTextoFiltro(nombreCliente: string, textoCliente: string): boolean {
  const c = norm(nombreCliente);
  const f = norm(textoCliente);
  if (!c || !f) return false;
  return c.includes(f) || f.includes(c);
}

export async function ejecutarResumenHorasSlaVariosObjetivos(
  ctx: AssistantToolContext,
  args: {
    textos_objetivo?: string[];
    fecha_referencia?: string;
    todos_servicios_activos_mes?: boolean;
    texto_cliente?: string;
    limite?: number;
  },
): Promise<Record<string, unknown>> {
  if (!canQueryServiciosSlaResumen(ctx)) {
    return { error: 'sin_permiso_servicios_o_planificacion_requiere_MODULES_READ' };
  }
  if (!canQueryShifts(ctx)) {
    return { error: 'sin_permiso_consultar_turnos' };
  }

  const fecha = String(args.fecha_referencia ?? ctx.referenceDateYsMmDd).trim();
  try {
    parseYmd(fecha);
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : 'fecha_invalida' };
  }

  const limite = Math.min(20, Math.max(1, Number(args.limite) || 12));
  const textoCliente = String(args.texto_cliente ?? '').trim();
  let textos = (args.textos_objetivo ?? [])
    .map((s) => String(s).trim())
    .filter((s) => s.length >= 2);

  const todosActivos = args.todos_servicios_activos_mes === true && !textoCliente;

  if (todosActivos || textos.length === 0) {
    const cnt = await ejecutarContarServiciosSlaVigentesEmpresa(ctx, { fecha });
    if (String(cnt.error ?? '').trim()) return cnt;
    let muestra = (cnt.muestra_contratos_en_mes ?? []) as Array<{ cliente?: string; objetivo?: string }>;
    if (textoCliente) {
      muestra = muestra.filter((m) => clienteMatchesTextoFiltro(String(m.cliente ?? ''), textoCliente));
    }
    const fromMuestra = muestra
      .map((m) => {
        const obj = String(m.objetivo ?? '').trim();
        const cli = String(m.cliente ?? '').trim();
        if (cli && obj) return `${cli} ${obj}`;
        if (obj.length >= 2) return obj;
        return cli.length >= 2 ? cli : '';
      })
      .filter((s) => s.length >= 2);
    if (fromMuestra.length > 0) textos = fromMuestra;
    else if (textoCliente) {
      return {
        error: 'sin_sla_activo_para_cliente_en_ese_mes',
        texto_cliente: textoCliente,
        mes_yyyy_mm: fecha.slice(0, 7),
      };
    }
  }

  const uniq: string[] = [];
  const seen = new Set<string>();
  for (const tx of textos) {
    const k = norm(tx);
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(tx);
    if (uniq.length >= limite) break;
  }

  if (uniq.length === 0) {
    return { error: 'sin_objetivos_a_consultar', fecha_referencia: fecha };
  }

  const resultados = await Promise.all(
    uniq.map(async (texto) => {
      const r = await ejecutarResumenHorasObjetivoSlaPeriodo(ctx, {
        texto_objetivo: texto,
        fecha_referencia: fecha,
      });
      return compactSlaHorasItemFromResumen(texto, r);
    }),
  );

  const ok = resultados.filter((r) => !String(r.error ?? '').trim()).length;
  const fail = resultados.length - ok;

  return {
    fecha_referencia: fecha,
    mes_yyyy_mm: fecha.slice(0, 7),
    consultados: resultados.length,
    con_datos: ok,
    con_error: fail,
    resultados,
    nota_tras_herramienta:
      'Listá cada objetivo con horas_vendidas_sla_mes, horas_ya_planificadas_turnos_mes y horas_pendientes_a_planificar. Si con_error>0, indicá el error por ítem sin decir «error técnico» genérico.',
  };
}

/**
 * Totales de liquidación operativa del período (misma lógica que Reportes / modal detalle de horas).
 */
export async function ejecutarResumenHorasLiquidacionEmpresaPeriodo(
  ctx: AssistantToolContext,
  args: { fecha_desde?: string; fecha_hasta?: string; fecha_referencia?: string },
): Promise<Record<string, unknown>> {
  if (!canQueryShifts(ctx)) {
    return { error: 'sin_permiso_consultar_turnos_requiere_reportes_planificacion_operaciones' };
  }

  let fechaDesde = String(args.fecha_desde ?? '').trim();
  let fechaHasta = String(args.fecha_hasta ?? '').trim();
  const ref = String(args.fecha_referencia ?? ctx.referenceDateYsMmDd).trim();

  if (!fechaDesde || !fechaHasta) {
    try {
      const p = parseYmd(ref);
      const mm = String(p.m).padStart(2, '0');
      const lastD = new Date(p.y, p.m, 0).getDate();
      fechaDesde = `${p.y}-${mm}-01`;
      fechaHasta = `${p.y}-${mm}-${String(lastD).padStart(2, '0')}`;
    } catch (e: unknown) {
      return { error: e instanceof Error ? e.message : 'fecha_invalida' };
    }
  }

  try {
    parseYmd(fechaDesde);
    parseYmd(fechaHasta);
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : 'fecha_invalida' };
  }

  try {
    const agg = await aggregateLiquidacionEmpresaPeriodo(
      admin.firestore(),
      ctx.empresaId,
      fechaDesde,
      fechaHasta,
      ctx.scopeEmpresa,
    );
    return {
      ...agg,
      mes_yyyy_mm: fechaDesde.slice(0, 7),
      criterio:
        'Hs reales = fichadas (realStartTime/checkOut). Diurnas/nocturnas sobre reales (21:00–06:00). Al 100% = FT/franco trabajado. Al 50% = bolsa (reales − FT) por encima de 200 h. No reemplaza export legal de Reportes.',
      nota_tras_herramienta:
        'Respondé con hs_reales, diurnas, nocturnas, al_100_ft, al_50, plus_feriado, bolsa_200 y hs_simples. Para un legajo puntual usá resumen_horas_empleado_periodo.',
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[assistant] resumen_horas_liquidacion', { msg });
    return { error: 'error_consulta_liquidacion_firestore', detalle: msg.slice(0, 280) };
  }
}

const TURNOS_PLANIFICADOS_UMBRAL_LIM = 4500;

/**
 * Vigiladores/empleados con horas planificadas de cobertura por encima de un umbral en el mes/rango.
 * Una pasada sobre `turnos` (misma lógica de cobertura que resumen_horas_empleado_periodo).
 */
export async function ejecutarListadoEmpleadosHorasPlanificadasUmbral(
  ctx: AssistantToolContext,
  args: {
    umbral_horas?: number;
    fecha_desde?: string;
    fecha_hasta?: string;
    fecha_referencia?: string;
    limite?: number;
  },
): Promise<Record<string, unknown>> {
  if (!canQueryShifts(ctx)) {
    return { error: 'sin_permiso_para_consultar_turnos' };
  }
  if (!ctx.empresaId.trim()) {
    return { error: 'falta_empresa_en_sesion' };
  }

  const umbral = Math.max(1, Number(args.umbral_horas ?? 200) || 200);
  let fechaDesde = String(args.fecha_desde ?? '').trim();
  let fechaHasta = String(args.fecha_hasta ?? '').trim();
  const ref = String(args.fecha_referencia ?? ctx.referenceDateYsMmDd).trim();

  if (!fechaDesde || !fechaHasta) {
    try {
      const p = parseYmd(ref);
      const mm = String(p.m).padStart(2, '0');
      const lastD = new Date(p.y, p.m, 0).getDate();
      fechaDesde = `${p.y}-${mm}-01`;
      fechaHasta = `${p.y}-${mm}-${String(lastD).padStart(2, '0')}`;
    } catch (e: unknown) {
      return { error: e instanceof Error ? e.message : 'fecha_invalida' };
    }
  }

  try {
    parseYmd(fechaDesde);
    parseYmd(fechaHasta);
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : 'fecha_invalida' };
  }

  let start: Timestamp;
  let end: Timestamp;
  try {
    ({ start, end } = arRangeTimestamps(fechaDesde, fechaHasta));
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : 'fecha_invalida' };
  }

  const db = admin.firestore();
  const empSnap = await queryEmpleadosDocsScoped(db, ctx.empresaId, ctx.scopeEmpresa, 900);
  const empMap = new Map<string, { nombre: string; legajo: string }>();
  for (const d of empSnap) {
    const data = d.data() as Record<string, unknown>;
    const ln = String(data.lastName ?? '').trim();
    const fn = String(data.firstName ?? '').trim();
    const nombre =
      [ln, fn].filter(Boolean).join(', ') ||
      String(data.name ?? data.nombre ?? '').trim() ||
      '(sin nombre en legajo)';
    empMap.set(d.id, {
      nombre: nombre.slice(0, 120),
      legajo: String(data.fileNumber ?? '').trim(),
    });
  }

  const qsnap = await db
    .collection('turnos')
    .where('startTime', '>=', start)
    .where('startTime', '<=', end)
    .limit(TURNOS_PLANIFICADOS_UMBRAL_LIM)
    .get();

  const byEmp = new Map<string, { horas: number; turnos: number }>();
  for (const doc of qsnap.docs) {
    const row = doc.data() as Record<string, unknown>;
    if (row.draft === true) continue;
    if (row.isUnassigned === true) continue;
    if (!turnoRowBelongsToEmpresa(row, ctx.empresaId, ctx.scopeEmpresa)) continue;

    const empId = String(row.employeeId ?? '').trim();
    if (!empId || empId === 'VACANTE' || !empMap.has(empId)) continue;

    const hp = plannedCoverageHoursFromShiftRow(row);
    if (hp <= 0) continue;
    const acc = byEmp.get(empId) ?? { horas: 0, turnos: 0 };
    acc.horas += hp;
    acc.turnos += 1;
    byEmp.set(empId, acc);
  }

  const sobreUmbral = Array.from(byEmp.entries())
    .filter(([, v]) => v.horas > umbral + 0.05)
    .map(([id, v]) => {
      const meta = empMap.get(id)!;
      return {
        id_firestore: id,
        nombre: meta.nombre,
        legajo: meta.legajo || undefined,
        horas_planificadas_cobertura: Math.round(v.horas * 10) / 10,
        turnos_cobertura: v.turnos,
        exceso_sobre_umbral: Math.round((v.horas - umbral) * 10) / 10,
      };
    })
    .sort((a, b) => b.horas_planificadas_cobertura - a.horas_planificadas_cobertura);

  let limite = Math.floor(Number(args.limite ?? 40));
  if (!Number.isFinite(limite) || limite < 5) limite = 40;
  limite = Math.min(80, limite);

  const muestra = sobreUmbral.slice(0, limite);
  const truncadoLista = sobreUmbral.length > limite;

  return {
    rango: { desde_inclusive: fechaDesde, hasta_inclusive: fechaHasta },
    mes_yyyy_mm: fechaDesde.slice(0, 7),
    umbral_horas: umbral,
    empleados_con_turnos_en_rango: byEmp.size,
    cuenta_sobre_umbral: sobreUmbral.length,
    muestra_empleados_sobre_umbral: muestra,
    truncado_por_limite_muestra: truncadoLista,
    truncado_consulta_turnos_limite: qsnap.size >= TURNOS_PLANIFICADOS_UMBRAL_LIM,
    criterio:
      'Suma horas_planificadas_cobertura por legajo (excluye F/FF/FP/FT/V/L/A/E/AA/PG/RET y cancelados/novedad). No es bolsa 200 de liquidación ni horas fichadas.',
    nota_tras_herramienta:
      'Listá muestra_empleados_sobre_umbral con nombre, legajo y horas_planificadas_cobertura. Si cuenta_sobre_umbral=0, decilo claro. No confundir con bolsa_200 ni remitir a Reportes si la tool devolvió datos.',
  };
}

/** Cualquier asignación en grilla/planificación (incluye F/V/L; excluye vacantes y cancelados). */
function shiftCountsAsPlanificacionAsignada(row: Record<string, unknown>): boolean {
  if (row.isUnassigned === true) return false;
  const st = String(row.status ?? '').toLowerCase();
  if (st.includes('cancel') || st.includes('delet')) return false;
  if (String(row.type ?? '').toUpperCase() === 'NOVEDAD') return false;
  const empId = String(row.employeeId ?? '').trim();
  if (!empId || empId === 'VACANTE') return false;
  return true;
}

/**
 * Legajos activos de la empresa sin ningún turno asignado en el rango (mes por defecto).
 * Cuenta F/V/L como planificación; excluye vacantes y turnos cancelados.
 */
export async function ejecutarListadoEmpleadosSinTurnosPlanificados(
  ctx: AssistantToolContext,
  args: {
    fecha_desde?: string;
    fecha_hasta?: string;
    fecha_referencia?: string;
    limite?: number;
    solo_activos_nomina_panel?: boolean;
  },
): Promise<Record<string, unknown>> {
  if (!canQueryShifts(ctx)) {
    return { error: 'sin_permiso_para_consultar_turnos' };
  }
  if (!canUseEmployeeSearch(ctx)) {
    return { error: 'sin_permiso_para_buscar_personal' };
  }
  if (!ctx.empresaId.trim()) {
    return { error: 'falta_empresa_en_sesion' };
  }

  let fechaDesde = String(args.fecha_desde ?? '').trim();
  let fechaHasta = String(args.fecha_hasta ?? '').trim();
  const ref = String(args.fecha_referencia ?? ctx.referenceDateYsMmDd).trim();

  if (!fechaDesde || !fechaHasta) {
    try {
      const p = parseYmd(ref);
      const mm = String(p.m).padStart(2, '0');
      const lastD = new Date(p.y, p.m, 0).getDate();
      fechaDesde = `${p.y}-${mm}-01`;
      fechaHasta = `${p.y}-${mm}-${String(lastD).padStart(2, '0')}`;
    } catch (e: unknown) {
      return { error: e instanceof Error ? e.message : 'fecha_invalida' };
    }
  }

  try {
    parseYmd(fechaDesde);
    parseYmd(fechaHasta);
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : 'fecha_invalida' };
  }

  let start: Timestamp;
  let end: Timestamp;
  try {
    ({ start, end } = arRangeTimestamps(fechaDesde, fechaHasta));
  } catch (e: unknown) {
    return { error: e instanceof Error ? e.message : 'fecha_invalida' };
  }

  const soloPanel = args.solo_activos_nomina_panel === true;
  const db = admin.firestore();
  const empSnap = await queryEmpleadosDocsScoped(db, ctx.empresaId, ctx.scopeEmpresa, 900);

  type EmpRow = { id: string; nombre: string; legajo: string; sortKey: string };
  const activos: EmpRow[] = [];

  for (const d of empSnap) {
    const data = d.data() as Record<string, unknown>;
    const st = data.status;
    if (soloPanel) {
      if (!esEmpleadoNominaTarjetaDashboard(st)) continue;
    } else if (!esLegajoActivoComoPantallaRRHH(st)) {
      continue;
    }

    const ln = String(data.lastName ?? '').trim();
    const fn = String(data.firstName ?? '').trim();
    const nombre =
      [ln, fn].filter(Boolean).join(', ') ||
      String(data.name ?? data.nombre ?? '').trim() ||
      '(sin nombre en legajo)';

    activos.push({
      id: d.id,
      nombre: nombre.slice(0, 120),
      legajo: String(data.fileNumber ?? '').trim(),
      sortKey: norm(`${ln} ${fn} ${nombre}`),
    });
  }

  const qsnap = await db
    .collection('turnos')
    .where('startTime', '>=', start)
    .where('startTime', '<=', end)
    .limit(TURNOS_PLANIFICADOS_UMBRAL_LIM)
    .get();

  const conTurno = new Set<string>();
  for (const doc of qsnap.docs) {
    const row = doc.data() as Record<string, unknown>;
    if (!shiftCountsAsPlanificacionAsignada(row)) continue;
    if (!turnoRowBelongsToEmpresa(row, ctx.empresaId, ctx.scopeEmpresa)) continue;
    const empId = String(row.employeeId ?? '').trim();
    if (empId) conTurno.add(empId);
  }

  const sinTurno = activos.filter((e) => !conTurno.has(e.id));
  const conTurnoActivos = activos.length - sinTurno.length;
  sinTurno.sort((a, b) => a.sortKey.localeCompare(b.sortKey, 'es', { sensitivity: 'base' }));

  let limite = Math.floor(Number(args.limite ?? 60));
  if (!Number.isFinite(limite) || limite < 5) limite = 60;
  limite = Math.min(90, limite);

  const muestra = sinTurno.slice(0, limite).map((e) => ({
    id_firestore: e.id,
    nombre: e.nombre,
    legajo: e.legajo || undefined,
  }));

  return {
    rango: { desde_inclusive: fechaDesde, hasta_inclusive: fechaHasta },
    mes_yyyy_mm: fechaDesde.slice(0, 7),
    solo_activos_nomina_panel: soloPanel,
    cuenta_legajos_activos_evaluados: activos.length,
    cuenta_con_al_menos_un_turno: conTurnoActivos,
    cuenta_sin_ningun_turno: sinTurno.length,
    muestra_empleados_sin_turno: muestra,
    truncado_por_limite_muestra: sinTurno.length > limite,
    truncado_consulta_turnos_limite: qsnap.size >= TURNOS_PLANIFICADOS_UMBRAL_LIM,
    truncado_loteFirestore_900: empSnap.length >= 900,
    criterio:
      'Legajos activos sin ningún turno asignado en el rango (incluye F/V/L como planificación; excluye vacantes y cancelados).',
    nota_tras_herramienta:
      'Respondé cuenta_sin_ningun_turno vs cuenta_legajos_activos_evaluados. Listá todos los de muestra_empleados_sin_turno. Si 0, decilo claro. Para cargar turnos orientá a Planificación y Turnos.',
  };
}

/** Lista RRHH: activo/active o sin estado → activo; inactivo/inactive → baja. */
function esLegajoActivoComoPantallaRRHH(statusRaw: unknown): boolean {
  const s = String(statusRaw ?? '').trim().toLowerCase();
  if (!s) return true;
  if (s === 'activo' || s === 'active') return true;
  if (s === 'inactivo' || s === 'inactive') return false;
  return true;
}

/** Igual que tarjeta «EMPLEADOS EN NÓMINA» del panel de control (dashboard.tsx): solo esos tres status explícitos. */
function esEmpleadoNominaTarjetaDashboard(statusRaw: unknown): boolean {
  const s = String(statusRaw ?? '').trim().toLowerCase();
  return ['active', 'activo', 'activa'].includes(s);
}

/**
 * Conteo de legajos `empleados` por empresa.
 * Devuelve el mismo criterio que la tarjeta «EMPLEADOS EN NÓMINA» del panel (status explícito) y el criterio amplio de lista RRHH.
 */
export async function ejecutarContarEmpleadosPlantillaEmpresa(
  ctx: AssistantToolContext,
  args: { fecha_referencia?: string },
): Promise<Record<string, unknown>> {
  if (!canQueryEmpleadosPlantillaResumen(ctx)) {
    return { error: 'sin_permiso_legajos_requiere_rrhh_planificacion_operaciones_o_similar' };
  }

  const fechaRef = String(args.fecha_referencia ?? ctx.referenceDateYsMmDd).trim();
  try {
    parseYmd(fechaRef);
  } catch (e: any) {
    return { error: e?.message ?? 'fecha_invalida' };
  }
  const ym = fechaRef.slice(0, 7);

  const db = admin.firestore();
  const qsnap = await queryEmpleadosDocsScoped(db, ctx.empresaId, ctx.scopeEmpresa, 900);

  let activosPanelNomina = 0;
  let activosRrhhAmplio = 0;
  let inactivosExplicitos = 0;
  const muestra: Array<{ apellido_nombre: string; estado: string }> = [];

  for (const d of qsnap) {
    const row = d.data() as Record<string, unknown>;

    const st = row.status;
    if (esEmpleadoNominaTarjetaDashboard(st)) activosPanelNomina += 1;
    if (esLegajoActivoComoPantallaRRHH(st)) activosRrhhAmplio += 1;
    else inactivosExplicitos += 1;

    if (muestra.length < 12) {
      const ln = String(row.lastName ?? '').trim();
      const fn = String(row.firstName ?? '').trim();
      const name =
        [ln, fn].filter(Boolean).join(' ').trim() ||
        String(row.name ?? row.nombre ?? '').trim() ||
        '(sin nombre)';
      muestra.push({
        apellido_nombre: name.slice(0, 80),
        estado: String(st ?? '(vacío)').slice(0, 24),
      });
    }
  }

  return {
    fecha_referencia_para_rotulo: fechaRef,
    mes_calendario_yyyy_mm: ym,
    cuenta_para_tarjeta_panel_empleados_nomina: activosPanelNomina,
    cuenta_legajos_operativos_criterio_rrhh_incluye_sin_estado: activosRrhhAmplio,
    cuenta_legajos_inactivos_explicitos: inactivosExplicitos,
    cuenta_total_en_lote: activosRrhhAmplio + inactivosExplicitos,
    truncado_loteFirestore_900: qsnap.length >= 900,
    criterios: {
      panel_dashboard:
        'cuenta_para_tarjeta_panel_empleados_nomina = legajos con status exactamente activo/active/activa (misma regla que tarjeta EMPLEADOS EN NÓMINA del panel).',
      rrhh_lista:
        'cuenta_legajos_operativos_criterio_rrhh_incluye_sin_estado = activo/active o vacío u otros no marcados inactivo (lista RRHH).',
    },
    muestra_primeros_legajos: muestra,
    nota_tras_herramienta:
      'Respondé cuenta_para_tarjeta_panel_empleados_nomina en la primera oración si preguntan nómina del panel; cuenta_legajos_operativos_criterio_rrhh_incluye_sin_estado si piden «activos» en sentido RRHH. Si truncado_loteFirestore_900=true, aclaralo.',
  };
}

/**
 * Texto para system prompt: mismos helpers que las tools, en paralelo,
 * para anclar totales (evita p. ej. «150» cuando el panel muestra 62 en nómina).
 */
export type EmpresaMetricsSnapshotOptions = {
  /** Resumen presentes/ausentes del día (consulta pesada de turnos). */
  includeOperationsDay?: boolean;
};

export async function buildEmpresaMetricsSnapshotForPrompt(
  ctx: AssistantToolContext,
  options: EmpresaMetricsSnapshotOptions = {},
): Promise<string> {
  if (ctx.persona !== 'SYSTEM' || !ctx.empresaId.trim()) return '';

  const includeOps = options.includeOperationsDay === true;
  const jobs: Promise<string[] | null>[] = [];

  if (canQueryServiciosSlaResumen(ctx)) {
    jobs.push(
      (async (): Promise<string[] | null> => {
        try {
          const r = await ejecutarContarServiciosSlaVigentesEmpresa(ctx, {});
          if (String(r.error ?? '').trim()) return [`- Servicios SLA (mes referencia): error (${String(r.error)}).`];
          return [
            `- Contratos SLA que solapan el mes de la fecha referencia (KPI panel Servicios): ${String(r.cuenta_para_tarjeta_servicios_activos_del_mes ?? '—')}`,
            `- Objetivos distintos con SLA en ese mes: ${String(r.cuenta_objetivos_distintos_con_sla_en_ese_mes ?? '—')}`,
          ];
        } catch {
          return ['- Servicios SLA (mes referencia): no disponible en este turno.'];
        }
      })(),
    );
  }

  if (includeOps && canQueryOperationsDaySummary(ctx)) {
    jobs.push(
      (async (): Promise<string[] | null> => {
        try {
          const r = await ejecutarResumenPresenciasObjetivosDia(ctx, {});
          if (String(r.error ?? '').trim()) return [`- Operaciones (día referencia): error (${String(r.error)}).`];
          const t = r.totales as Record<string, unknown> | undefined;
          if (!t) return ['- Operaciones (día referencia): sin totales.'];
          return [
            `- Operaciones día referencia — turnos visibles: ${String(t.turnos_visibles_en_dia ?? '—')}; presentes: ${String(t.presentes ?? '—')}; ausentes: ${String(t.ausentes ?? '—')}; sin marcación: ${String(t.sin_marcacion_relevante ?? '—')}`,
          ];
        } catch {
          return ['- Operaciones (día referencia): no disponible en este turno.'];
        }
      })(),
    );
  }

  if (jobs.length === 0) return '';

  const blocks = await Promise.all(jobs);
  const flat = blocks.flatMap((b) => (b ?? []).filter(Boolean));

  return [
    '══ MÉTRICAS YA CALCULADAS EN ESTE TURNO (priorizá estas cifras para SLA u operaciones del día cuando coincidan; no inventes otras). Para otra fecha o desglose, usá herramientas. ══',
    ...flat,
    'Para «cuántos empleados en nómina/plantilla», usá **contar_empleados_plantilla_empresa** (cuenta_para_tarjeta_panel_empleados_nomina). Para clientes/objetivos CRM: **contar_clientes_empresa** y **listar_objetivos_cliente**.',
  ].join('\n');
}

function sanitizeGeminiStruct(value: unknown, depth = 0): unknown {
  if (depth > 10) return null;
  if (value === undefined) return null;
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value !== 'object') return String(value);
  if (Array.isArray(value)) {
    return value.slice(0, 96).map((x) => sanitizeGeminiStruct(x, depth + 1));
  }
  const o = value as Record<string, unknown>;
  const entries = Object.entries(o).slice(0, 64);
  const out: Record<string, unknown> = {};
  for (const [k, v] of entries) {
    out[k] = sanitizeGeminiStruct(v, depth + 1);
  }
  return out;
}

export async function dispatchAssistantToolCall(
  ctx: AssistantToolContext,
  name: string,
  rawArgs: unknown,
): Promise<Record<string, unknown>> {
  const args = typeof rawArgs === 'object' && rawArgs !== null ? (rawArgs as Record<string, unknown>) : {};
  let raw: Record<string, unknown>;
  try {
    raw = await dispatchAssistantToolCallInner(ctx, name, args);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[assistant] dispatch tool exception', { name, msg });
    return { error: 'excepcion_interna_herramienta', herramienta: name, detalle: msg.slice(0, 320) };
  }
  return sanitizeGeminiStruct(raw) as Record<string, unknown>;
}

async function dispatchAssistantToolCallInner(
  ctx: AssistantToolContext,
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  let raw: Record<string, unknown>;
  if (name === 'buscar_empleados_por_nombre') {
    raw = await ejecutarBuscarEmpleadosPorNombre(ctx, {
      texto: String(args.texto ?? ''),
      limite: args.limite != null ? Number(args.limite) : undefined,
    });
  } else if (name === 'listado_empleados_empresa') {
    raw = await ejecutarListadoEmpleadosEmpresa(ctx, {
      filtro_texto: args.filtro_texto != null ? String(args.filtro_texto) : undefined,
      limite: args.limite != null ? Number(args.limite) : undefined,
      solo_activos_nomina_panel: args.solo_activos_nomina_panel === true,
    });
  } else if (name === 'buscar_objetivos_por_nombre') {
    raw = await ejecutarBuscarObjetivosPorNombre(ctx, {
      texto: String(args.texto ?? ''),
      limite: args.limite != null ? Number(args.limite) : undefined,
    });
  } else if (name === 'consultar_turnos_empleado') {
    raw = await ejecutarConsultarTurnosEmpleado(ctx, {
      id_firestore_empleado: args.id_firestore_empleado != null ? String(args.id_firestore_empleado) : undefined,
      fecha_desde: String(args.fecha_desde ?? ''),
      fecha_hasta: String(args.fecha_hasta ?? ''),
    });
  } else if (name === 'resumen_presencias_objetivos_dia') {
    raw = await ejecutarResumenPresenciasObjetivosDia(ctx, {
      fecha: args.fecha != null ? String(args.fecha) : undefined,
      id_objetivo: args.id_objetivo != null ? String(args.id_objetivo) : undefined,
    });
  } else if (name === 'listado_turnos_operativos_dia') {
    raw = await ejecutarListadoTurnosOperativosDia(ctx, {
      fecha: args.fecha != null ? String(args.fecha) : undefined,
      id_objetivo: args.id_objetivo != null ? String(args.id_objetivo) : undefined,
      limite: args.limite != null ? Number(args.limite) : undefined,
      hora_inicio_cor: args.hora_inicio_cor != null ? String(args.hora_inicio_cor) : undefined,
      codigo_turno: args.codigo_turno != null ? String(args.codigo_turno) : undefined,
      solo_estado_presencia:
        args.solo_estado_presencia != null
          ? (String(args.solo_estado_presencia) as 'presente' | 'ausente' | 'sin_marcacion')
          : undefined,
    });
  } else if (name === 'listado_franco_ret_dia') {
    raw = await ejecutarListadoFrancoRetDia(ctx, {
      fecha: args.fecha != null ? String(args.fecha) : undefined,
      tipo: args.tipo != null ? String(args.tipo) : undefined,
      id_objetivo_cercania: args.id_objetivo_cercania != null ? String(args.id_objetivo_cercania) : undefined,
      limite: args.limite != null ? Number(args.limite) : undefined,
    });
  } else if (name === 'listado_ausentes_licencias_dia') {
    raw = await ejecutarListadoAusentesLicenciasDia(ctx, {
      fecha: args.fecha != null ? String(args.fecha) : undefined,
      id_objetivo: args.id_objetivo != null ? String(args.id_objetivo) : undefined,
      tipo: args.tipo != null ? String(args.tipo) : undefined,
      limite: args.limite != null ? Number(args.limite) : undefined,
    });
  } else if (name === 'contar_servicios_sla_vigentes_empresa') {
    raw = await ejecutarContarServiciosSlaVigentesEmpresa(ctx, {
      fecha: args.fecha != null ? String(args.fecha) : undefined,
    });
  } else if (name === 'contar_empleados_plantilla_empresa') {
    raw = await ejecutarContarEmpleadosPlantillaEmpresa(ctx, {
      fecha_referencia: args.fecha_referencia != null ? String(args.fecha_referencia) : undefined,
    });
  } else if (name === 'contar_clientes_empresa') {
    raw = await ejecutarContarClientesEmpresa(ctx, args);
  } else if (name === 'listado_clientes_empresa') {
    raw = await ejecutarListadoClientesEmpresa(ctx, {
      solo_activos: args.solo_activos !== false,
      limite: args.limite != null ? Number(args.limite) : undefined,
    });
  } else if (name === 'auditar_completitud_datos_clientes_empresa') {
    raw = await ejecutarAuditarCompletitudDatosClientesEmpresa(ctx, {
      solo_activos: args.solo_activos !== false,
      limite: args.limite != null ? Number(args.limite) : undefined,
      texto_cliente: args.texto_cliente != null ? String(args.texto_cliente) : undefined,
    });
  } else if (name === 'listar_objetivos_cliente') {
    raw = await ejecutarListarObjetivosCliente(ctx, {
      texto_cliente: args.texto_cliente != null ? String(args.texto_cliente) : undefined,
      limite: args.limite != null ? Number(args.limite) : undefined,
    });
  } else if (name === 'listado_empleados_horas_planificadas_umbral') {
    raw = await ejecutarListadoEmpleadosHorasPlanificadasUmbral(ctx, {
      umbral_horas: args.umbral_horas != null ? Number(args.umbral_horas) : undefined,
      fecha_desde: args.fecha_desde != null ? String(args.fecha_desde) : undefined,
      fecha_hasta: args.fecha_hasta != null ? String(args.fecha_hasta) : undefined,
      fecha_referencia: args.fecha_referencia != null ? String(args.fecha_referencia) : undefined,
      limite: args.limite != null ? Number(args.limite) : undefined,
    });
  } else if (name === 'listado_empleados_sin_turnos_planificados') {
    raw = await ejecutarListadoEmpleadosSinTurnosPlanificados(ctx, {
      fecha_desde: args.fecha_desde != null ? String(args.fecha_desde) : undefined,
      fecha_hasta: args.fecha_hasta != null ? String(args.fecha_hasta) : undefined,
      fecha_referencia: args.fecha_referencia != null ? String(args.fecha_referencia) : undefined,
      limite: args.limite != null ? Number(args.limite) : undefined,
      solo_activos_nomina_panel: args.solo_activos_nomina_panel === true,
    });
  } else if (name === 'resumen_horas_empleado_periodo') {
    let fechaDesde = String(args.fecha_desde ?? '').trim();
    let fechaHasta = String(args.fecha_hasta ?? '').trim();
    if (!fechaDesde || !fechaHasta) {
      try {
        const p = parseYmd(ctx.referenceDateYsMmDd);
        const mm = String(p.m).padStart(2, '0');
        const lastD = new Date(p.y, p.m, 0).getDate();
        fechaDesde = `${p.y}-${mm}-01`;
        fechaHasta = `${p.y}-${mm}-${String(lastD).padStart(2, '0')}`;
      } catch {
        /* ejecutarResumenHoras devolverá fecha_invalida */
      }
    }
    raw = await ejecutarResumenHorasEmpleadoPeriodo(ctx, {
      id_firestore_empleado: args.id_firestore_empleado != null ? String(args.id_firestore_empleado) : undefined,
      fecha_desde: fechaDesde,
      fecha_hasta: fechaHasta,
    });
  } else if (name === 'resumen_horas_objetivo_sla_periodo') {
    raw = await ejecutarResumenHorasObjetivoSlaPeriodo(ctx, {
      id_objetivo: args.id_objetivo != null ? String(args.id_objetivo) : undefined,
      texto_objetivo: args.texto_objetivo != null ? String(args.texto_objetivo) : undefined,
      fecha_referencia: args.fecha_referencia != null ? String(args.fecha_referencia) : undefined,
      id_servicio_sla: args.id_servicio_sla != null ? String(args.id_servicio_sla) : undefined,
    });
  } else if (name === 'resumen_horas_liquidacion_empresa_periodo') {
    raw = await ejecutarResumenHorasLiquidacionEmpresaPeriodo(ctx, {
      fecha_desde: args.fecha_desde != null ? String(args.fecha_desde) : undefined,
      fecha_hasta: args.fecha_hasta != null ? String(args.fecha_hasta) : undefined,
      fecha_referencia: args.fecha_referencia != null ? String(args.fecha_referencia) : undefined,
    });
  } else if (name === 'resumen_horas_sla_varios_objetivos') {
    const rawTextos = args.textos_objetivo;
    const textosArr = Array.isArray(rawTextos)
      ? rawTextos.map((x) => String(x))
      : rawTextos != null
        ? [String(rawTextos)]
        : undefined;
    raw = await ejecutarResumenHorasSlaVariosObjetivos(ctx, {
      textos_objetivo: textosArr,
      fecha_referencia: args.fecha_referencia != null ? String(args.fecha_referencia) : undefined,
      todos_servicios_activos_mes: args.todos_servicios_activos_mes === true,
      texto_cliente: args.texto_cliente != null ? String(args.texto_cliente) : undefined,
      limite: args.limite != null ? Number(args.limite) : undefined,
    });
  } else if (name === 'proponer_extender_jornada') {
    raw = await ejecutarProponerExtenderJornada(ctx, {
      id_firestore_empleado: args.id_firestore_empleado != null ? String(args.id_firestore_empleado) : undefined,
      texto_empleado: args.texto_empleado != null ? String(args.texto_empleado) : undefined,
      fecha: args.fecha != null ? String(args.fecha) : undefined,
      texto_objetivo: args.texto_objetivo != null ? String(args.texto_objetivo) : undefined,
    });
  } else if (name === 'proponer_cubrir_ausencia') {
    raw = await ejecutarProponerCubrirAusencia(ctx, {
      fecha: args.fecha != null ? String(args.fecha) : undefined,
      texto_objetivo: args.texto_objetivo != null ? String(args.texto_objetivo) : undefined,
      id_objetivo: args.id_objetivo != null ? String(args.id_objetivo) : undefined,
      banda: args.banda != null ? String(args.banda) : undefined,
      id_empleado_ausente: args.id_empleado_ausente != null ? String(args.id_empleado_ausente) : undefined,
    });
  } else if (name === 'proponer_crear_turno_refuerzo') {
    raw = await ejecutarProponerCrearTurnoRefuerzo(ctx, {
      id_firestore_empleado: args.id_firestore_empleado != null ? String(args.id_firestore_empleado) : undefined,
      texto_empleado: args.texto_empleado != null ? String(args.texto_empleado) : undefined,
      fecha: args.fecha != null ? String(args.fecha) : undefined,
      texto_objetivo: args.texto_objetivo != null ? String(args.texto_objetivo) : undefined,
      id_objetivo: args.id_objetivo != null ? String(args.id_objetivo) : undefined,
      banda: args.banda != null ? String(args.banda) : undefined,
    });
  } else if (name === 'proponer_confirmar_presencia') {
    raw = await ejecutarProponerConfirmarPresencia(ctx, {
      id_firestore_empleado: args.id_firestore_empleado != null ? String(args.id_firestore_empleado) : undefined,
      texto_empleado: args.texto_empleado != null ? String(args.texto_empleado) : undefined,
      fecha: args.fecha != null ? String(args.fecha) : undefined,
      texto_objetivo: args.texto_objetivo != null ? String(args.texto_objetivo) : undefined,
      id_objetivo: args.id_objetivo != null ? String(args.id_objetivo) : undefined,
    });
  } else if (name === 'proponer_registrar_ausencia') {
    raw = await ejecutarProponerRegistrarAusencia(ctx, {
      id_firestore_empleado: args.id_firestore_empleado != null ? String(args.id_firestore_empleado) : undefined,
      texto_empleado: args.texto_empleado != null ? String(args.texto_empleado) : undefined,
      fecha: args.fecha != null ? String(args.fecha) : undefined,
      texto_objetivo: args.texto_objetivo != null ? String(args.texto_objetivo) : undefined,
      id_objetivo: args.id_objetivo != null ? String(args.id_objetivo) : undefined,
      motivo: args.motivo != null ? String(args.motivo) : undefined,
    });
  } else if (name === 'proponer_cerrar_turno') {
    raw = await ejecutarProponerCerrarTurno(ctx, {
      id_firestore_empleado: args.id_firestore_empleado != null ? String(args.id_firestore_empleado) : undefined,
      texto_empleado: args.texto_empleado != null ? String(args.texto_empleado) : undefined,
      fecha: args.fecha != null ? String(args.fecha) : undefined,
      texto_objetivo: args.texto_objetivo != null ? String(args.texto_objetivo) : undefined,
      id_objetivo: args.id_objetivo != null ? String(args.id_objetivo) : undefined,
    });
  } else if (name === 'proponer_planificar_objetivo_mes') {
    raw = await ejecutarProponerPlanificarObjetivoMes(ctx, {
      texto_objetivo: args.texto_objetivo != null ? String(args.texto_objetivo) : undefined,
      id_objetivo: args.id_objetivo != null ? String(args.id_objetivo) : undefined,
      mes: args.mes != null ? Number(args.mes) : undefined,
      anio: args.anio != null ? Number(args.anio) : undefined,
    });
  } else if (name === 'consultar_vacantes_dia') {
    raw = await ejecutarConsultarVacantesDia(ctx, {
      fecha: args.fecha != null ? String(args.fecha) : undefined,
      texto_objetivo: args.texto_objetivo != null ? String(args.texto_objetivo) : undefined,
      id_objetivo: args.id_objetivo != null ? String(args.id_objetivo) : undefined,
    });
  } else if (name === 'resumen_ausencias_pendientes') {
    raw = await ejecutarResumenAusenciasPendientes(ctx, {
      fecha_desde: args.fecha_desde != null ? String(args.fecha_desde) : undefined,
      fecha_hasta: args.fecha_hasta != null ? String(args.fecha_hasta) : undefined,
      limite: args.limite != null ? Number(args.limite) : undefined,
    });
  } else if (name === 'ejecutar_auto_presencia_cierre') {
    raw = await ejecutarAutoPresenciaCierre(ctx, {
      simulacion: args.simulacion !== false,
    });
  } else {
    raw = { error: 'herramienta_desconocida', name };
  }
  return raw;
}

// ── Helpers compartidos para tools de propuesta ───────────────────────────────

function bandaToNewCode(code: string): string {
  if (code === 'N') return 'N12';
  return 'D12';
}

function bandaToHoraInicio(banda: string): string {
  if (banda === 'T') return '14:00';
  if (banda === 'N') return '22:00';
  if (banda === 'D12') return '06:00';
  if (banda === 'N12') return '18:00';
  return '06:00';
}

function bandaToHoraFin(banda: string): string {
  if (banda === 'T') return '22:00';
  if (banda === 'N') return '06:00';
  if (banda === 'D12') return '18:00';
  if (banda === 'N12') return '06:00';
  return '14:00';
}

function startOfDayAr(dateYmd: string): Date {
  const [y, m, d] = dateYmd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 3, 0, 0, 0));
}

function endOfDayAr(dateYmd: string): Date {
  const [y, m, d] = dateYmd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1, 3, 0, 0, 0));
}

async function resolverEmpleadoPorTexto(
  ctx: AssistantToolContext,
  texto: string,
): Promise<{ id: string; nombre: string } | null> {
  const db = admin.firestore();
  const n = norm(texto);
  const docs = await queryEmpleadosDocsScoped(db, ctx.empresaId, ctx.scopeEmpresa, 60);
  const matches = docs.filter((d) => {
    const data = d.data();
    const full = norm(`${data.firstName ?? ''} ${data.lastName ?? ''} ${data.name ?? ''}`);
    return full.includes(n) || n.split(' ').every((tok) => tok.length < 2 || full.includes(tok));
  });
  if (matches.length === 0) return null;
  const data = matches[0].data();
  const nombre = [data.lastName, data.firstName].filter(Boolean).join(', ') || data.name || matches[0].id;
  return { id: matches[0].id, nombre: String(nombre) };
}

async function resolverObjetivoPorTexto(
  ctx: AssistantToolContext,
  texto: string,
): Promise<{ id: string; nombre: string; clientId: string } | null> {
  const db = admin.firestore();
  const clientDocs = await queryClientsDocsScoped(db, ctx.empresaId, ctx.scopeEmpresa, 60);
  for (const clientDoc of clientDocs) {
    const data = clientDoc.data();
    const objetivos: any[] = Array.isArray(data.objetivos) ? data.objetivos : [];
    for (const obj of objetivos) {
      if (objectiveHaystackMatchesNeedle(texto, obj.name ?? '', data.name ?? '')) {
        return { id: String(obj.id ?? obj._id ?? ''), nombre: String(obj.name ?? ''), clientId: clientDoc.id };
      }
    }
  }
  return null;
}

async function ejecutarProponerExtenderJornada(
  ctx: AssistantToolContext,
  args: {
    id_firestore_empleado?: string;
    texto_empleado?: string;
    fecha?: string;
    texto_objetivo?: string;
  },
): Promise<Record<string, unknown>> {
  const fecha = args.fecha || ctx.referenceDateYsMmDd;
  let empleadoId = args.id_firestore_empleado;
  let empleadoNombre = empleadoId ?? '';

  if (!empleadoId && args.texto_empleado) {
    const found = await resolverEmpleadoPorTexto(ctx, args.texto_empleado);
    if (!found) return { error: 'empleado_no_encontrado', texto: args.texto_empleado };
    empleadoId = found.id;
    empleadoNombre = found.nombre;
  }
  if (!empleadoId) return { error: 'falta_empleado' };

  const db = admin.firestore();
  const startTs = Timestamp.fromDate(startOfDayAr(fecha));
  const endTs = Timestamp.fromDate(endOfDayAr(fecha));

  const q = db
    .collection('turnos')
    .where('employeeId', '==', empleadoId)
    .where('startTime', '>=', startTs)
    .where('startTime', '<', endTs)
    .limit(10);
  const snap = await q.get();

  let turnos = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as any[];
  if (ctx.scopeEmpresa) turnos = turnos.filter((t) => t.empresaId === ctx.empresaId);
  if (args.texto_objetivo) {
    turnos = turnos.filter((t) => objectiveHaystackMatchesNeedle(args.texto_objetivo!, t.objetivoNombre ?? '', ''));
  }

  const extensibles = turnos.filter((t) => ['M', 'T', 'N'].includes(t.code) && !t.isFranco && !t.draft);
  if (extensibles.length === 0) {
    return { error: 'sin_turno_extensible', empleado: empleadoNombre, fecha, turnos_encontrados: turnos.length };
  }

  const turno = extensibles[0];
  const nuevoCodigo = bandaToNewCode(turno.code);
  const label = `Extender turno ${turno.code} → ${nuevoCodigo} de ${empleadoNombre} el ${fecha}${turno.objetivoNombre ? ' en ' + turno.objetivoNombre : ''}`;

  return {
    turno_encontrado: { id: turno.id, code: turno.code, empleado: empleadoNombre, objetivo: turno.objetivoNombre ?? '' },
    nuevo_codigo: nuevoCodigo,
    accion_propuesta: {
      type: 'extender_jornada',
      label,
      payload: {
        shiftId: turno.id,
        nuevoCodigo,
        empleadoNombre,
        codigoActual: turno.code,
        objetivoNombre: turno.objetivoNombre ?? '',
        fecha,
      },
    },
  };
}

async function ejecutarProponerCubrirAusencia(
  ctx: AssistantToolContext,
  args: {
    fecha?: string;
    texto_objetivo?: string;
    id_objetivo?: string;
    banda?: string;
    id_empleado_ausente?: string;
  },
): Promise<Record<string, unknown>> {
  const fecha = args.fecha || ctx.referenceDateYsMmDd;
  const db = admin.firestore();

  let objetivoId = args.id_objetivo;
  let objetivoNombre = '';
  let clientId = '';

  if (!objetivoId && args.texto_objetivo) {
    const found = await resolverObjetivoPorTexto(ctx, args.texto_objetivo);
    if (!found) return { error: 'objetivo_no_encontrado', texto: args.texto_objetivo };
    objetivoId = found.id;
    objetivoNombre = found.nombre;
    clientId = found.clientId;
  }
  if (!objetivoId) return { error: 'falta_objetivo' };

  const startTs = Timestamp.fromDate(startOfDayAr(fecha));
  const endTs = Timestamp.fromDate(endOfDayAr(fecha));

  const turnosSnap = await db
    .collection('turnos')
    .where('objectiveId', '==', objetivoId)
    .where('startTime', '>=', startTs)
    .where('startTime', '<', endTs)
    .limit(60)
    .get();

  const turnosDia = turnosSnap.docs
    .map((d) => ({ id: d.id, ...d.data() })) as any[];
  const empleadosConTurno = new Set(turnosDia.map((t) => t.employeeId).filter(Boolean));

  const banda = args.banda ?? (args.id_empleado_ausente
    ? turnosDia.find((t) => t.employeeId === args.id_empleado_ausente)?.code ?? 'M'
    : 'M');

  const retDisponibles = turnosDia.filter((t) => t.code === 'RET' && !t.isFranco && t.employeeId !== args.id_empleado_ausente);
  const sinTurnoDocs = await queryEmpleadosDocsScoped(db, ctx.empresaId, ctx.scopeEmpresa, 60);
  const sinTurnoCandidatos = sinTurnoDocs
    .filter((d) => !empleadosConTurno.has(d.id))
    .slice(0, 5)
    .map((d) => {
      const data = d.data();
      return { id: d.id, nombre: [data.lastName, data.firstName].filter(Boolean).join(', ') || data.name || d.id };
    });

  const candidatos = [
    ...sinTurnoCandidatos.map((c) => ({ ...c, origen: 'SIN_TURNO' })),
    ...retDisponibles.slice(0, 3).map((t) => ({ id: t.employeeId, nombre: t.empleadoNombre ?? t.employeeId, origen: 'RET' })),
  ];

  if (candidatos.length === 0) {
    return { error: 'sin_candidatos', objetivo: objetivoNombre, fecha, banda };
  }

  const mejor = candidatos[0];
  const label = `Cubrir turno ${banda} en ${objetivoNombre || objetivoId} el ${fecha} con ${mejor.nombre} (${mejor.origen})`;

  return {
    candidatos,
    accion_propuesta: {
      type: 'cubrir_ausencia',
      label,
      payload: {
        empleadoId: mejor.id,
        empleadoNombre: mejor.nombre,
        objetivoId,
        clientId,
        objetivoNombre,
        banda,
        fecha,
        origenCandidato: mejor.origen,
      },
    },
  };
}

async function resolverTurnoPorEmpleadoFecha(
  empleadoId: string,
  fecha: string,
  objetivoId?: string,
): Promise<{ shiftId: string; code: string; objetivoId: string; objetivoNombre?: string; empresaId: string } | null> {
  const db = admin.firestore();
  const startTs = Timestamp.fromDate(startOfDayAr(fecha));
  const endTs = Timestamp.fromDate(endOfDayAr(fecha));
  const snap = await db
    .collection('turnos')
    .where('employeeId', '==', empleadoId)
    .where('startTime', '>=', startTs)
    .where('startTime', '<', endTs)
    .limit(10)
    .get();
  if (snap.empty) return null;
  let docs = snap.docs;
  if (objetivoId) docs = docs.filter((d) => d.data().objectiveId === objetivoId);
  const active = docs.filter((d) => {
    const data = d.data();
    return !data.isFranco && !data.draft && data.code !== 'F' && data.code !== 'FF' && data.code !== 'FP';
  });
  const chosen = active[0] ?? docs[0];
  if (!chosen) return null;
  const data = chosen.data();
  return {
    shiftId: chosen.id,
    code: String(data.code ?? ''),
    objetivoId: String(data.objectiveId ?? ''),
    objetivoNombre: data.objetivoNombre ? String(data.objetivoNombre) : undefined,
    empresaId: String(data.empresaId ?? ''),
  };
}

async function ejecutarProponerConfirmarPresencia(
  ctx: AssistantToolContext,
  args: {
    id_firestore_empleado?: string;
    texto_empleado?: string;
    fecha?: string;
    texto_objetivo?: string;
    id_objetivo?: string;
  },
): Promise<Record<string, unknown>> {
  const fecha = args.fecha || ctx.referenceDateYsMmDd;
  let empleadoId = args.id_firestore_empleado;
  let empleadoNombre = '';
  if (!empleadoId && args.texto_empleado) {
    const found = await resolverEmpleadoPorTexto(ctx, args.texto_empleado);
    if (!found) return { error: 'empleado_no_encontrado', texto: args.texto_empleado };
    empleadoId = found.id;
    empleadoNombre = found.nombre;
  }
  if (!empleadoId) return { error: 'falta_empleado' };

  let objetivoId = args.id_objetivo;
  let objetivoNombre = '';
  if (!objetivoId && args.texto_objetivo) {
    const found = await resolverObjetivoPorTexto(ctx, args.texto_objetivo);
    if (found) { objetivoId = found.id; objetivoNombre = found.nombre; }
  }

  const turno = await resolverTurnoPorEmpleadoFecha(empleadoId, fecha, objetivoId);
  if (!turno) return { error: 'turno_no_encontrado', empleado: empleadoNombre, fecha };
  if (!objetivoNombre && turno.objetivoNombre) objetivoNombre = turno.objetivoNombre;

  const label = `Confirmar presencia de ${empleadoNombre} (turno ${turno.code})${objetivoNombre ? ' en ' + objetivoNombre : ''} el ${fecha}`;
  return {
    accion_propuesta: {
      type: 'confirmar_presencia',
      label,
      payload: { shiftId: turno.shiftId, empleadoId, empleadoNombre, objetivoId: turno.objetivoId, objetivoNombre, fecha },
    },
  };
}

async function ejecutarProponerRegistrarAusencia(
  ctx: AssistantToolContext,
  args: {
    id_firestore_empleado?: string;
    texto_empleado?: string;
    fecha?: string;
    texto_objetivo?: string;
    id_objetivo?: string;
    motivo?: string;
  },
): Promise<Record<string, unknown>> {
  const fecha = args.fecha || ctx.referenceDateYsMmDd;
  let empleadoId = args.id_firestore_empleado;
  let empleadoNombre = '';
  if (!empleadoId && args.texto_empleado) {
    const found = await resolverEmpleadoPorTexto(ctx, args.texto_empleado);
    if (!found) return { error: 'empleado_no_encontrado', texto: args.texto_empleado };
    empleadoId = found.id;
    empleadoNombre = found.nombre;
  }
  if (!empleadoId) return { error: 'falta_empleado' };

  let objetivoId = args.id_objetivo;
  let objetivoNombre = '';
  if (!objetivoId && args.texto_objetivo) {
    const found = await resolverObjetivoPorTexto(ctx, args.texto_objetivo);
    if (found) { objetivoId = found.id; objetivoNombre = found.nombre; }
  }

  const turno = await resolverTurnoPorEmpleadoFecha(empleadoId, fecha, objetivoId);
  if (!turno) return { error: 'turno_no_encontrado', empleado: empleadoNombre, fecha };
  if (!objetivoNombre && turno.objetivoNombre) objetivoNombre = turno.objetivoNombre;

  const motivo = args.motivo ?? 'AA';
  const label = `Registrar ausencia de ${empleadoNombre} (${motivo}) el ${fecha}${objetivoNombre ? ' en ' + objetivoNombre : ''}`;
  return {
    accion_propuesta: {
      type: 'registrar_ausencia',
      label,
      payload: { shiftId: turno.shiftId, empleadoId, empleadoNombre, objetivoId: turno.objetivoId, objetivoNombre, fecha, motivo },
    },
  };
}

async function ejecutarProponerCerrarTurno(
  ctx: AssistantToolContext,
  args: {
    id_firestore_empleado?: string;
    texto_empleado?: string;
    fecha?: string;
    texto_objetivo?: string;
    id_objetivo?: string;
  },
): Promise<Record<string, unknown>> {
  const fecha = args.fecha || ctx.referenceDateYsMmDd;
  let empleadoId = args.id_firestore_empleado;
  let empleadoNombre = '';
  if (!empleadoId && args.texto_empleado) {
    const found = await resolverEmpleadoPorTexto(ctx, args.texto_empleado);
    if (!found) return { error: 'empleado_no_encontrado', texto: args.texto_empleado };
    empleadoId = found.id;
    empleadoNombre = found.nombre;
  }
  if (!empleadoId) return { error: 'falta_empleado' };

  let objetivoId = args.id_objetivo;
  let objetivoNombre = '';
  if (!objetivoId && args.texto_objetivo) {
    const found = await resolverObjetivoPorTexto(ctx, args.texto_objetivo);
    if (found) { objetivoId = found.id; objetivoNombre = found.nombre; }
  }

  const turno = await resolverTurnoPorEmpleadoFecha(empleadoId, fecha, objetivoId);
  if (!turno) return { error: 'turno_no_encontrado', empleado: empleadoNombre, fecha };
  if (!objetivoNombre && turno.objetivoNombre) objetivoNombre = turno.objetivoNombre;

  const label = `Cerrar turno ${turno.code} de ${empleadoNombre} el ${fecha}${objetivoNombre ? ' en ' + objetivoNombre : ''}`;
  return {
    accion_propuesta: {
      type: 'cerrar_turno',
      label,
      payload: { shiftId: turno.shiftId, empleadoId, empleadoNombre, objetivoId: turno.objetivoId, objetivoNombre, fecha },
    },
  };
}

async function ejecutarProponerPlanificarObjetivoMes(
  ctx: AssistantToolContext,
  args: {
    texto_objetivo?: string;
    id_objetivo?: string;
    mes?: number;
    anio?: number;
  },
): Promise<Record<string, unknown>> {
  let objetivoId = args.id_objetivo;
  let objetivoNombre = '';
  let clientId = '';
  if (!objetivoId && args.texto_objetivo) {
    const found = await resolverObjetivoPorTexto(ctx, args.texto_objetivo);
    if (!found) return { error: 'objetivo_no_encontrado', texto: args.texto_objetivo };
    objetivoId = found.id;
    objetivoNombre = found.nombre;
    clientId = found.clientId;
  }
  if (!objetivoId) return { error: 'falta_objetivo' };

  const refDate = new Date(ctx.referenceDateYsMmDd ?? new Date().toISOString().slice(0, 10));
  const year = args.anio ?? refDate.getFullYear();
  const month = args.mes ?? (refDate.getMonth() + 1);

  const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const mesNombre = MESES[(month - 1)] ?? String(month);

  const label = `Generar planificación CCT 6+2 para ${objetivoNombre || objetivoId} — ${mesNombre} ${year} (borradores para revisar)`;
  return {
    accion_propuesta: {
      type: 'planificar_objetivo_mes',
      label,
      payload: { objetivoId, clientId, objetivoNombre, year, month },
    },
  };
}

async function ejecutarConsultarVacantesDia(
  ctx: AssistantToolContext,
  args: { fecha?: string; texto_objetivo?: string; id_objetivo?: string },
): Promise<Record<string, unknown>> {
  const fecha = args.fecha || ctx.referenceDateYsMmDd;
  const db = admin.firestore();
  const startTs = Timestamp.fromDate(startOfDayAr(fecha));
  const endTs = Timestamp.fromDate(endOfDayAr(fecha));

  let objetivoId = args.id_objetivo;
  if (!objetivoId && args.texto_objetivo) {
    const found = await resolverObjetivoPorTexto(ctx, args.texto_objetivo);
    if (found) objetivoId = found.id;
  }

  let turnosSnap;
  if (objetivoId) {
    turnosSnap = await db.collection('turnos')
      .where('objectiveId', '==', objetivoId)
      .where('startTime', '>=', startTs)
      .where('startTime', '<', endTs)
      .limit(200)
      .get();
  } else {
    turnosSnap = await db.collection('turnos')
      .where('empresaId', '==', ctx.empresaId)
      .where('startTime', '>=', startTs)
      .where('startTime', '<', endTs)
      .limit(300)
      .get();
  }

  const turnos = turnosSnap.docs.map((d) => ({ id: d.id, ...d.data() })) as any[];
  const ausentes = turnos.filter((t) => t.isAbsent === true && !t.draft);
  const cubiertos = new Set(
    turnos.filter((t) => t.origin === 'OPERATIONS_COVERAGE' || t.resolvedBy === 'OPERACIONES').map((t) => t.objectiveId + t.code + (t.startTime?.seconds ?? 0))
  );

  const vacantes = ausentes.map((t) => ({
    objetivo: t.objetivoNombre ?? t.objectiveId,
    banda: t.code,
    empleado: t.empleadoNombre ?? t.employeeId,
    cubierto: cubiertos.has(t.objectiveId + t.code + (t.startTime?.seconds ?? 0)),
  }));

  if (vacantes.length === 0) return { mensaje: `No hay vacantes registradas para el ${fecha}.`, fecha };
  const sinCubrir = vacantes.filter((v) => !v.cubierto);
  return {
    fecha,
    total_vacantes: vacantes.length,
    sin_cubrir: sinCubrir.length,
    vacantes: vacantes.slice(0, 50),
    resumen: `${vacantes.length} vacante(s) el ${fecha}, ${sinCubrir.length} sin cubrir.`,
  };
}

async function ejecutarResumenAusenciasPendientes(
  ctx: AssistantToolContext,
  args: { fecha_desde?: string; fecha_hasta?: string; limite?: number },
): Promise<Record<string, unknown>> {
  const ref = ctx.referenceDateYsMmDd;
  const desde = args.fecha_desde || ref;
  const hasta = args.fecha_hasta || desde;
  const limite = Math.min(args.limite ?? 30, 80);
  const db = admin.firestore();

  const startTs = Timestamp.fromDate(startOfDayAr(desde));
  const endTs = Timestamp.fromDate(endOfDayAr(hasta));

  const turnosSnap = await db.collection('turnos')
    .where('empresaId', '==', ctx.empresaId)
    .where('isAbsent', '==', true)
    .where('startTime', '>=', startTs)
    .where('startTime', '<', endTs)
    .orderBy('startTime', 'asc')
    .limit(limite)
    .get();

  if (turnosSnap.empty) return { mensaje: `No hay ausencias registradas entre ${desde} y ${hasta}.` };

  const ausencias = turnosSnap.docs.map((d) => {
    const data = d.data() as any;
    const starTs: Timestamp = data.startTime;
    const fechaAR = new Date(starTs.toDate().getTime() - 3 * 3600000);
    const fechaStr = fechaAR.toISOString().slice(0, 10);
    return {
      fecha: fechaStr,
      empleado: data.empleadoNombre ?? data.employeeId,
      objetivo: data.objetivoNombre ?? data.objectiveId,
      banda: data.code,
      resuelto: data.resolvedBy === 'OPERACIONES' || data.isReportedToPlanning === true,
    };
  });

  const sinResolver = ausencias.filter((a) => !a.resuelto);
  return {
    rango: `${desde} a ${hasta}`,
    total_ausencias: ausencias.length,
    sin_resolver: sinResolver.length,
    ausencias,
    resumen: `${ausencias.length} ausencia(s) en el período, ${sinResolver.length} sin resolución de cobertura.`,
  };
}

async function ejecutarProponerCrearTurnoRefuerzo(
  ctx: AssistantToolContext,
  args: {
    id_firestore_empleado?: string;
    texto_empleado?: string;
    fecha?: string;
    texto_objetivo?: string;
    id_objetivo?: string;
    banda?: string;
  },
): Promise<Record<string, unknown>> {
  const fecha = args.fecha || ctx.referenceDateYsMmDd;
  const banda = args.banda ?? 'M';

  let empleadoId = args.id_firestore_empleado;
  let empleadoNombre = '';
  if (!empleadoId && args.texto_empleado) {
    const found = await resolverEmpleadoPorTexto(ctx, args.texto_empleado);
    if (!found) return { error: 'empleado_no_encontrado', texto: args.texto_empleado };
    empleadoId = found.id;
    empleadoNombre = found.nombre;
  }
  if (!empleadoId) return { error: 'falta_empleado' };

  let objetivoId = args.id_objetivo;
  let objetivoNombre = '';
  let clientId = '';
  if (!objetivoId && args.texto_objetivo) {
    const found = await resolverObjetivoPorTexto(ctx, args.texto_objetivo);
    if (!found) return { error: 'objetivo_no_encontrado', texto: args.texto_objetivo };
    objetivoId = found.id;
    objetivoNombre = found.nombre;
    clientId = found.clientId;
  }
  if (!objetivoId) return { error: 'falta_objetivo' };

  const horaInicio = bandaToHoraInicio(banda);
  const horaFin = bandaToHoraFin(banda);
  const label = `Crear refuerzo ${banda} (${horaInicio}–${horaFin}) para ${empleadoNombre} el ${fecha} en ${objetivoNombre || objetivoId}`;

  return {
    accion_propuesta: {
      type: 'crear_turno_refuerzo',
      label,
      payload: {
        empleadoId,
        empleadoNombre,
        objetivoId,
        clientId,
        objetivoNombre,
        banda,
        fecha,
        horaInicio,
        horaFin,
      },
    },
  };
}

async function ejecutarAutoPresenciaCierre(
  ctx: AssistantToolContext,
  args: { simulacion?: boolean },
): Promise<Record<string, unknown>> {
  const dryRun = args.simulacion !== false;
  const db = admin.firestore();
  const now = new Date();
  const nowTs = Timestamp.fromDate(now);

  const windowStart = Timestamp.fromDate(new Date(now.getTime() - 16 * 3600000));
  const windowEnd   = Timestamp.fromDate(new Date(now.getTime() +  2 * 3600000));

  const snap = await db.collection('turnos')
    .where('empresaId', '==', ctx.empresaId)
    .where('startTime', '>=', windowStart)
    .where('startTime', '<=', windowEnd)
    .where('draft', '==', false)
    .where('isFranco', '==', false)
    .limit(500)
    .get();

  // Índice para chequear relevos pendientes
  const byObjective = new Map<string, Array<{ startMs: number; isPresent: boolean; isCompleted: boolean; isAbsent: boolean }>>();
  for (const doc of snap.docs) {
    const t = doc.data() as any;
    const oid = String(t.objectiveId || '');
    if (!oid) continue;
    if (!byObjective.has(oid)) byObjective.set(oid, []);
    byObjective.get(oid)!.push({
      startMs: (t.startTime?.seconds ?? 0) * 1000,
      isPresent: !!t.isPresent,
      isCompleted: !!t.isCompleted,
      isAbsent: !!t.isAbsent,
    });
  }

  function hayRelevoPendiente(objectiveId: string, shiftEndMs: number): boolean {
    return (byObjective.get(objectiveId) ?? []).some(
      r => !r.isPresent && !r.isAbsent && !r.isCompleted && Math.abs(r.startMs - shiftEndMs) <= 90 * 60 * 1000,
    );
  }

  const presenciaMarcada: string[] = [];
  const turnosCerrados: string[] = [];
  const turnosEnRetencion: string[] = [];
  const batch = db.batch();
  let ops = 0;

  for (const doc of snap.docs) {
    const t = doc.data() as any;
    if (t.isAbsent || t.isVirtual) continue;
    const startMs = (t.startTime?.seconds ?? 0) * 1000;
    const endMs   = (t.endTime?.seconds   ?? 0) * 1000;
    const oid = String(t.objectiveId || '');
    const label = `${t.empleadoNombre ?? t.employeeId} (${t.code}) en ${t.objetivoNombre ?? oid}`;

    if (startMs <= now.getTime() && !t.isPresent && !t.isAbsent && !t.isCompleted) {
      presenciaMarcada.push(label);
      if (!dryRun) {
        batch.update(doc.ref, { isPresent: true, presentAt: nowTs, autoPresencia: true });
        ops++;
      }
    }

    if (endMs && endMs <= now.getTime() && t.isPresent && !t.isCompleted) {
      if (oid && hayRelevoPendiente(oid, endMs)) {
        turnosEnRetencion.push(label);
      } else {
        turnosCerrados.push(label);
        if (!dryRun) {
          batch.update(doc.ref, { status: 'COMPLETED', isCompleted: true, isPresent: false, realEndTime: nowTs, autoCierre: true });
          ops++;
          db.collection('novedades')
            .where('shiftId', '==', doc.id).where('status', '==', 'pending').limit(10).get()
            .then(ns => {
              if (ns.empty) return;
              const b2 = db.batch();
              ns.docs.filter(d => ['RETENCION_LARGA','RECARGO_12H','RETENCION_DETECTADA'].includes(d.data().type))
                .forEach(d => b2.update(d.ref, { status: 'ATENDIDA', atendidaAt: nowTs, atendidaPor: 'AUTO_AGENTE' }));
              return b2.commit();
            }).catch(() => {});
        }
      }
    }
  }

  if (!dryRun && ops > 0) await batch.commit();

  const modo = dryRun ? 'SIMULACIÓN' : 'EJECUTADO';
  const resumen = dryRun
    ? `[${modo}] Se marcarían ${presenciaMarcada.length} presencia(s) y cerrarían ${turnosCerrados.length} turno(s). ${turnosEnRetencion.length > 0 ? `${turnosEnRetencion.length} turno(s) en retención (relevo pendiente).` : ''}`
    : `[${modo}] ${presenciaMarcada.length} presencia(s) marcadas · ${turnosCerrados.length} turno(s) cerrados${turnosEnRetencion.length > 0 ? ` · ${turnosEnRetencion.length} en retención` : ''}.`;

  return {
    modo,
    turnos_evaluados: snap.size,
    presencias_marcadas: presenciaMarcada.length,
    turnos_cerrados: turnosCerrados.length,
    turnos_en_retencion: turnosEnRetencion.length,
    detalle_presencias: presenciaMarcada,
    detalle_cierres: turnosCerrados,
    detalle_retencion: turnosEnRetencion,
    resumen,
  };
}
