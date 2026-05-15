import * as admin from 'firebase-admin';
import type { QueryDocumentSnapshot } from 'firebase-admin/firestore';
import type { AssistantPersona } from './resolveAssistantUser';

/** Zona operativa alineada al planificador web (Argentina). */
const AR_DAY_OFFSET = '-03:00';

export type AssistantToolContext = {
  persona: AssistantPersona;
  empresaId: string;
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
    start: admin.firestore.Timestamp.fromMillis(startMs),
    end: admin.firestore.Timestamp.fromMillis(endMs),
  };
}

type OperacionesDiaRowPublico = {
  oid: string;
  isPresent: boolean;
  isAbsent: boolean;
  codigo: string;
  puesto: string;
  empleado_etiqueta: string;
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

/** Turnos visibles en fecha (día Cordoba), mismas reglas que el monitor de Operaciones. */
async function queryTurnosVisiblesOperacionesEmpresaDia(
  db: FirebaseFirestore.Firestore,
  objectiveMap: Map<string, { name: string; clientId: string; clientName: string }>,
  fecha: string,
): Promise<{ rows: OperacionesDiaRowPublico[]; truncadoConsultaTurnos: boolean }> {
  const objectiveIds = new Set(objectiveMap.keys());
  const { start, end } = monitorWideWindow(fecha);
  const qsnap = await db.collection('turnos').where('startTime', '>=', start).where('startTime', '<=', end).limit(2800).get();

  type PreCand = {
    oid: string;
    needsPubCheck: boolean;
    shiftDateObj: Date;
    isPresent: boolean;
    isAbsent: boolean;
    codigo: string;
    puesto: string;
    empleado_etiqueta: string;
    cliente: string;
    objetivo_nombre: string;
    h_inicio_cordoba: string;
  };

  const pre: PreCand[] = [];
  const pubDocKeys = new Set<string>();

  for (const docSnap of qsnap.docs) {
    const shift = docSnap.data() as Record<string, unknown>;
    const st = shift.startTime;
    if (!(st instanceof admin.firestore.Timestamp)) continue;
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
      pubDocKeys.add(`${oid}_${ymCordoba(shiftDateObj)}`);
    }

    const isAbsent = !!shift.isAbsent;
    const isPresent = !!shift.isPresent && isValidEmployee && !isAbsent;
    const meta = objectiveMap.get(oid);
    const nombreEmp = String(shift.employeeName ?? '').trim();
    const empleado_etiqueta = isValidEmployee ? nombreEmp || empId.slice(0, 12) || '(legajo)' : 'VACANTE / sin asignar';

    pre.push({
      oid,
      needsPubCheck,
      shiftDateObj,
      isPresent,
      isAbsent,
      codigo: String(shift.code ?? shift.type ?? '').trim() || '—',
      puesto: rawPos,
      empleado_etiqueta,
      cliente: (meta?.clientName ?? String(shift.clientName ?? '').trim()) || '—',
      objetivo_nombre: (meta?.name ?? String(shift.objectiveName ?? '').trim()) || oid,
      h_inicio_cordoba: horaHmCordoba(shiftDateObj),
    });
  }

  const pubMap = new Map<string, boolean>();
  const refs = Array.from(pubDocKeys).map((k) => db.collection('planificacion_estados').doc(k));
  const chunk = 100;
  for (let i = 0; i < refs.length; i += chunk) {
    const slice = refs.slice(i, i + chunk);
    if (slice.length === 0) continue;
    const snaps = await db.getAll(...slice);
    for (let j = 0; j < snaps.length; j++) {
      pubMap.set(slice[j].id, snaps[j].exists);
    }
  }

  const rows: OperacionesDiaRowSorted[] = [];
  for (const c of pre) {
    if (c.needsPubCheck) {
      const k = `${c.oid}_${ymCordoba(c.shiftDateObj)}`;
      if (!pubMap.get(k)) continue;
    }
    rows.push({
      oid: c.oid,
      isPresent: c.isPresent,
      isAbsent: c.isAbsent,
      codigo: c.codigo,
      puesto: c.puesto,
      empleado_etiqueta: c.empleado_etiqueta,
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

  const outMapped: OperacionesDiaRowPublico[] = rows.map(({ shiftTsMs, ...rest }) => rest);

  return { rows: outMapped, truncadoConsultaTurnos: qsnap.size >= 2800 };
}

async function objectivesMapForEmpresa(
  db: FirebaseFirestore.Firestore,
  empresaId: string,
  filterObjectiveId?: string,
): Promise<Map<string, { name: string; clientId: string; clientName: string }>> {
  const out = new Map<string, { name: string; clientId: string; clientName: string }>();
  const filt = filterObjectiveId?.trim();
  const snap = await db.collection('clients').where('empresaId', '==', empresaId).limit(480).get();
  for (const d of snap.docs) {
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
  filterObjectiveId?: string,
): Promise<Map<string, ObjectiveMetaCoords>> {
  const out = new Map<string, ObjectiveMetaCoords>();
  const filt = filterObjectiveId?.trim();
  const snap = await db.collection('clients').where('empresaId', '==', empresaId).limit(480).get();
  for (const d of snap.docs) {
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
  const qsnap = await db.collection('turnos').where('startTime', '>=', start).where('startTime', '<=', end).limit(2800).get();

  const FRANCO_CODES = new Set(['F', 'FF', 'FP', 'FT']);
  const rows: FrancoRetRowInternal[] = [];

  for (const docSnap of qsnap.docs) {
    const shift = docSnap.data() as Record<string, unknown>;
    if (shift.status === 'Canceled') continue;
    const st = shift.startTime;
    if (!(st instanceof admin.firestore.Timestamp)) continue;
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
    rows.push({
      employee_firestore_id: empId,
      empleado_etiqueta: nombreEmp || empId.slice(0, 12),
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

  return { rows, truncado: qsnap.size >= 2800 };
}

async function empleadosCoordsBatch(
  db: FirebaseFirestore.Firestore,
  empresaId: string,
  empIds: string[],
): Promise<Map<string, { lat: number; lng: number }>> {
  const out = new Map<string, { lat: number; lng: number }>();
  const uniq = [...new Set(empIds)].filter(Boolean);
  const chunk = 100;
  for (let i = 0; i < uniq.length; i += chunk) {
    const slice = uniq.slice(i, i + chunk);
    const refs = slice.map((id) => db.collection('empleados').doc(id));
    const snaps = await db.getAll(...refs);
    for (let j = 0; j < snaps.length; j++) {
      const s = snaps[j];
      if (!s.exists) continue;
      const row = s.data() as Record<string, unknown>;
      const empE = String(row.empresaId ?? '').trim();
      if (empE && empE.toLowerCase() !== empresaId.toLowerCase()) continue;
      const lat = row.lat != null ? Number(row.lat) : NaN;
      const lng = row.lng != null ? Number(row.lng) : NaN;
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        out.set(s.id, { lat, lng });
      }
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
  const objectiveMap = await objectivesMapForEmpresa(db, ctx.empresaId, undefined);
  if (objectiveMap.size === 0) {
    return { fecha_referencia: fecha, nota: 'sin_objetivos_para_esta_empresa', cuenta: 0, filas: [] };
  }

  const { rows: raw, truncado } = await collectFrancoRetTurnosDia(db, objectiveMap, fecha, tipo);

  const idCerc = String(args.id_objetivo_cercania ?? '').trim();
  if (idCerc) {
    const withCoords = await objectivesMapWithCoordsForEmpresa(db, ctx.empresaId, undefined);
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
    const coords = await empleadosCoordsBatch(db, ctx.empresaId, empIds);

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

    return {
      fecha_referencia: fecha,
      tipo_filtro: tipo,
      objetivo_referencia_distancia: { id: idCerc, nombre: target.name, cliente: target.clientName },
      criterios:
        'Turnos del día (zona AR) con código F/FF/FP/FT (franco) o RET, objetivos de la empresa; incluye borradores/planificación. Distancia = Haversine entre lat/lng del legajo (RRHH) y el objetivo pedido.',
      cuenta_filas: raw.length,
      truncado_consulta_turnos: truncado,
      muestra_cap: lim,
      filas,
      empleados_sin_coordenadas_en_legajo_muestra: sinCoord.slice(0, 24),
      nota_tras_herramienta:
        'Ordená por distancia_km_al_objetivo_pedido ascendente; los null no tienen geolocalización en el legajo. No inventes nombres: usá solo campos de filas.',
    };
  }

  const filas = raw.slice(0, lim).map((r) => ({
    empleado: r.empleado_etiqueta,
    id_legajo: r.employee_firestore_id,
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
    filas,
    nota_tras_herramienta:
      'Para «quién está de franco» o «quién en RET» listá filas. Si pedís cercanía a un objetivo, llamá de nuevo con id_objetivo_cercania. No inventes nombres.',
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
  if (raw instanceof admin.firestore.Timestamp) {
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
      const ts = new admin.firestore.Timestamp(o.seconds, o.nanoseconds ?? 0);
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

async function empresaClientIdsSet(db: FirebaseFirestore.Firestore, empresaId: string): Promise<Set<string>> {
  const snap = await db.collection('clients').where('empresaId', '==', empresaId).limit(520).get();
  return new Set(snap.docs.map((d) => d.id));
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
    start: admin.firestore.Timestamp.fromMillis(t0),
    end: admin.firestore.Timestamp.fromMillis(t1),
  };
}

async function assertEmployeeInEmpresa(
  db: FirebaseFirestore.Firestore,
  employeeDocId: string,
  empresaId: string,
): Promise<FirebaseFirestore.DocumentData | null> {
  const ref = db.collection('empleados').doc(employeeDocId);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data() || {};
  const empE = String(data.empresaId ?? '').trim();
  if (empresaId && empE && empE.toLowerCase() !== empresaId.toLowerCase()) return null;
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
  const snap = await db.collection('empleados').where('empresaId', '==', ctx.empresaId).limit(400).get();
  const needle = norm(textoRaw.replace(/,/g, ' ').replace(/\s+/g, ' '));
  type Row = { id: string; nombre: string | null; clienteId?: string; preferredObjectiveId?: string };
  const out: Row[] = [];
  for (const d of snap.docs) {
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
  const qsnap = await db.collection('empleados').where('empresaId', '==', ctx.empresaId).limit(900).get();

  type Row = { id: string; nombreLegible: string; legajo: string; estado: string; sortKey: string };
  const rows: Row[] = [];

  for (const d of qsnap.docs) {
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
  const truncadoFirestore = qsnap.size >= 900;

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
  const snap = await db.collection('clients').where('empresaId', '==', ctx.empresaId).limit(480).get();
  const needle = norm(textoRaw);

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

  for (const d of snap.docs) {
    const data = d.data() as Record<string, unknown>;
    const clientName = String(data.name ?? '').trim() || d.id;
    const objetivosRaw = data.objetivos ?? data.objectives;
    const objetivos = Array.isArray(objetivosRaw) ? objetivosRaw : undefined;
    if (Array.isArray(objetivos)) {
      for (const o of objetivos as Array<Record<string, unknown>>) {
        const oid = String(o?.id ?? '').trim();
        if (!oid) continue;
        const oname = String(o?.name ?? '').trim() || oid;
        const nameNorm = norm(oname);
        const idNorm = norm(oid);
        if (!nameNorm.includes(needle) && !idNorm.includes(needle) && nameNorm !== needle) continue;
        pushObj(d.id, clientName, oid, oname, o);
        if (out.length >= limite * 5) break;
      }
    } else if (!objetivos) {
      const oid = d.id;
      const oname = clientName;
      const hay = norm(`${oname} ${oid}`);
      if (!hay.includes(needle)) continue;
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
  const empRow = await assertEmployeeInEmpresa(db, empId, ctx.empresaId);
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

  const qsnap = await db
    .collection('turnos')
    .where('employeeId', '==', empId)
    .where('startTime', '>=', start)
    .where('startTime', '<=', end)
    .limit(32)
    .get();

  const turnos = qsnap.docs.map((docSnap) => {
    const t = docSnap.data() as Record<string, unknown>;
    const ts = (x: unknown) => (x instanceof admin.firestore.Timestamp ? x.toDate().toISOString() : null);
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
      inicioUtc: ts(t.startTime),
      finUtc: ts(t.endTime),
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

function readFirestoreTs(row: Record<string, unknown>, key: string): admin.firestore.Timestamp | null {
  const v = row[key];
  if (v instanceof admin.firestore.Timestamp) return v;
  if (v && typeof v === 'object' && v !== null && 'seconds' in v) {
    const o = v as { seconds?: unknown; nanoseconds?: unknown };
    const s = Number(o.seconds);
    const n = Number(o.nanoseconds ?? 0);
    if (Number.isFinite(s)) return new admin.firestore.Timestamp(Math.floor(s), Number.isFinite(n) ? Math.floor(n) : 0);
  }
  return null;
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
  const empRow = await assertEmployeeInEmpresa(db, empId, ctx.empresaId);
  if (!empRow) return { error: 'empleado_inexistente_o_fuera_de_empresa' };

  const desde = String(args.fecha_desde ?? '').trim();
  const hasta = String(args.fecha_hasta ?? '').trim();
  let start: admin.firestore.Timestamp;
  let end: admin.firestore.Timestamp;
  try {
    ({ start, end } = arRangeTimestamps(desde, hasta));
  } catch (e: any) {
    return { error: e?.message ?? 'fecha_invalida' };
  }

  const LIM = 400;
  const qsnap = await db
    .collection('turnos')
    .where('employeeId', '==', empId)
    .where('startTime', '>=', start)
    .where('startTime', '<=', end)
    .limit(LIM)
    .get();

  let horasPlanCobertura = 0;
  let horasReales = 0;
  let turnosConReal = 0;
  let omitidos = 0;
  const porCodigo = new Map<string, { n: number; hs: number }>();

  const muestra: Array<Record<string, unknown>> = [];

  for (const docSnap of qsnap.docs) {
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

  return {
    empleado: {
      idFirestore: empId,
      nombreLegible: String((empRow as any).name ?? (empRow as any).nombre ?? '') || '(sin nombre en legajo)',
    },
    rango: { desde_inclusive: desde, hasta_inclusive: hasta },
    totales: {
      horas_planificadas_cobertura: Math.round(horasPlanCobertura * 10) / 10,
      horas_reales_fichadas_sumadas: Math.round(horasReales * 10) / 10,
      turnos_considerados: qsnap.size - omitidos,
      turnos_omitidos_cancelados_o_novedad: omitidos,
      turnos_con_horas_reales: turnosConReal,
    },
    por_codigo: porCodigoArr,
    truncado_consulta_turnos_limite: qsnap.size >= LIM,
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

function formatYmdCordobaFromTs(ts: admin.firestore.Timestamp): string {
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
  const objectiveMap = await objectivesMapForEmpresa(db, ctx.empresaId, filterObj);
  if (objectiveMap.size === 0) {
    return {
      fecha_referencia: fecha,
      nota: filterObj ? 'objetivo_no_encontrado_en_empresa' : 'sin_objetivos_para_esta_empresa',
      totales: { turnos_visibles_en_dia: 0, presentes: 0, ausentes: 0, sin_marcacion_relevante: 0 },
      por_objetivo: [],
    };
  }

  const { rows: visibleRows, truncadoConsultaTurnos } = await queryTurnosVisiblesOperacionesEmpresaDia(db, objectiveMap, fecha);

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
  args: { fecha?: string; id_objetivo?: string; limite?: number },
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
  const objectiveMap = await objectivesMapForEmpresa(db, ctx.empresaId, filterObj);
  if (objectiveMap.size === 0) {
    return {
      fecha_referencia: fecha,
      nota: filterObj ? 'objetivo_no_encontrado_en_empresa' : 'sin_objetivos_para_esta_empresa',
      cuenta_total_visible: 0,
      muestra_turnos: [],
    };
  }

  const { rows: visibleRows, truncadoConsultaTurnos } = await queryTurnosVisiblesOperacionesEmpresaDia(db, objectiveMap, fecha);

  const muestra = visibleRows.slice(0, lim).map((r) => ({
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
    cuenta_total_turnos_visibles: visibleRows.length,
    muestra_cap: lim,
    truncado_limite_turnos_consultados: truncadoConsultaTurnos,
    muestra_truncada_vs_total: visibleRows.length > muestra.length,
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
  const clientIds = await empresaClientIdsSet(db, ctx.empresaId);
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
  const qsnap = await db.collection('empleados').where('empresaId', '==', ctx.empresaId).limit(900).get();

  let activosPanelNomina = 0;
  let activosRrhhAmplio = 0;
  let inactivosExplicitos = 0;
  const muestra: Array<{ apellido_nombre: string; estado: string }> = [];

  for (const d of qsnap.docs) {
    const row = d.data() as Record<string, unknown>;
    const empE = String(row.empresaId ?? '').trim();
    if (empE && empE.toLowerCase() !== ctx.empresaId.toLowerCase()) continue;

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
    truncado_loteFirestore_900: qsnap.size >= 900,
    criterios: {
      panel_dashboard:
        'cuenta_para_tarjeta_panel_empleados_nomina = legajos con status exactamente activo/active/activa (misma regla que tarjeta EMPLEADOS EN NÓMINA del panel).',
      rrhh_lista:
        'cuenta_legajos_operativos_criterio_rrhh_incluye_sin_estado = activo/active o vacío u otros no marcados inactivo (lista RRHH).',
    },
    muestra_primeros_legajos: muestra,
    nota_tras_herramienta:
      'Para «cuántos vigiladores», «empleados en nómina», «plantilla» como la tarjeta del panel de control, respondé con **cuenta_para_tarjeta_panel_empleados_nomina**. Usá cuenta_legajos_operativos_criterio_rrhh_incluye_sin_estado solo si el usuario pide el criterio amplio de RRHH o comparación con listados que incluyen legajos sin estado cargado.',
  };
}

/**
 * Texto para system prompt: mismos helpers que las tools, en paralelo,
 * para anclar totales (evita p. ej. «150» cuando el panel muestra 62 en nómina).
 */
export async function buildEmpresaMetricsSnapshotForPrompt(ctx: AssistantToolContext): Promise<string> {
  if (ctx.persona !== 'SYSTEM' || !ctx.empresaId.trim()) return '';

  const jobs: Promise<string[] | null>[] = [];

  if (canQueryEmpleadosPlantillaResumen(ctx)) {
    jobs.push(
      (async (): Promise<string[] | null> => {
        try {
          const r = await ejecutarContarEmpleadosPlantillaEmpresa(ctx, {});
          if (String(r.error ?? '').trim()) return [`- Empleados/nómina: error (${String(r.error)}).`];
          const lines = [
            `- Empleados en nómina (tarjeta panel «EMPLEADOS EN NÓMINA», status activo explícito): ${String(r.cuenta_para_tarjeta_panel_empleados_nomina ?? '—')}`,
            `- Legajos activos criterio amplio RRHH (incluye sin estado): ${String(r.cuenta_legajos_operativos_criterio_rrhh_incluye_sin_estado ?? '—')}`,
          ];
          if (r.truncado_loteFirestore_900) {
            lines.push('- Aviso: consulta con límite 900 legajos; el conteo puede estar incompleto.');
          }
          return lines;
        } catch {
          return ['- Empleados/nómina: no disponible en este turno.'];
        }
      })(),
    );
  }

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

  if (canQueryOperationsDaySummary(ctx)) {
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
    '══ MÉTRICAS YA CALCULADAS EN ESTE TURNO (priorizá estas cifras para totales alineados al panel; no inventes otras). Para otra fecha o desglose, usá herramientas. ══',
    ...flat,
    'Si preguntan «cuántos empleados somos» en sentido plantilla/nómina del dashboard o RRHH, el número es el de «Empleados en nómina» arriba; el criterio amplio RRHH es distinto y solo aplica si lo piden explícito.',
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
    });
  } else if (name === 'listado_franco_ret_dia') {
    raw = await ejecutarListadoFrancoRetDia(ctx, {
      fecha: args.fecha != null ? String(args.fecha) : undefined,
      tipo: args.tipo != null ? String(args.tipo) : undefined,
      id_objetivo_cercania: args.id_objetivo_cercania != null ? String(args.id_objetivo_cercania) : undefined,
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
  } else if (name === 'resumen_horas_empleado_periodo') {
    raw = await ejecutarResumenHorasEmpleadoPeriodo(ctx, {
      id_firestore_empleado: args.id_firestore_empleado != null ? String(args.id_firestore_empleado) : undefined,
      fecha_desde: String(args.fecha_desde ?? ''),
      fecha_hasta: String(args.fecha_hasta ?? ''),
    });
  } else {
    raw = { error: 'herramienta_desconocida', name };
  }
  return sanitizeGeminiStruct(raw) as Record<string, unknown>;
}
