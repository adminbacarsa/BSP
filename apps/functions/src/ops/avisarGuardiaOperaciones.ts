import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { guardFirstName } from '../common/pushGreeting';
import { crearConvocatoriaLlegadaTarde } from '../coverage/convocatoriasCobertura';
import { formatHmArgentina } from '../fichajes/relevoNotifications';

/**
 * Aviso manual por la app desde el Centro de Control (celular o escritorio).
 * - ENTRANTE: al guardia que tiene que relevar y no fichó → ¿Venís? (misma convocatoria
 *   LLEGADA_TARDE y mismas respuestas 10/15/30 o «no voy»; la respuesta la ve el CC).
 * - RETENIDO: al saliente que quedó esperando → «Seguís retenido, tu relevo … llega ~HH:MM / no llegó».
 * Llamar por teléfono queda como último recurso.
 */
export type AvisoManualKind = 'ENTRANTE' | 'RETENIDO';

/** No más de un aviso manual por guardia cada 5 min. */
export const AVISO_MANUAL_COOLDOWN_MS = 5 * 60 * 1000;

export type AvisoManualResult =
  | { ok: true; kind: AvisoManualKind; convocatoriaId?: string; resent?: boolean; body: string }
  | { ok: false; reason: 'TURNO_NOT_FOUND' | 'AVISO_RECIENTE' | 'SIN_EMPLEADO' | 'ESTADO_INVALIDO'; retryInSec?: number };

export function avisoManualCooldownRemainingMs(lastMs: number, nowMs: number): number {
  if (!lastMs || !Number.isFinite(lastMs)) return 0;
  return Math.max(0, lastMs + AVISO_MANUAL_COOLDOWN_MS - nowMs);
}

function lugarDe(shift: Record<string, unknown>): string {
  return [shift.objectiveName, shift.positionName]
    .map((s) => String(s || '').trim())
    .filter(Boolean)
    .join(' · ') || 'el puesto';
}

export function avisoEntranteBody(shift: Record<string, unknown>, firstName: string): string {
  const who = firstName ? `${firstName}, te esperan` : 'Te esperan';
  return `${who} en ${lugarDe(shift)}, ¿venís? Contanos si llegás en 10, 15 o 30 min.`;
}

export function avisoRetenidoBody(
  shift: Record<string, unknown>,
  firstName: string,
  relevo: { nombre: string; etaMs: number | null } | null,
): string {
  const lead = firstName ? `${firstName}, seguís retenido` : 'Seguís retenido';
  const donde = ` en ${lugarDe(shift)}`;
  if (!relevo || !relevo.nombre) {
    return `${lead}${donde}. Todavía no hay relevo confirmado. No abandones el puesto hasta que Operaciones te libere.`;
  }
  if (relevo.etaMs && relevo.etaMs > 0) {
    return `${lead}${donde}. Tu relevo ${relevo.nombre} llega ~${formatHmArgentina(relevo.etaMs)}. No abandones el puesto hasta que llegue o Operaciones te libere.`;
  }
  return `${lead}${donde}. Tu relevo ${relevo.nombre} no llegó. No abandones el puesto hasta que Operaciones te libere.`;
}

function tsMs(v: unknown): number {
  if (!v) return 0;
  if (v instanceof Timestamp) return v.toMillis();
  const t = v as { toMillis?: () => number; seconds?: number };
  if (typeof t.toMillis === 'function') return t.toMillis();
  if (typeof t.seconds === 'number') return t.seconds * 1000;
  return 0;
}

export async function avisarGuardiaOperaciones(
  db: Firestore,
  params: {
    shiftId: string;
    kind: AvisoManualKind;
    /** RETENIDO: turno del entrante que espera (para nombre y ETA). */
    relatedShiftId?: string | null;
    operatorUid: string;
    actorName: string;
    device?: string;
    nowMs?: number;
  },
): Promise<AvisoManualResult> {
  const nowMs = params.nowMs ?? Date.now();
  const ref = db.collection('turnos').doc(params.shiftId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, reason: 'TURNO_NOT_FOUND' };
  const shift = (snap.data() || {}) as Record<string, unknown>;
  const employeeId = String(shift.employeeId || '').trim();
  if (!employeeId || employeeId === 'VACANTE' || shift.isUnassigned === true) return { ok: false, reason: 'SIN_EMPLEADO' };

  const lastMs = tsMs(shift.opsAvisoManualAt);
  const remaining = avisoManualCooldownRemainingMs(lastMs, nowMs);
  if (remaining > 0) return { ok: false, reason: 'AVISO_RECIENTE', retryInSec: Math.ceil(remaining / 1000) };

  if (params.kind === 'ENTRANTE' && (shift.isPresent === true || shift.isCompleted === true)) {
    return { ok: false, reason: 'ESTADO_INVALIDO' };
  }
  if (params.kind === 'RETENIDO' && (shift.isPresent !== true || shift.isCompleted === true)) {
    return { ok: false, reason: 'ESTADO_INVALIDO' };
  }

  const empSnap = await db.collection('empleados').doc(employeeId).get();
  const emp = empSnap.exists ? (empSnap.data() || {}) : {};
  const uid = String(emp.uid || '').trim();
  const firstName = guardFirstName({ firstName: emp.firstName, employeeName: shift.employeeName || emp.nombre });
  const empresaId = String(shift.empresaId || '').trim() || null;
  const now = Timestamp.fromMillis(nowMs);

  let body = '';
  let convocatoriaId: string | undefined;
  let resent = false;

  if (params.kind === 'ENTRANTE') {
    body = avisoEntranteBody(shift, firstName);
    const created = await crearConvocatoriaLlegadaTarde(db, {
      id: snap.id,
      empresaId: empresaId || '',
      objectiveId: String(shift.objectiveId || ''),
      objectiveName: String(shift.objectiveName || ''),
      positionName: String(shift.positionName || ''),
      clientId: String(shift.clientId || ''),
      clientName: String(shift.clientName || ''),
      shiftCode: String(shift.code || '').toUpperCase(),
      startTime: shift.startTime as Timestamp,
      endTime: shift.endTime as Timestamp | undefined,
      employeeId,
      employeeName: String(shift.employeeName || ''),
      employeeUid: uid || undefined,
    }, { body, createdBy: params.operatorUid, resendIfPending: true });
    convocatoriaId = created?.convocatoriaId;
    resent = created?.resent === true;
  } else {
    let relevo: { nombre: string; etaMs: number | null } | null = null;
    const relatedId = String(params.relatedShiftId || shift.lateReliefIncomingShiftId || '').trim();
    if (relatedId) {
      const relSnap = await db.collection('turnos').doc(relatedId).get();
      const rel = (relSnap.data() || {}) as Record<string, unknown>;
      const nombre = String(rel.employeeName || shift.lateReliefIncomingName || '').trim();
      const etaMs = tsMs(rel.lateArrivalEtaAt) || tsMs(rel.expectedArrivalAt) || tsMs(shift.lateReliefEtaAt) || null;
      if (nombre) relevo = { nombre, etaMs: rel.isAbsent === true ? null : etaMs };
    } else if (shift.lateReliefIncomingName) {
      relevo = { nombre: String(shift.lateReliefIncomingName), etaMs: tsMs(shift.lateReliefEtaAt) || null };
    }
    body = avisoRetenidoBody(shift, firstName, relevo);
    await db.collection('user_notifications').add({
      uid: uid || null,
      employeeId,
      userId: employeeId,
      type: 'RETENCION_AVISO',
      title: '⛔ Seguís retenido',
      body,
      target: 'employee',
      turnoId: snap.id,
      shiftId: snap.id,
      relatedShiftId: relatedId || null,
      empresaId,
      objectiveId: shift.objectiveId || null,
      objectiveName: shift.objectiveName || null,
      positionName: shift.positionName || null,
      manual: true,
      read: false,
      readAt: null,
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  await ref.set({
    opsAvisoManualAt: now,
    opsAvisoManualKind: params.kind,
    opsAvisoManualBy: params.operatorUid,
    opsAvisoManualByName: params.actorName,
  }, { merge: true });

  await db.collection('audit_logs').add({
    action: 'AVISO_MANUAL_GUARDIA',
    module: 'OPERACIONES',
    empresaId,
    actorId: params.operatorUid,
    actorName: params.actorName,
    device: params.device || 'desktop',
    shiftId: snap.id,
    relatedShiftId: params.relatedShiftId || null,
    employeeId,
    employeeName: shift.employeeName || null,
    kind: params.kind,
    convocatoriaId: convocatoriaId || null,
    resent,
    body,
    timestamp: FieldValue.serverTimestamp(),
    details: `${params.actorName} avisó por la app a ${String(shift.employeeName || employeeId)} (${params.kind === 'ENTRANTE' ? '¿venís?' : 'seguís retenido'}).`,
  });

  return { ok: true, kind: params.kind, convocatoriaId, resent, body };
}
