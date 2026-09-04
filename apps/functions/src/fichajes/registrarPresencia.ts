import * as admin from 'firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

export type PresenciaSource =
  | 'PORTAL_GPS'
  | 'OPERATIONS'
  | 'VIGI'
  | 'DEMO'
  | 'MANUAL_RADIO'
  | 'MANUAL_PHONE';

export type RegistrarPresenciaInput = {
  shiftId: string;
  source: PresenciaSource;
  /** Empleado dueño del turno (portal). Si falta, se toma del doc. */
  empId?: string | null;
  operatorUid?: string | null;
  actorName?: string | null;
  coords?: { lat?: number; lng?: number } | null;
  recordedAt?: string | null;
  /**
   * Si viene string: releva ese turno (override manual).
   * Si null explícito o skipAutoRelevo: no releva.
   * Si undefined: auto-FIFO 1:1.
   */
  overrideRelieveShiftId?: string | null;
  skipAutoRelevo?: boolean;
};

export type RegistrarPresenciaResult = {
  success: true;
  alreadyPresent?: boolean;
  relieved: {
    shiftId: string;
    employeeId: string;
    employeeName: string;
  } | null;
};

function normPos(n: unknown): string {
  return String(n ?? '')
    .trim()
    .toLowerCase();
}

/** Llegada real al puesto: check-in GPS/ops antes que horario planificado. */
function arrivalMs(dat: FirebaseFirestore.DocumentData): number {
  return (
    dat.checkInTime?.toMillis?.() ??
    dat.realStartTime?.toMillis?.() ??
    dat.presentAt?.toMillis?.() ??
    dat.startTime?.toMillis?.() ??
    0
  );
}

function isCambioCandidate(
  dat: FirebaseFirestore.DocumentData,
  nowMs: number,
  incomingStartMs: number,
): boolean {
  if (dat.isRetention === true) {
    const scheduledEnd = dat.endTime?.toMillis?.() ?? 0;
    return scheduledEnd >= incomingStartMs - 45 * 60 * 1000;
  }
  const outEndMs = dat.endTime?.toMillis?.() ?? 0;
  if (outEndMs <= 0) return false;
  return outEndMs - nowMs <= 15 * 60 * 1000;
}

async function resolvePositionCapacity(
  db: FirebaseFirestore.Firestore,
  objectiveId: string,
  positionName: string,
  empresaId: string | null,
): Promise<number> {
  try {
    let q: FirebaseFirestore.Query = db
      .collection('servicios_sla')
      .where('objectiveId', '==', objectiveId)
      .limit(15);
    if (empresaId) {
      q = db
        .collection('servicios_sla')
        .where('empresaId', '==', empresaId)
        .where('objectiveId', '==', objectiveId)
        .limit(15);
    }
    const snap = await q.get();
    const posNorm = normPos(positionName);
    for (const d of snap.docs) {
      const data = d.data();
      const status = String(data.status || data.estado || 'ACTIVE').toUpperCase();
      if (status === 'INACTIVE' || status === 'DELETED') continue;
      const positions: any[] = Array.isArray(data.positions) ? data.positions : [];
      const pos = positions.find((p) => normPos(p?.name) === posNorm);
      if (pos) {
        const qty = Number(pos.quantity);
        if (Number.isFinite(qty) && qty >= 1) return Math.floor(qty);
      }
    }
  } catch (e) {
    console.warn('[registrarPresencia] capacity lookup:', (e as Error)?.message);
  }
  return 1;
}

async function notifyRelieved(
  db: FirebaseFirestore.Firestore,
  params: {
    outEmpId: string;
    outDocId: string;
    incomingName: string;
    objectiveName: string;
    empresaId: string | null;
  },
): Promise<void> {
  const { outEmpId, outDocId, incomingName, objectiveName, empresaId } = params;
  try {
    const outEmpDoc = await db.collection('empleados').doc(outEmpId).get();
    const outEmpUid = outEmpDoc.exists ? (outEmpDoc.data()?.uid as string | undefined) : undefined;

    const notifTitle = 'Turno finalizado — relevado';
    const notifBody = `Fuiste relevado por ${incomingName} en ${objectiveName}. Tu turno ha finalizado.`;

    let notifDocId: string | null = null;
    try {
      const notifRef = await db.collection('user_notifications').add({
        uid: outEmpUid || null,
        employeeId: outEmpId,
        userId: outEmpId,
        title: notifTitle,
        body: notifBody,
        type: 'RELEVO_AUTOMATICO',
        target: 'employee',
        turnoId: outDocId,
        empresaId: empresaId || null,
        read: false,
        readAt: null,
        createdAt: FieldValue.serverTimestamp(),
      });
      notifDocId = notifRef.id;
    } catch (e) {
      console.warn('[registrarPresencia] notif doc:', (e as Error)?.message);
    }

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
    if (tokens.length === 0) return;

    const link = `/empleado/dashboard${notifDocId ? `?notif=${notifDocId}` : ''}`;
    await admin.messaging().sendEachForMulticast({
      data: {
        type: 'RELEVO_AUTOMATICO',
        title: notifTitle,
        body: notifBody,
        turnoId: outDocId,
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
    console.warn('[registrarPresencia] notifyRelieved:', (e as Error)?.message);
  }
}

/**
 * Motor único de presencia + auto-relevo FIFO 1:1.
 * Usado por portal, Operaciones, VIGI y (futuro) demo.
 */
export async function registrarPresencia(
  db: FirebaseFirestore.Firestore,
  input: RegistrarPresenciaInput,
): Promise<RegistrarPresenciaResult> {
  const {
    shiftId,
    source,
    coords,
    recordedAt,
    operatorUid,
    actorName,
    overrideRelieveShiftId,
    skipAutoRelevo,
  } = input;

  const shiftRef = db.collection('turnos').doc(shiftId);
  const shiftDoc = await shiftRef.get();
  if (!shiftDoc.exists) throw new Error('TURNO_NOT_FOUND');
  const shiftData = shiftDoc.data()!;

  if (shiftData.isAbsent === true || shiftData.status === 'ABSENT') {
    throw new Error('SHIFT_ABSENT');
  }

  if (shiftData.isPresent === true || shiftData.status === 'PRESENT') {
    return { success: true, alreadyPresent: true, relieved: null };
  }

  const empId = String(input.empId || shiftData.employeeId || '').trim();
  const nowTs = Timestamp.now();
  const nowMs = nowTs.toMillis();
  const now = FieldValue.serverTimestamp();

  const scheduledStartTs = shiftData.startTime ?? null;
  const isEarlyStart = shiftData.isEarlyStart === true;
  const realStartTime = isEarlyStart
    ? shiftData.adjustedStartTime || scheduledStartTs || now
    : scheduledStartTs || now;

  const scheduledStartMs = scheduledStartTs?.toMillis?.() ?? 0;
  const isLate = scheduledStartMs > 0 && nowMs > scheduledStartMs + 5 * 60 * 1000;

  const incomingPatch: Record<string, unknown> = {
    isPresent: true,
    status: 'PRESENT',
    checkInTime: now,
    realStartTime,
    checkInMethod: source,
    checkInCoords: coords || null,
    checkInRecordedAt: recordedAt || null,
    isLate,
    isAbsent: false,
    absenceType: null,
    absenceDetectedAt: null,
    lateArrivalAt: isLate ? now : null,
    presenciaSource: source,
    presenciaAt: now,
  };
  if (operatorUid) incomingPatch.checkInOperator = operatorUid;
  if (source === 'VIGI' || source === 'DEMO') {
    incomingPatch.modifiedByAgent = true;
    incomingPatch.modifiedByAgentAt = nowTs;
  }
  if (isLate || shiftData.absenceType === 'AA') {
    incomingPatch.absenceReversedAt = now;
    incomingPatch.absenceReversedBy = source === 'OPERATIONS' ? 'OPERACIONES' : source;
  }

  await shiftRef.update(incomingPatch);

  // Novedad ingreso (no bloqueante)
  void db
    .collection('novedades')
    .add({
      type: 'INGRESO_AUTOREGISTRO',
      shiftId,
      employeeId: empId,
      employeeName: shiftData.employeeName || '',
      objectiveId: shiftData.objectiveId || '',
      objectiveName: shiftData.objectiveName || '',
      clientName: shiftData.clientName || '',
      empresaId: shiftData.empresaId || null,
      coords: coords || null,
      source,
      description: `Ingreso (${source}): ${shiftData.employeeName || empId}`,
      createdAt: now,
      status: 'unread',
      viewed: false,
    })
    .catch((e) => console.warn('[registrarPresencia] novedad ingreso:', (e as Error)?.message));

  let relieved: RegistrarPresenciaResult['relieved'] = null;

  const wantSkip =
    skipAutoRelevo === true ||
    overrideRelieveShiftId === null;
  const wantOverride =
    typeof overrideRelieveShiftId === 'string' && overrideRelieveShiftId.trim().length > 0;

  if (!wantSkip) {
    try {
      const objectiveId = String(shiftData.objectiveId || '').trim();
      const positionName = String(shiftData.positionName || '').trim();
      const empresaId = shiftData.empresaId ? String(shiftData.empresaId) : null;
      const incomingName = shiftData.employeeName || 'Un guardia';
      const objectiveName = shiftData.objectiveName || '';
      const incomingStartMs = shiftData.startTime?.toMillis?.() ?? nowMs;

      if (objectiveId && positionName) {
        let outDoc: FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot | null =
          null;

        if (wantOverride) {
          const ov = await db.collection('turnos').doc(overrideRelieveShiftId!.trim()).get();
          if (ov.exists) {
            const od = ov.data()!;
            if (
              od.isPresent &&
              !od.isCompleted &&
              String(od.objectiveId || '') === objectiveId &&
              normPos(od.positionName) === normPos(positionName) &&
              ov.id !== shiftId
            ) {
              outDoc = ov;
            }
          }
        } else {
          let activeSnap: FirebaseFirestore.QuerySnapshot;
          if (empresaId) {
            activeSnap = await db
              .collection('turnos')
              .where('empresaId', '==', empresaId)
              .where('objectiveId', '==', objectiveId)
              .where('isPresent', '==', true)
              .where('isCompleted', '==', false)
              .get();
          } else {
            activeSnap = await db
              .collection('turnos')
              .where('objectiveId', '==', objectiveId)
              .where('isPresent', '==', true)
              .where('isCompleted', '==', false)
              .get();
          }

          const samePost = activeSnap.docs.filter((d) => {
            const dat = d.data();
            if (normPos(dat.positionName) !== normPos(positionName)) return false;
            if (d.id === shiftId) return false;
            if (empId && dat.employeeId === empId) return false;
            return true;
          });

          const fifo = (a: FirebaseFirestore.QueryDocumentSnapshot, b: FirebaseFirestore.QueryDocumentSnapshot) => {
            const da = a.data();
            const db2 = b.data();
            if (da.isRetention && !db2.isRetention) return -1;
            if (!da.isRetention && db2.isRetention) return 1;
            return arrivalMs(da) - arrivalMs(db2);
          };

          const cambio = samePost
            .filter((d) => isCambioCandidate(d.data(), nowMs, incomingStartMs))
            .sort(fifo);

          let pool = cambio;
          if (pool.length === 0) {
            const capacity = await resolvePositionCapacity(db, objectiveId, positionName, empresaId);
            // Tras marcar entrante, los presentes previos: si ya estaban al tope, liberar 1.
            if (samePost.length >= capacity) {
              pool = [...samePost].sort(fifo);
            }
          }

          outDoc = pool[0] ?? null;
        }

        if (outDoc) {
          const outData = outDoc.data()!;
          const outEmpId = String(outData.employeeId || '');
          const outName = outData.employeeName || 'Guardia';
          const outPosName = outData.positionName || '';
          const outScheduledEndMs = outData.endTime?.toMillis?.() ?? 0;
          const isEarlyRelevo = outScheduledEndMs > 0 && nowMs < outScheduledEndMs;
          const outgoingRealEnd = isEarlyRelevo ? outData.endTime : FieldValue.serverTimestamp();

          await outDoc.ref.update({
            isCompleted: true,
            isPresent: false,
            status: 'COMPLETED',
            realEndTime: outgoingRealEnd,
            relievedBy: empId || null,
            relievedByName: incomingName,
            relievedAt: FieldValue.serverTimestamp(),
            autoRelevo: !wantOverride,
            relievedEarly: isEarlyRelevo,
            relievedSource: source,
          });

          relieved = {
            shiftId: outDoc.id,
            employeeId: outEmpId,
            employeeName: outName,
          };

          void db
            .collection('novedades')
            .add({
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
              description: `${incomingName} relevó a ${outName} en ${objectiveName}${outPosName ? ` — ${outPosName}` : ''} (${source})`,
              createdAt: FieldValue.serverTimestamp(),
              autoProcessed: !wantOverride,
              source: wantOverride ? source : 'AUTO_RELEVO',
            })
            .catch(() => {});

          if (outEmpId) {
            void notifyRelieved(db, {
              outEmpId,
              outDocId: outDoc.id,
              incomingName,
              objectiveName,
              empresaId,
            });
          }
        }
      }
    } catch (e) {
      console.warn('[registrarPresencia] auto-relevo:', (e as Error)?.message);
    }
  }

  // Bitácora (background)
  void db
    .collection('audit_logs')
    .add({
      action: isLate ? 'LLEGADA_TARDE' : 'PRESENTE',
      module: source === 'VIGI' ? 'ASISTENTE_IA' : source === 'OPERATIONS' ? 'OPERACIONES' : 'PORTAL',
      actorName: actorName || source,
      actorUid: operatorUid || null,
      timestamp: FieldValue.serverTimestamp(),
      employeeId: empId,
      employeeName: shiftData.employeeName || '',
      objectiveId: shiftData.objectiveId || '',
      objectiveName: shiftData.objectiveName || '',
      shiftId,
      empresaId: shiftData.empresaId || null,
      details: relieved
        ? `${shiftData.employeeName || empId} ingresó${isLate ? ' tarde' : ''} (${source}). Relevó a ${relieved.employeeName}.`
        : `${shiftData.employeeName || empId} ingresó${isLate ? ' tarde' : ''} (${source}).`,
    })
    .catch(() => {});

  // AA → LT en background
  if (shiftData.absenceType === 'AA') {
    void (async () => {
      try {
        const absSnap = await db
          .collection('ausencias')
          .where('shiftId', '==', shiftId)
          .limit(5)
          .get();
        const aaDoc = absSnap.docs.find((d) => d.data().absenceType === 'AA');
        if (!aaDoc) return;
        await aaDoc.ref.update({
          type: 'Llegada Tarde',
          absenceType: 'LT',
          status: 'Confirmada',
          reason: `Llegada tarde — ${shiftData.objectiveName || ''} (${shiftData.positionName || ''})`,
          arrivedAt: FieldValue.serverTimestamp(),
        });
      } catch {
        /* ignore */
      }
    })();
  }

  return { success: true, relieved };
}
