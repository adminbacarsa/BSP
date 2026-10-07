import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { isEventualPreviewSuperAdmin } from '../eventuales/eventualPreviewAuth';
import { aMs, turnoMuestraTarjetaRetencion } from './retencionTarjetaPura';

export type AcusarRetencionResult =
  | { ok: true; already: boolean; retencionAcuseAtMs: number; preview: boolean }
  | { ok: false; reason: 'NOT_FOUND' | 'NO_ES_TUYO' | 'RETENCION_CERRADA' };

export async function acusarRetencion(
  db: Firestore,
  params: {
    shiftId: string;
    authUid: string;
    actorName: string;
    role: unknown;
    type?: unknown;
    asEmployeeId?: string | null;
  },
): Promise<AcusarRetencionResult> {
  const shiftId = String(params.shiftId || '').trim();
  const authUid = String(params.authUid || '').trim();
  if (!shiftId || !authUid) return { ok: false, reason: 'NOT_FOUND' };
  const ref = db.collection('turnos').doc(shiftId);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, reason: 'NOT_FOUND' };
  const shift = (snap.data() || {}) as Record<string, unknown>;
  if (!turnoMuestraTarjetaRetencion(shift)) return { ok: false, reason: 'RETENCION_CERRADA' };

  const empId = String(shift.employeeId || '').trim();
  const ownSnap = await db.collection('empleados').where('uid', '==', authUid).limit(20).get();
  const propio = ownSnap.docs.some((doc) => doc.id === empId);
  const asId = String(params.asEmployeeId || '').trim();
  const sa = isEventualPreviewSuperAdmin(params.role, params.type);
  let preview = false;
  if (propio) preview = false;
  else if (sa && asId && asId === empId) preview = true;
  else return { ok: false, reason: 'NO_ES_TUYO' };

  const existing = aMs(shift.retencionAcuseAt);
  if (existing > 0) return { ok: true, already: true, retencionAcuseAtMs: existing, preview };

  const now = FieldValue.serverTimestamp();
  await ref.update({ retencionAcuseAt: now });
  const actor = String(params.actorName || '').trim() || 'Vigilador';
  const nombre = String(shift.employeeName || empId || '').trim();
  await db.collection('audit_logs').add({
    action: 'RETENCION_ACUSE',
    module: 'OPERACIONES',
    empresaId: shift.empresaId || null,
    actorId: authUid,
    actorName: actor,
    shiftId,
    employeeId: empId || null,
    employeeName: shift.employeeName || null,
    modo: preview ? 'preview' : 'app',
    timestamp: now,
    details: preview
      ? `Vista previa SuperAdmin: ${actor} acusó la retención de ${nombre}.`
      : `${actor} acusó la retención.`,
  });
  const fresh = await ref.get();
  return {
    ok: true,
    already: false,
    retencionAcuseAtMs: aMs(fresh.get('retencionAcuseAt')) || Date.now(),
    preview,
  };
}
