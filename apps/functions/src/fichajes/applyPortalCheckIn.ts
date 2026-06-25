import * as admin from 'firebase-admin';
import type { PortalCheckInInput, PortalCheckInResult } from './fichajesTypes';
import { fichajeDocIdFromKey } from './sanitizeId';

async function applyCheckInToShift(
  db: FirebaseFirestore.Firestore,
  shiftId: string,
  shiftRef: FirebaseFirestore.DocumentReference,
  shiftData: FirebaseFirestore.DocumentData,
  empId: string,
  coords: PortalCheckInInput['coords'],
  recordedAt: string | null | undefined,
  nowTs: admin.firestore.Timestamp,
): Promise<void> {
  const now = admin.firestore.FieldValue.serverTimestamp();
  const nowMs = nowTs.toMillis();

  const scheduledStartTs = shiftData.startTime ?? null;
  const isEarlyStart = shiftData.isEarlyStart === true;
  const realStartTime = isEarlyStart
    ? (shiftData.adjustedStartTime || scheduledStartTs || now)
    : (scheduledStartTs || now);

  const scheduledStartMs = scheduledStartTs?.toMillis?.() ?? 0;
  const isLate = scheduledStartMs > 0 && nowMs > scheduledStartMs + 5 * 60 * 1000;

  await shiftRef.update({
    isPresent: true,
    status: 'PRESENT',
    checkInTime: now,
    realStartTime,
    checkInRequestedAt: now,
    checkInMethod: 'PORTAL_GPS',
    checkInCoords: coords || null,
    checkInRecordedAt: recordedAt || null,
    isLate,
  });

  try {
    await db.collection('novedades').add({
      type: 'INGRESO_AUTOREGISTRO',
      shiftId,
      employeeId: empId,
      employeeName: shiftData.employeeName || '',
      objectiveId: shiftData.objectiveId || '',
      objectiveName: shiftData.objectiveName || '',
      clientName: shiftData.clientName || '',
      empresaId: shiftData.empresaId || null,
      coords: coords || null,
      description: `Ingreso por portal: ${shiftData.employeeName || (await db.collection('empleados').doc(empId).get().then((d) => {
        const x = d.data();
        return x ? `${x.lastName || ''} ${x.firstName || ''}`.trim() : empId;
      }).catch(() => empId))}`,
      createdAt: now,
      status: 'unread',
      viewed: false,
    });
  } catch (e) {
    console.warn('[applyPortalCheckIn] No se pudo crear novedad:', (e as Error)?.message);
  }

  try {
    const objectiveId = shiftData.objectiveId || '';
    const positionName = (shiftData.positionName || '').trim().toLowerCase();
    const empresaId = shiftData.empresaId || null;
    const incomingName = shiftData.employeeName || 'Un guardia';
    const objectiveName = shiftData.objectiveName || '';

    if (!objectiveId || !positionName || !empresaId) return;

    const activeSnap = await db.collection('turnos')
      .where('empresaId', '==', empresaId)
      .where('objectiveId', '==', objectiveId)
      .where('isPresent', '==', true)
      .where('isCompleted', '==', false)
      .get();

    const incomingStartMs = shiftData.startTime?.toMillis?.() ?? nowMs;
    const FIFTEEN_MIN_MS = 15 * 60 * 1000;

    const toRelieve = activeSnap.docs
      .filter((d) => {
        const dat = d.data();
        if ((dat.positionName || '').trim().toLowerCase() !== positionName) return false;
        if (d.id === shiftId || dat.employeeId === empId) return false;
        if (dat.isRetention === true) return true;
        const outEndMs = dat.endTime?.toMillis?.() ?? 0;
        if (outEndMs > 0 && (outEndMs - nowMs) <= FIFTEEN_MIN_MS) return true;
        return false;
      })
      .sort((a, b) => {
        const da = a.data();
        const db2 = b.data();
        if (da.isRetention && !db2.isRetention) return -1;
        if (!da.isRetention && db2.isRetention) return 1;
        const aStart = da.realStartTime?.toMillis?.() ?? da.checkInTime?.toMillis?.() ?? da.startTime?.toMillis?.() ?? 0;
        const bStart = db2.realStartTime?.toMillis?.() ?? db2.checkInTime?.toMillis?.() ?? db2.startTime?.toMillis?.() ?? 0;
        return aStart - bStart;
      });

    for (const outDoc of toRelieve) {
      const outData = outDoc.data();
      const outEmpId = outData.employeeId as string;
      const outName = outData.employeeName || 'Guardia';
      const outPosName = outData.positionName || '';

      const outScheduledEndMs = outData.endTime?.toMillis?.() ?? 0;
      const isEarlyRelevo = outScheduledEndMs > 0 && nowMs < outScheduledEndMs;
      const outgoingRealEnd = isEarlyRelevo
        ? outData.endTime
        : admin.firestore.FieldValue.serverTimestamp();

      await outDoc.ref.update({
        isCompleted: true,
        isPresent: false,
        status: 'COMPLETED',
        realEndTime: outgoingRealEnd,
        relievedBy: empId,
        relievedByName: incomingName,
        relievedAt: admin.firestore.FieldValue.serverTimestamp(),
        autoRelevo: true,
        relievedEarly: isEarlyRelevo,
      });

      await db.collection('novedades').add({
        type: 'RELEVO_AUTOMATICO',
        status: 'ATENDIDA',
        empresaId,
        objectiveId,
        objectiveName,
        positionName: outPosName,
        employeeId: empId,
        employeeName: incomingName,
        relievedEmployeeId: outEmpId,
        relievedEmployeeName: outName,
        description: `${incomingName} relevó a ${outName} en ${objectiveName}${outPosName ? ` — ${outPosName}` : ''}`,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        autoProcessed: true,
        source: 'AUTO_RELEVO',
      });

      const outEmpDoc = await db.collection('empleados').doc(outEmpId).get();
      const outEmpUid = outEmpDoc.exists ? (outEmpDoc.data()?.uid as string | undefined) : undefined;

      const [byEmpId, byUid] = await Promise.all([
        db.collection('device_tokens').where('employeeId', '==', outEmpId).get(),
        outEmpUid
          ? db.collection('device_tokens').where('uid', '==', outEmpUid).get()
          : Promise.resolve({ docs: [] as FirebaseFirestore.QueryDocumentSnapshot[] }),
      ]);

      const tokenSet = new Set<string>();
      [...byEmpId.docs, ...byUid.docs].forEach((d) => {
        const t = d.data()?.token;
        if (typeof t === 'string' && t.length > 10) tokenSet.add(t);
      });
      const tokens = Array.from(tokenSet);

      const notifTitle = 'Turno finalizado — relevado';
      const notifBody = `Fuiste relevado por ${incomingName} en ${objectiveName}. Tu turno ha finalizado.`;

      let notifDocId: string | null = null;
      try {
        const notifRef = await db.collection('user_notifications').add({
          uid: outEmpUid || null,
          employeeId: outEmpId,
          title: notifTitle,
          body: notifBody,
          type: 'RELEVO_AUTOMATICO',
          target: 'employee',
          turnoId: outDoc.id,
          read: false,
          readAt: null,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        notifDocId = notifRef.id;
      } catch (e) {
        console.warn('[applyPortalCheckIn] Error guardando notificación relevo:', (e as Error)?.message);
      }

      if (tokens.length > 0) {
        try {
          const link = `/empleado/dashboard${notifDocId ? `?notif=${notifDocId}` : ''}`;
          await admin.messaging().sendEachForMulticast({
            data: {
              type: 'RELEVO_AUTOMATICO',
              title: notifTitle,
              body: notifBody,
              turnoId: outDoc.id,
              employeeId: outEmpId,
              notificationId: notifDocId || '',
              link,
            },
            webpush: {
              headers: { Urgency: 'high' },
              fcmOptions: { link },
            },
            tokens,
          });
        } catch (e) {
          console.warn('[applyPortalCheckIn] Error enviando push relevo:', (e as Error)?.message);
        }
      }
    }
  } catch (e) {
    console.warn('[applyPortalCheckIn] Error en auto-relevo:', (e as Error)?.message);
  }
}

/**
 * Registra fichaje CHECK_IN idempotente y consolida en el documento turno.
 */
export async function processPortalCheckIn(
  db: FirebaseFirestore.Firestore,
  input: PortalCheckInInput,
): Promise<PortalCheckInResult> {
  const { shiftId, empId, coords, recordedAt, idempotencyKey, source = 'PORTAL_GPS' } = input;

  const shiftRef = db.collection('turnos').doc(shiftId);
  const shiftDoc = await shiftRef.get();
  if (!shiftDoc.exists) {
    throw new Error('TURNO_NOT_FOUND');
  }
  const shiftData = shiftDoc.data()!;

  if (shiftData.isAbsent === true || shiftData.status === 'ABSENT') {
    throw new Error('SHIFT_ABSENT');
  }

  if (shiftData.isPresent === true || shiftData.status === 'PRESENT') {
    return { success: true, fichajeId: '', alreadyApplied: true };
  }

  const key = idempotencyKey?.trim() || `ci_${shiftId}_${recordedAt || Date.now()}`;
  const fichajeRef = db.collection('fichajes').doc(fichajeDocIdFromKey(key));
  const nowTs = admin.firestore.Timestamp.now();
  const now = admin.firestore.FieldValue.serverTimestamp();

  const existing = await fichajeRef.get();
  if (existing.exists) {
    const st = existing.data()?.status;
    if (st === 'APPLIED') {
      return { success: true, fichajeId: fichajeRef.id, alreadyApplied: true };
    }
    if (st === 'REJECTED') {
      throw new Error('FICHAJE_REJECTED');
    }
  }

  await fichajeRef.set({
    tipo: 'CHECK_IN',
    status: 'PENDING',
    shiftId,
    employeeId: empId,
    empresaId: shiftData.empresaId || null,
    coords: coords || null,
    recordedAt: recordedAt || null,
    idempotencyKey: key,
    source,
    createdAt: now,
    updatedAt: now,
  }, { merge: true });

  try {
    await applyCheckInToShift(db, shiftId, shiftRef, shiftData, empId, coords, recordedAt, nowTs);
    await fichajeRef.update({
      status: 'APPLIED',
      appliedAt: now,
      updatedAt: now,
    });
    return { success: true, fichajeId: fichajeRef.id };
  } catch (e) {
    await fichajeRef.update({
      status: 'REJECTED',
      errorMessage: (e as Error)?.message || 'unknown',
      updatedAt: now,
    }).catch(() => {});
    throw e;
  }
}
