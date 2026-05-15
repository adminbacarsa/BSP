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
  return canQueryShifts(ctx) || canUseEmployeeSearch(ctx);
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
  const objectiveIds = new Set(objectiveMap.keys());
  if (objectiveIds.size === 0) {
    return {
      fecha_referencia: fecha,
      nota: filterObj ? 'objetivo_no_encontrado_en_empresa' : 'sin_objetivos_para_esta_empresa',
      totales: { turnos_visibles_en_dia: 0, presentes: 0, ausentes: 0, sin_marcacion_relevante: 0 },
      por_objetivo: [],
    };
  }

  const { start, end } = monitorWideWindow(fecha);
  const qsnap = await db.collection('turnos').where('startTime', '>=', start).where('startTime', '<=', end).limit(2800).get();

  type Cand = {
    oid: string;
    needsPubCheck: boolean;
    shiftDateObj: Date;
    isPresent: boolean;
    isAbsent: boolean;
  };

  const candidates: Cand[] = [];
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

    candidates.push({ oid, needsPubCheck, shiftDateObj, isPresent, isAbsent });
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

  for (const c of candidates) {
    if (c.needsPubCheck) {
      const k = `${c.oid}_${ymCordoba(c.shiftDateObj)}`;
      if (!pubMap.get(k)) continue;
    }

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
    truncado_limite_turnos_consultados: qsnap.size >= 2800,
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

function sanitizeGeminiStruct(value: unknown, depth = 0): unknown {
  if (depth > 10) return null;
  if (value === undefined) return null;
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value !== 'object') return String(value);
  if (Array.isArray(value)) {
    return value.slice(0, 48).map((x) => sanitizeGeminiStruct(x, depth + 1));
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
  } else {
    raw = { error: 'herramienta_desconocida', name };
  }
  return sanitizeGeminiStruct(raw) as Record<string, unknown>;
}
