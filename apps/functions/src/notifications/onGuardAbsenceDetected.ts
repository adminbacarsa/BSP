/**
 * Cuando isAbsent cambia de false/undefined a true en un turno real,
 * marca el titular como la única representación del hueco (vacancyOrigin=ABSENCE).
 * No crea un turno hermano VACANTE_POR_AUSENCIA.
 */
import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import { arYmd, vacancyActionTargetAr } from '../common/arClock';
import { isRetShift, isZeroDurationShift } from '../common/retShift';

export async function stampTitularAbsenceVacancyMark(
  db: admin.firestore.Firestore,
  turnoId: string,
): Promise<'STAMPED' | 'SKIPPED'> {
  const ref = db.collection('turnos').doc(turnoId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return 'SKIPPED';
    const after = snap.data() || {};
    if (after.vacancyCreatedForAbsence === true) return 'SKIPPED';
    if (isRetShift(after) || isZeroDurationShift(after)) return 'SKIPPED';
    if (after.employeeId === 'VACANTE' || after.isUnassigned) return 'SKIPPED';
    const skipOrigins = new Set([
      'RETEN', 'OPERATIONS_COVERAGE', 'SLA_VIRTUAL',
      'VACANTE_CORRECCION', 'VACANTE_POR_EVENTO', 'VACANTE_POR_AUSENCIA',
    ]);
    if (skipOrigins.has(String(after.origin || ''))) return 'SKIPPED';
    tx.update(ref, {
      vacancyCreatedForAbsence: true,
      vacancyOrigin: 'ABSENCE',
    });
    return 'STAMPED';
  });
}

export const onGuardAbsenceDetected = functions
  .runWith({ timeoutSeconds: 30, memory: '256MB' })
  .firestore.document('turnos/{turnoId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data() || {};
    const after  = change.after.data()  || {};

    if (before.isAbsent === true || after.isAbsent !== true) return;
    if (after.employeeId === 'VACANTE' || after.isUnassigned) return;
    if (after.vacancyCreatedForAbsence === true) return;
    if (isRetShift(after) || isZeroDurationShift(after)) return;
    const skipOrigins = new Set(['RETEN', 'OPERATIONS_COVERAGE', 'SLA_VIRTUAL',
                                 'VACANTE_CORRECCION', 'VACANTE_POR_EVENTO', 'VACANTE_POR_AUSENCIA']);
    if (skipOrigins.has(String(after.origin || ''))) return;

    const empresaId = typeof after.empresaId === 'string' ? after.empresaId : null;
    if (!empresaId) return;

    const turnoId = context.params.turnoId;
    const db = admin.firestore();
    const result = await stampTitularAbsenceVacancyMark(db, turnoId);
    if (result !== 'STAMPED') return;

    const scheduleDate = typeof after.scheduleDate === 'string'
      ? after.scheduleDate
      : (typeof after.startTime?.toMillis === 'function' ? arYmd(after.startTime.toMillis()) : '');
    const actionTarget = vacancyActionTargetAr(scheduleDate, Date.now());

    const sysSnap = await db.collection('system_users').where('empresaId', '==', empresaId).get();
    if (sysSnap.empty) return;

    const causedBy = String(after.employeeName || 'Guardia');
    const objectiveName = String(after.objectiveName || '');
    const positionName = String(after.positionName || '');
    const code = String(after.code || '');
    const slotDesc = `turno ${code} de ${causedBy}${positionName ? ` (${positionName})` : ''} del ${scheduleDate}`;
    const isPlan = actionTarget === 'PLANIFICACION';
    const type = isPlan ? 'VACANTE_PLANIFICACION' : 'VACANTE_OPERACIONES';
    const title = isPlan
      ? `Guardia ausente — vacante en ${objectiveName || 'puesto'}`
      : `⚠ Guardia ausente — cobertura urgente en ${objectiveName || 'puesto'}`;
    const body = isPlan
      ? `${causedBy} no se presentó al ${slotDesc}. Requiere reasignación.`
      : `${causedBy} no se presentó al ${slotDesc}. Se necesita cobertura inmediata.`;

    const ts = admin.firestore.FieldValue.serverTimestamp();
    const batch = db.batch();
    for (const userDoc of sysSnap.docs) {
      const uid = String(userDoc.data()?.uid || userDoc.id);
      batch.set(db.collection('user_notifications').doc(), {
        uid,
        userId: uid,
        empresaId,
        type,
        title,
        body,
        read: false,
        createdAt: ts,
        relatedTurnoId: turnoId,
        data: {
          turnoId,
          objectiveId: after.objectiveId || '',
          objectiveName,
          scheduleDate,
          code,
          positionName,
          actionTarget,
          origin: 'ABSENCE_TITULAR',
        },
      });
    }
    await batch.commit();
    console.log(
      `[onGuardAbsenceDetected] titular ${turnoId} marcado vacancyOrigin=ABSENCE empresa ${empresaId} actionTarget=${actionTarget}`,
    );
  });
