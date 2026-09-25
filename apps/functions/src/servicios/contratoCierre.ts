/**
 * Ciclo de vida del contrato (servicios_sla): al día siguiente de endDate queda cerrado.
 * Cerrado ≠ inactivo: `status` no cambia (los históricos siguen sumando sus horas SLA);
 * `closed: true` bloquea edición en Servicios y turnos en Planificación. Solo SuperAdmin reabre.
 */
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import * as functions from 'firebase-functions/v1';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { resolvePanelUserForUid } from '../ops/staffPermissions';

const TZ = 'America/Argentina/Buenos_Aires';

function todayAr(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ });
}

function ymd(v: unknown): string {
  if (!v) return '';
  const t = v as { toDate?: () => Date };
  if (typeof t.toDate === 'function') return t.toDate().toLocaleDateString('en-CA', { timeZone: TZ });
  return String(v).slice(0, 10);
}

function isCancelled(status: unknown): boolean {
  const st = String(status ?? '').trim().toLowerCase();
  return st === 'inactive' || st === 'inactivo' || st === 'cancelled' || st === 'cancelado';
}

export async function cerrarContratosVencidos(
  db: admin.firestore.Firestore,
  opts: { dryRun?: boolean; empresaId?: string | null } = {},
): Promise<{ closed: number; ids: string[] }> {
  const today = todayAr();
  const snap = await db.collection('servicios_sla').get();
  const toClose = snap.docs.filter((d) => {
    const x = d.data();
    if (x.closed === true || x.reopenedManually === true || isCancelled(x.status)) return false;
    if (opts.empresaId && String(x.empresaId || '') !== opts.empresaId) return false;
    const end = ymd(x.endDate);
    return !!end && end < today;
  });
  if (!opts.dryRun) {
    for (let i = 0; i < toClose.length; i += 400) {
      const batch = db.batch();
      for (const d of toClose.slice(i, i + 400)) {
        batch.update(d.ref, {
          closed: true,
          closedAt: FieldValue.serverTimestamp(),
          closedBy: 'SYSTEM_SCHEDULER',
          closedReason: 'VENCIDO',
        });
      }
      await batch.commit();
    }
  }
  return { closed: toClose.length, ids: toClose.map((d) => d.id) };
}

export const scheduledCerrarContratosVencidos = onSchedule(
  { schedule: '20 0 * * *', timeZone: TZ, timeoutSeconds: 300, memory: '256MiB' },
  async () => {
    const r = await cerrarContratosVencidos(admin.firestore());
    console.log(`[cerrarContratosVencidos] cerrados=${r.closed}`);
  },
);

/** Reabrir un contrato cerrado: solo SuperAdmin, motivo obligatorio, queda auditado. */
export const reabrirContratoSla = functions.https.onCall(async (data, context) => {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Autenticación requerida.');
  }
  const db = admin.firestore();
  const panel = await resolvePanelUserForUid(db, context.auth.uid, context.auth.token?.role);
  if (!panel?.isSuperAdmin) {
    throw new functions.https.HttpsError('permission-denied', 'Solo un SuperAdmin puede reabrir un contrato cerrado.');
  }
  const slaId = String((data as { slaId?: string })?.slaId || '').trim();
  const motivo = String((data as { motivo?: string })?.motivo || '').trim();
  if (!slaId) throw new functions.https.HttpsError('invalid-argument', 'slaId requerido.');
  if (motivo.length < 5) throw new functions.https.HttpsError('invalid-argument', 'Indicá el motivo de la reapertura.');
  const ref = db.collection('servicios_sla').doc(slaId);
  const snap = await ref.get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Contrato inexistente.');
  if (snap.data()?.closed !== true) return { success: true, alreadyOpen: true };
  const actor = String(context.auth.token?.email || panel.operatorName || context.auth.uid);
  await ref.update({
    closed: false,
    // Reabierto a mano: el cron no lo vuelve a cerrar hasta que un SuperAdmin lo cierre de nuevo.
    reopenedManually: true,
    reopenedAt: FieldValue.serverTimestamp(),
    reopenedBy: actor,
    reopenedByUid: context.auth.uid,
    reopenReason: motivo,
    closeHistory: FieldValue.arrayUnion({
      action: 'REABIERTO',
      by: actor,
      at: new Date().toISOString(),
      motivo,
    }),
  });
  return { success: true };
});

/** Volver a cerrar un contrato reabierto (SuperAdmin). */
export const cerrarContratoSla = functions.https.onCall(async (data, context) => {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Autenticación requerida.');
  }
  const db = admin.firestore();
  const panel = await resolvePanelUserForUid(db, context.auth.uid, context.auth.token?.role);
  if (!panel?.isSuperAdmin) {
    throw new functions.https.HttpsError('permission-denied', 'Solo un SuperAdmin puede cerrar un contrato.');
  }
  const slaId = String((data as { slaId?: string })?.slaId || '').trim();
  if (!slaId) throw new functions.https.HttpsError('invalid-argument', 'slaId requerido.');
  const actor = String(context.auth.token?.email || panel.operatorName || context.auth.uid);
  await db.collection('servicios_sla').doc(slaId).update({
    closed: true,
    reopenedManually: false,
    closedAt: FieldValue.serverTimestamp(),
    closedBy: actor,
    closedReason: 'MANUAL',
    closeHistory: FieldValue.arrayUnion({ action: 'CERRADO', by: actor, at: new Date().toISOString() }),
  });
  return { success: true };
});
