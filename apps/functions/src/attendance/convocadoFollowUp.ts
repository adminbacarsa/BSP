import { FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import * as admin from 'firebase-admin';
import { CONVOCADO_DELAY_GRACE_MIN } from '../common/convocadoEta';
import { logConvocatoriaEvento } from '../coverage/convocatoriaEventos';
import { buildOpsCoverageDocId } from '../coverage/syncAusenciaCobertura';
import { guardFirstName, guardLead } from '../common/pushGreeting';
import { shiftAlertPlatformConfig } from '../notifications/shiftAlertFcm';

async function tokensOf(db: Firestore, employeeId: string): Promise<string[]> {
  if (!employeeId) return [];
  const emp = await db.collection('empleados').doc(employeeId).get();
  const uid = String(emp.data()?.uid || '').trim();
  if (!uid) return [];
  const snap = await db.collection('device_tokens').where('uid', '==', uid).get();
  return snap.docs.map((d) => d.data()?.token).filter((t): t is string => typeof t === 'string' && t.length > 10);
}

async function punched(db: Firestore, conv: Record<string, unknown>): Promise<boolean> {
  const covId = buildOpsCoverageDocId(String(conv.shiftId || ''), String(conv.candidateEmployeeId || ''));
  if (!covId || covId.endsWith('_')) return false;
  const cov = await db.collection('turnos').doc(covId).get();
  const d = cov.data();
  return d?.isPresent === true || String(d?.status || '').toUpperCase() === 'PRESENT';
}

/**
 * Recordatorio a los 2/3 del ETA y aviso al CC si pasa la llegada estimada + 15 min.
 * Nunca marca ausencia.
 */
export async function runConvocadoFollowUp(db: Firestore, now: Timestamp = Timestamp.now()): Promise<number> {
  const nowMs = now.toMillis();
  const snap = await db.collection('convocatorias_cobertura').where('status', '==', 'ACCEPTED').limit(40).get();
  let n = 0;
  for (const doc of snap.docs) {
    const conv = doc.data() as Record<string, unknown>;
    if (String(conv.type || '') === 'EXTEND' || String(conv.type || '') === 'LLEGADA_TARDE') continue;
    if (await punched(db, conv)) continue;

    const reminderMs = (conv.reminderAt as Timestamp | undefined)?.toMillis?.() ?? 0;
    if (reminderMs > 0 && nowMs >= reminderMs && !conv.reminderSentAt) {
      const eta = Number(conv.etaMinutes) || 0;
      const name = guardFirstName({ employeeName: conv.candidateEmployeeName });
      const body = guardLead(name, '¿Seguís en camino? Si te demorás, avisanos en cuánto llegás.');
      const tokens = await tokensOf(db, String(conv.candidateEmployeeId || ''));
      if (tokens.length) {
        const platform = shiftAlertPlatformConfig();
        await admin.messaging().sendEachForMulticast({
          tokens,
          notification: { title: '¿Venís en camino?', body },
          data: {
            type: 'CONVOCADO_RECORDATORIO',
            convocatoriaId: doc.id,
            etaMinutes: String(eta),
          },
          android: platform.android,
          apns: platform.apns,
        }).catch(() => undefined);
      }
      await doc.ref.update({ reminderSentAt: now });
      const covId = buildOpsCoverageDocId(String(conv.shiftId || ''), String(conv.candidateEmployeeId || ''));
      await db.collection('turnos').doc(covId).update({ convocadoReminderSentAt: now }).catch(() => undefined);
      await logConvocatoriaEvento(db, doc.id, { type: 'RECORDATORIO', etaMinutes: eta, at: now });
      n += 1;
    }

    const expectedMs = (conv.expectedArrivalAt as Timestamp | undefined)?.toMillis?.() ?? 0;
    const alertedFor = (conv.delayAlertedForArrivalAt as Timestamp | undefined)?.toMillis?.() ?? 0;
    const due = expectedMs > 0 && nowMs >= expectedMs + CONVOCADO_DELAY_GRACE_MIN * 60 * 1000;
    if (due && alertedFor !== expectedMs) {
      await db.collection('novedades').add({
        type: 'CONVOCADO_DEMORADO',
        status: 'pending',
        priority: 'high',
        convocatoriaId: doc.id,
        shiftId: conv.shiftId || null,
        employeeId: conv.candidateEmployeeId || null,
        employeeName: conv.candidateEmployeeName || '',
        objectiveId: conv.objectiveId || null,
        objectiveName: conv.objectiveName || '',
        empresaId: conv.empresaId || null,
        title: 'Convocado demorado',
        description: `${conv.candidateEmployeeName || 'Convocado'} no fichó a la hora estimada. Esperar, llamar o cancelar y reconvocar.`,
        createdAt: FieldValue.serverTimestamp(),
        source: 'SYSTEM_SCHEDULER',
      });
      await doc.ref.update({ delayAlertedForArrivalAt: Timestamp.fromMillis(expectedMs), convocadoDemorado: true });
      const covId = buildOpsCoverageDocId(String(conv.shiftId || ''), String(conv.candidateEmployeeId || ''));
      await db.collection('turnos').doc(covId).update({ convocadoDemorado: true }).catch(() => undefined);
      await logConvocatoriaEvento(db, doc.id, { type: 'DEMORADO', at: now });
      n += 1;
    }
  }
  return n;
}
