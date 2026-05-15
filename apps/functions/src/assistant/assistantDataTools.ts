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
    .limit(60)
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

export async function dispatchAssistantToolCall(
  ctx: AssistantToolContext,
  name: string,
  rawArgs: unknown,
): Promise<Record<string, unknown>> {
  const args = typeof rawArgs === 'object' && rawArgs !== null ? (rawArgs as Record<string, unknown>) : {};
  if (name === 'buscar_empleados_por_nombre') {
    return ejecutarBuscarEmpleadosPorNombre(ctx, {
      texto: String(args.texto ?? ''),
      limite: args.limite != null ? Number(args.limite) : undefined,
    });
  }
  if (name === 'consultar_turnos_empleado') {
    return ejecutarConsultarTurnosEmpleado(ctx, {
      id_firestore_empleado: args.id_firestore_empleado != null ? String(args.id_firestore_empleado) : undefined,
      fecha_desde: String(args.fecha_desde ?? ''),
      fecha_hasta: String(args.fecha_hasta ?? ''),
    });
  }
  return { error: 'herramienta_desconocida', name };
}
