import * as admin from 'firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { guardFirstName } from '../common/pushGreeting';
import { isReversibleLateAbsence } from '../attendance/lateAbsenceWindow';
import { revertirAusenciaShift } from '../attendance/revertirAusencia';
import { evaluateServerCheckInWindow } from './checkInWindow';
import { resolveCheckInPayClock } from './checkInPay';
import { isOpsCoverageHoursOnSourceDoc } from '../coverage/coverageTraceShift';
import { cancelLlegadaTardeConvocatorias } from '../attendance/cancelLlegadaTardeConvocatorias';
import { notifyTurnoFinalizadoRelevo } from './relevoNotifications';
import { findPresentOutgoingAlignedToGapStart } from './relevoOutgoingMatch';
import { isReliefEligibleShift } from '../common/reliefEligibility';
import { seriesCodeOf, seriesHandoffKind } from '../common/shiftSeries';
import { buildAutoClosePatch } from '../scheduling/shiftClose';

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
   * Si undefined: releva solo al saliente cuyo fin cae ±30 min del inicio.
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
    /** true si el cierre quedó programado a la hora de relevo, no ejecutado ya. */
    scheduled?: boolean;
  } | null;
};

function normPos(n: unknown): string {
  return String(n ?? '')
    .trim()
    .toLowerCase();
}

function formatHmAr(ms: number): string {
  return new Date(ms).toLocaleTimeString('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: 'America/Argentina/Buenos_Aires',
  });
}

/**
 * Motor único de presencia. El relevo automático es solo el saliente que termina
 * cuando empieza el entrante (mismo puesto, fin ±30 min).
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
    if (!isReversibleLateAbsence(shiftData as Record<string, unknown>, Date.now())) {
      throw new Error('SHIFT_ABSENT');
    }
    const rev = await revertirAusenciaShift(db, {
      shiftId,
      operatorUid: operatorUid || 'FICHADA',
    });
    if (!rev.success) throw new Error('SHIFT_ABSENT');
    return { success: true, alreadyPresent: false, relieved: null };
  }
  const covTypeGate = String(shiftData.coverageType || '').toUpperCase();
  const originGate = String(shiftData.origin || '').toUpperCase();
  if (originGate === 'OPERATIONS_COVERAGE' && covTypeGate === 'EXTEND') {
    throw new Error('EXT_NO_CHECKIN');
  }
  if (isOpsCoverageHoursOnSourceDoc(shiftData as Record<string, unknown>) && covTypeGate !== 'ADVANCE') {
    throw new Error('TRACE_REGISTRATION_SHIFT');
  }

  if (shiftData.isPresent === true || shiftData.status === 'PRESENT') {
    return { success: true, alreadyPresent: true, relieved: null };
  }

  const empId = String(input.empId || shiftData.employeeId || '').trim();
  const nowTs = Timestamp.now();
  const recordedMs = recordedAt ? new Date(recordedAt).getTime() : nowTs.toMillis();
  const nowMs = recordedMs;
  const now = FieldValue.serverTimestamp();

  const windowEval = evaluateServerCheckInWindow(shiftData as Record<string, unknown>, nowMs, {
    source,
  });
  if (!windowEval.allowed) {
    throw new Error(windowEval.rejectCode || 'CHECKIN_WINDOW');
  }

  const scheduledStartTs = shiftData.startTime ?? null;
  const scheduledStartMs = scheduledStartTs?.toMillis?.() ?? 0;
  const originUp = String(shiftData.origin || '').toUpperCase();
  const covTypeUp = String(shiftData.coverageType || '').toUpperCase();
  const convocadoPunch = originUp === 'OPERATIONS_COVERAGE' && covTypeUp !== 'EXTEND';
  const adjustedStartMs = shiftData.adjustedStartTime?.toMillis?.() ?? 0;
  const payAnchorMs = windowEval.useAdjustedStart && adjustedStartMs > 0
    ? adjustedStartMs
    : scheduledStartMs;
  const pay = resolveCheckInPayClock({
    nowMs,
    plannedStartMs: payAnchorMs,
    windowLateMinutes: windowEval.lateMinutes ?? 0,
  });
  let isLate = convocadoPunch ? false : pay.isLate;
  let lateMinutes = convocadoPunch ? 0 : pay.lateMinutes;
  let realStartTime: FirebaseFirestore.Timestamp | FirebaseFirestore.FieldValue;
  if (convocadoPunch) {
    realStartTime = Timestamp.fromMillis(nowMs);
  } else if (!pay.isLate && windowEval.useAdjustedStart && shiftData.adjustedStartTime) {
    realStartTime = shiftData.adjustedStartTime;
  } else if (!pay.isLate && scheduledStartTs) {
    realStartTime = scheduledStartTs;
  } else {
    realStartTime = Timestamp.fromMillis(pay.realStartMs);
  }

  const incomingPatch: Record<string, unknown> = {
    isPresent: true,
    status: 'PRESENT',
    checkInTime: now,
    checkInAt: Timestamp.fromMillis(pay.checkInAtMs),
    realStartTime,
    checkInMethod: source,
    checkInCoords: coords || null,
    checkInRecordedAt: recordedAt || null,
    isLate,
    lateMinutes,
    isAbsent: false,
    absenceType: null,
    absenceDetectedAt: null,
    // La fichada tarde no es un aviso: `lateArrivalAt` solo lo escribe notificarLlegadaTarde
    // o la convocatoria LLEGADA_TARDE. Si lo estampamos acá, el CC lee TARDE AVISADA sin aviso.
    lateArrivalAt: shiftData.lateArrivalAt ?? null,
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

  if (convocadoPunch) {
    const convId = String(shiftData.coverageConvocatoriaId || shiftData.assignedByConvocatoria || '').trim();
    if (convId) {
      const { logConvocatoriaEvento } = await import('../coverage/convocatoriaEventos');
      const { convocadoFollowUpClosePatch } = await import('../attendance/convocadoFollowUp');
      const punchTs = Timestamp.fromMillis(nowMs);
      await db.collection('convocatorias_cobertura').doc(convId)
        .update({ ...convocadoFollowUpClosePatch('FICHO', punchTs), checkedInAt: punchTs })
        .catch(() => undefined);
      await logConvocatoriaEvento(db, convId, { type: 'FICHO', at: punchTs }).catch(() => undefined);
    }
    if (covTypeUp === 'ADVANCE') {
      const titularId = String(shiftData.absenceShiftId || shiftData.coveredShiftId || '').trim();
      if (titularId) {
        const extConvs = await db.collection('convocatorias_cobertura')
          .where('shiftId', '==', titularId)
          .limit(8)
          .get();
        for (const c of extConvs.docs) {
          if (String(c.data().type || '') !== 'EXTEND') continue;
          const extId = String(c.data().extendShiftId || '').trim();
          if (!extId) continue;
          const ext = await db.collection('turnos').doc(extId).get();
          const ed = ext.data();
          if (!ed || ed.isCompleted === true || ed.isExtended !== true) continue;
          await ext.ref.update({
            isExtended: false,
            isCompleted: true,
            isPresent: false,
            isRetention: false,
            status: 'COMPLETED',
            completionReason: 'RELEVO_ADVANCE',
            realEndTime: Timestamp.fromMillis(nowMs),
          });
        }
      }
    }
  }
  await cancelLlegadaTardeConvocatorias(db, shiftId, 'CHECKED_IN').catch((e) =>
    console.warn('[registrarPresencia] cancelar ¿Venís?:', (e as Error).message),
  );

  // Notificación de confirmación al guardia (no bloqueante)
  void (async () => {
    try {
      const isPortal = source === 'PORTAL_GPS';
      const inName = guardFirstName({ employeeName: shiftData.employeeName });
      const whereIn = shiftData.objectiveName || 'el puesto';
      const title = isPortal ? 'Ingreso registrado' : 'Operaciones registró tu ingreso';
      const body = isPortal
        ? (inName ? `Listo, ${inName}. Quedó tu ingreso en ${whereIn}.` : `Quedó tu ingreso en ${whereIn}.`)
        : (inName
          ? `${inName}, ${actorName || 'Operaciones'} registró tu ingreso en ${whereIn}.`
          : `${actorName || 'Operaciones'} registró tu ingreso en ${whereIn}.`);
      const notifType = 'CHECKIN_CONFIRMADO';

      const notifRef = await db.collection('user_notifications').add({
        type: notifType,
        title,
        body,
        employeeId: empId || null,
        userId: empId || null,
        shiftId,
        objectiveId: shiftData.objectiveId || null,
        objectiveName: shiftData.objectiveName || null,
        empresaId: shiftData.empresaId || null,
        read: false,
        readAt: null,
        createdAt: FieldValue.serverTimestamp(),
      });

      // FCM push (solo si la app no está abierta)
      const [byEmp, byUid] = await Promise.all([
        empId ? db.collection('device_tokens').where('employeeId', '==', empId).get() : Promise.resolve({ docs: [] as FirebaseFirestore.QueryDocumentSnapshot[] }),
        (async () => {
          if (!empId) return { docs: [] as FirebaseFirestore.QueryDocumentSnapshot[] };
          const empDoc = await db.collection('empleados').doc(empId).get();
          const uid = empDoc.data()?.uid;
          if (!uid) return { docs: [] as FirebaseFirestore.QueryDocumentSnapshot[] };
          return db.collection('device_tokens').where('uid', '==', uid).get();
        })(),
      ]);
      const tokenSet = new Set<string>();
      [...byEmp.docs, ...byUid.docs].forEach((d) => {
        const t = d.data()?.token;
        if (typeof t === 'string' && t.length > 10) tokenSet.add(t);
      });
      const tokens = Array.from(tokenSet);
      if (tokens.length > 0) {
        const link = `/app/?notif=${encodeURIComponent(notifRef.id)}`;
        await admin.messaging().sendEachForMulticast({
          data: { type: notifType, title, body, shiftId, notificationId: notifRef.id, link },
          webpush: { headers: { Urgency: 'normal' }, fcmOptions: { link } },
          tokens,
        });
      }
    } catch (e) {
      console.warn('[registrarPresencia] notifyPresenceConfirmed:', (e as Error)?.message);
    }
  })();

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
  let relievedScheduleMs = 0;

  const wantSkip =
    skipAutoRelevo === true ||
    overrideRelieveShiftId === null ||
    // ESC/REF/RET es sobreturno: al fichar no releva a nadie del puesto.
    !isReliefEligibleShift(shiftData as Record<string, unknown>);
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
        // El operador eligió a alguien que no es de la serie (M2 frente a un T): se ignora
        // y el relevo vuelve a la serie (P5g). El compañero del mismo horario no se cierra.
        let overrideRejectedBySeries = false;

        if (wantOverride) {
          const ov = await db.collection('turnos').doc(overrideRelieveShiftId!.trim()).get();
          if (ov.exists) {
            const od = ov.data()!;
            if (
              od.isPresent &&
              !od.isCompleted &&
              isReliefEligibleShift(od as Record<string, unknown>) &&
              String(od.objectiveId || '') === objectiveId &&
              normPos(od.positionName) === normPos(positionName) &&
              ov.id !== shiftId
            ) {
              const kind = seriesHandoffKind(
                seriesCodeOf(od as Record<string, unknown>),
                seriesCodeOf(shiftData as Record<string, unknown>),
              );
              if (kind === 'REJECT') {
                overrideRejectedBySeries = true;
                console.warn(
                  `[registrarPresencia] override ${ov.id} (${String(od.code || '')}) no es de la serie de ${String(shiftData.code || '')}: se usa el relevo de la serie`,
                );
              } else {
                outDoc = ov;
              }
            }
          }
        }
        if (!outDoc && (!wantOverride || overrideRejectedBySeries) && incomingStartMs > 0) {
          const pick = await findPresentOutgoingAlignedToGapStart(db, {
            objectiveId,
            positionName,
            gapStartMs: incomingStartMs,
            excludeShiftIds: [shiftId],
            excludeEmployeeId: empId || undefined,
            incoming: shiftData as Record<string, unknown>,
          });
          if (pick) {
            const pickSnap = await db.collection('turnos').doc(pick.id).get();
            if (pickSnap.exists) outDoc = pickSnap;
          }
        }

        if (outDoc) {
          const outData = outDoc.data()!;
          const outEmpId = String(outData.employeeId || '');
          const outName = outData.employeeName || 'Guardia';
          const outPosName = outData.positionName || '';
          const outEndMs = outData.endTime?.toMillis?.() ?? 0;
          const handoffMs = Math.max(incomingStartMs, outEndMs || incomingStartMs);
          // Fichada anticipada (también la del operador): el saliente cierra a su hora, no a la fichada.
          const scheduleHandoff = nowMs < handoffMs;
          const manualRelief = wantOverride && !overrideRejectedBySeries;

          await shiftRef.update({ relievedOutgoingShiftId: outDoc.id }).catch(() => undefined);
          if (scheduleHandoff) {
            relievedScheduleMs = handoffMs;
            await outDoc.ref.update({
              relievedBy: empId || null,
              relievedByName: incomingName,
              relievedAt: FieldValue.serverTimestamp(),
              relieveScheduledAt: Timestamp.fromMillis(handoffMs),
              autoRelevo: true,
              relievedEarly: true,
              relievedSource: source,
            });
          } else {
            const realEndMs = Math.max(handoffMs, nowMs);
            const outClose = buildAutoClosePatch(outData as Record<string, unknown>, {
              realEndMs,
              reason: 'RELEVO_PRESENTE',
              now: Timestamp.fromMillis(nowMs),
              by: 'RELEVO',
            });
            await outDoc.ref.update({
              ...outClose,
              ...(outData.isRetention === true ? { isRetention: false } : {}),
              relievedBy: empId || null,
              relievedByName: incomingName,
              relievedAt: FieldValue.serverTimestamp(),
              relieveScheduledAt: Timestamp.fromMillis(handoffMs),
              autoRelevo: !manualRelief,
              relievedEarly: false,
              relievedSource: source,
            });

            if (outEmpId) {
              void notifyTurnoFinalizadoRelevo(db, {
                outEmpId,
                outDocId: outDoc.id,
                incomingName,
                objectiveName,
                empresaId,
              });
            }
          }

          relieved = {
            shiftId: outDoc.id,
            employeeId: outEmpId,
            employeeName: outName,
            scheduled: scheduleHandoff,
          };

          const when = formatHmAr(handoffMs);
          void db
            .collection('novedades')
            .add({
              type: scheduleHandoff ? 'RELEVO_PROGRAMADO' : 'RELEVO_AUTOMATICO',
              status: 'ATENDIDA',
              empresaId,
              objectiveId,
              objectiveName,
              positionName: outPosName,
              employeeId: empId,
              employeeName: incomingName,
              relievedEmployeeId: outEmpId,
              relievedEmployeeName: outName,
              description: scheduleHandoff
                ? `Relevo de ${outName} programado a las ${when} (${source})`
                : `${incomingName} relevó a ${outName} en ${objectiveName}${outPosName ? ` — ${outPosName}` : ''} (${source})`,
              createdAt: FieldValue.serverTimestamp(),
              autoProcessed: !manualRelief,
              source: manualRelief ? source : 'AUTO_RELEVO',
              ...(overrideRejectedBySeries ? { overrideRejectedBySeries: true } : {}),
            })
            .catch(() => {});
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
        ? relievedScheduleMs > 0
          ? `${shiftData.employeeName || empId} ingresó (${source}). Relevo de ${relieved.employeeName} programado a las ${formatHmAr(relievedScheduleMs)}.`
          : `${shiftData.employeeName || empId} ingresó${isLate ? ' tarde' : ''} (${source}). Relevó a ${relieved.employeeName}.`
        : `${shiftData.employeeName || empId} ingresó${isLate ? ' tarde' : ''} (${source}).`,
    })
    .catch(() => {});

  // Llegada tarde (sin AA previa) → crear registro LT en ausencias para RRHH
  if (isLate && !shiftData.absenceType) {
    void (async () => {
      try {
        const startMs2 = scheduledStartTs?.toMillis?.() ?? 0;
        const arDate = new Date(startMs2 - 3 * 60 * 60 * 1000); // UTC-3
        const dateStr = `${arDate.getUTCFullYear()}-${String(arDate.getUTCMonth()+1).padStart(2,'0')}-${String(arDate.getUTCDate()).padStart(2,'0')}`;
        const existing = await db.collection('ausencias').where('shiftId', '==', shiftId).limit(1).get();
        if (existing.empty) {
          await db.collection('ausencias').add({
            employeeId: empId || null,
            employeeName: shiftData.employeeName || '',
            startDate: dateStr,
            endDate: dateStr,
            type: 'Llegada Tarde',
            absenceType: 'LT',
            origin: 'LATE_ARRIVAL',
            shiftId,
            objectiveId: shiftData.objectiveId || null,
            objectiveName: shiftData.objectiveName || null,
            positionName: shiftData.positionName || null,
            reason: `Llegada tarde — ${shiftData.objectiveName || ''} (${shiftData.positionName || ''})`,
            arrivedAt: FieldValue.serverTimestamp(),
            status: 'Confirmada',
            createdAt: FieldValue.serverTimestamp(),
            empresaId: shiftData.empresaId || null,
            reportedBy: source,
          });
        }
      } catch {
        /* ignore */
      }
    })();
  }

  if (windowEval.lateNoNotice === true) {
    const mins = windowEval.lateMinutes ?? 0;
    try {
      const existingNov = await db.collection('novedades').where('shiftId', '==', shiftId).limit(25).get();
      const already = existingNov.docs.some((d) => d.data()?.type === 'LLEGADA_TARDE');
      if (!already) {
        await db.collection('novedades').add({
          type: 'LLEGADA_TARDE',
          title: 'Llegada Tarde',
          shiftId,
          employeeId: empId,
          employeeName: shiftData.employeeName || '',
          objectiveId: shiftData.objectiveId || '',
          objectiveName: shiftData.objectiveName || '',
          clientName: shiftData.clientName || '',
          positionName: shiftData.positionName || null,
          empresaId: shiftData.empresaId || null,
          lateMinutes: mins,
          description: `${shiftData.employeeName || 'El guardia'} llegó ${mins} min tarde — ${shiftData.objectiveName || ''}`.trim(),
          createdAt: now,
          status: 'unread',
          viewed: false,
          source,
        });
      }
    } catch (e) {
      console.warn('[registrarPresencia] novedad LLEGADA_TARDE:', (e as Error)?.message);
    }
  }

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
