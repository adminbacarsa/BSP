import * as admin from 'firebase-admin';
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

export function assistantToolsEnabledForContext(ctx: AssistantToolContext): boolean {
  if (!ctx.empresaId) return false;
  if (ctx.persona === 'CLIENT') return false;
  return canQueryShifts(ctx) || canUseEmployeeSearch(ctx) || canQueryServiciosSlaResumen(ctx) || canQueryEmpleadosPlantillaResumen(ctx);
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

/** Inicio inclusivo AR y fin inclusivo para rango ISO (mismo día válido si from===to). */
function arRangeTimestamps(desdeYsMmDd: string, hastaYsMmDd: string): { start: FirebaseFirestore.Timestamp; end: FirebaseFirestore.Timestamp } {
  const a = parseYmd(desdeYsMmDd);
  const b = parseYmd(hastaYsMmDd);
  const t0 = Date.parse(`${a.y}-${String(a.m).padStart(2, '0')}-${String(a.d).padStart(2, '0')}T00:00:00.000${AR_DAY_OFFSET}`);
  const t1 = Date.parse(`${b.y}-${String(b.m).padStart(2, '0')}-${String(b.d).padStart(2, '0')}T23:59:59.999${AR_DAY_OFFSET}`);
  if (Number.isNaN(t0) || Number.isNaN(t1) || t1 < t0) throw new Error('rango de fechas inválido');
  if ((t1 - t0) / 86400000 > 33) throw new Error('el rango no puede superar ~31 días');
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
  const needle = norm(textoRaw);
  type Row = { id: string; nombre: string | null; clienteId?: string; preferredObjectiveId?: string };
  const out: Row[] = [];
  for (const d of snap.docs) {
    const data = d.data() as Record<string, unknown>;
    const name = String(data.name ?? data.nombre ?? '').trim();
    if (!name) continue;
    if (norm(name).includes(needle)) {
      out.push({
        id: d.id,
        nombre: name || null,
        clienteId: (data.clientId as string | undefined) ?? undefined,
        preferredObjectiveId: (data.preferredObjectiveId as string | undefined) ?? undefined,
      });
    }
    if (out.length >= limite * 4) break;
  }

  const sliced = out.slice(0, limite);
  if (sliced.length === 0) {
    return { coincidencias: [], nota: 'ningún resultado; probá otro fragmento del nombre/apellido' };
  }

  const ambigua = sliced.length >= 2;
  return {
    coincidencias: sliced.map((r) => ({ idFirestore: r.id, nombreLegible: r.nombre })),
    ambigua,
    nota_ambigua:
      ambigua && sliced.length <= limite
        ? 'varias personas similares: pedí al usuario aclaración o segundo apellido y volvé a buscar antes de declarar estado de presencia.'
        : undefined,
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

/** Conteo de SLA en `servicios_sla`: activos (`status`), cliente de esta empresa y vigentes en día ref (startDate/endDate inclusivos como en Pantalla Servicios). */
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
      cuenta_vigentes_en_fecha: 0,
      cuenta_filas_servicios_active_empresa_en_lote: 0,
      nota: 'ningún_cliente_de_esta_empresa_en_clients',
      muestra_servicios_vigentes: [],
    };
  }

  const qsnap = await db.collection('servicios_sla').where('status', '==', 'active').limit(800).get();
  let incompletosPeriodo = 0;
  let cuentaVigentes = 0;
  let cuentaFilasEmpresaEnQuery = 0;
  const vigentesParaMuestra: Array<Record<string, string>> = [];
  const incompletosMuestra: Array<Record<string, string>> = [];

  for (const docSnap of qsnap.docs) {
    const row = docSnap.data() as Record<string, unknown>;
    const cid = String(row.clientId ?? '').trim();
    if (!cid || !clientIds.has(cid)) continue;

    cuentaFilasEmpresaEnQuery += 1;

    const desde = slaCampoFechaYmD(row.startDate ?? row.desde ?? row.inicioContrato ?? '');
    const hasta = slaCampoFechaYmD(row.endDate ?? row.hasta ?? row.finContrato ?? '');
    if (!desde || !hasta) {
      incompletosPeriodo += 1;
      if (incompletosMuestra.length < 6) {
        incompletosMuestra.push({
          cliente: String(row.clientName ?? '').slice(0, 80),
          objetivo: String(row.objectiveName ?? '').slice(0, 80),
          id_doc_corto: docSnap.id.slice(0, 12),
          motivo_excluye_vigentes: 'falta_o_invalido_start_or_end_Date',
        });
      }
      continue;
    }

    const enVigencia = desde <= fecha && hasta >= fecha;
    if (!enVigencia) continue;

    cuentaVigentes += 1;
    const item = {
      cliente: String(row.clientName ?? cid).slice(0, 100),
      objetivo: String(row.objectiveName ?? row.objectiveId ?? '').slice(0, 100),
      desde,
      hasta,
      id_servicio_firestore_corto: docSnap.id.slice(0, 14),
    };
    if (vigentesParaMuestra.length < 80) vigentesParaMuestra.push(item);
  }

  const muestraLista = [...vigentesParaMuestra]
    .sort((a, b) => `${a.cliente} ${a.objetivo}`.localeCompare(`${b.cliente} ${b.objetivo}`, 'es'))
    .slice(0, 36);

  return {
    fecha_referencia: fecha,
    zona_fechas_contracto: 'America/Argentina/Cordoba interpretando Timestamps cuando existen',
    criterios:
      'status exactamente "active" en Firestore, clientId debe ser cliente de empresa (clients.empresaId), día ref entre startDate y endDate string-inclusivos YYYY-MM-DD.',
    cuenta_vigentes_en_fecha: cuentaVigentes,
    cuenta_filas_servicios_active_empresa_en_primer_loteFirestore: cuentaFilasEmpresaEnQuery,
    cuenta_activos_sin_rango_fechas_calendario: incompletosPeriodo,
    truncado_primer_loteFirestore_800_documentos_GLOBAL_active: qsnap.size >= 800,
    muestra_servicios_vigentes: muestraLista,
    muestra_activos_sin_fechas: incompletosMuestra,
    nota_tras_herramienta:
      'Primera frase: el número cuenta_vigentes_en_fecha. Si truncado_primer_loteFirestore_800, puede haber SLA activos no contados hasta ampliar la consulta. Si el usuario no pidió ubicación pantalla, no des tutorial largo.',
  };
}

/** Misma regla que RRHH lista: activo/active o sin estado → activo; inactivo/inactive → baja. */
function esLegajoActivoComoPantallaRRHH(statusRaw: unknown): boolean {
  const s = String(statusRaw ?? '').trim().toLowerCase();
  if (!s) return true;
  if (s === 'activo' || s === 'active') return true;
  if (s === 'inactivo' || s === 'inactive') return false;
  return true;
}

/**
 * Conteo de legajos `empleados` por empresa — para «cuántos empleados en plantilla», «cuántos activos», etc.
 * No cuenta turnos planificados del mes (eso sería otro criterio).
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

  let activos = 0;
  let inactivos = 0;
  const muestra: Array<{ apellido_nombre: string; estado: string }> = [];

  for (const d of qsnap.docs) {
    const row = d.data() as Record<string, unknown>;
    const empE = String(row.empresaId ?? '').trim();
    if (empE && empE.toLowerCase() !== ctx.empresaId.toLowerCase()) continue;

    const st = row.status;
    if (esLegajoActivoComoPantallaRRHH(st)) activos++;
    else inactivos++;

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
    cuenta_legajos_activos_misma_logica_rrhh: activos,
    cuenta_legajos_inactivos_explicitos: inactivos,
    cuenta_total_en_lote: activos + inactivos,
    truncado_loteFirestore_900: qsnap.size >= 900,
    aclaracion_plantilla:
      '«Plantilla» aquí = legajos en colección empleados de la empresa: activo = activo/active o sin estado (como pantalla RRHH). No incluye «sólo quienes tienen turno cargado en planificación del mes» salvo que pidan explícitamente ese criterio.',
    muestra_primeros_legajos: muestra,
    nota_tras_herramienta:
      'Primera oración: número de legajos activos. Si el usuario dijo «este mes» en sentido plantilla general, el dato es al día fecha_referencia; si querían dotación planificada en grilla, decí que es otro informe.',
  };
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
  } else if (name === 'contar_servicios_sla_vigentes_empresa') {
    raw = await ejecutarContarServiciosSlaVigentesEmpresa(ctx, {
      fecha: args.fecha != null ? String(args.fecha) : undefined,
    });
  } else if (name === 'contar_empleados_plantilla_empresa') {
    raw = await ejecutarContarEmpleadosPlantillaEmpresa(ctx, {
      fecha_referencia: args.fecha_referencia != null ? String(args.fecha_referencia) : undefined,
    });
  } else {
    raw = { error: 'herramienta_desconocida', name };
  }
  return sanitizeGeminiStruct(raw) as Record<string, unknown>;
}
