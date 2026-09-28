import * as admin from 'firebase-admin';
import { simularRespuestasConvocatorias } from '../coverage/convocatoriasCobertura';
import { ObjectiveOperationCache, simulableShiftSkipReasonResolved } from '../common/simulableShift';

/**
 * Generador Demo: presente / tarde / ausente + respuestas a convocatorias.
 * Solo objetivos en operación ese día (contrato abierto, cliente activo, cronograma publicado).
 */
export async function runModoDemoForEmpresa(
  db: admin.firestore.Firestore,
  empresaId: string,
): Promise<{
  presencias: number;
  ausenciasDemo: number;
  convRespuestas: number;
}> {
  const now = new Date();
  const nowTs = admin.firestore.Timestamp.fromDate(now);
  const windowStart = admin.firestore.Timestamp.fromDate(new Date(now.getTime() - 26 * 3600000));
  const windowEnd = admin.firestore.Timestamp.fromDate(new Date(now.getTime() + 2 * 3600000));

  const snap = await db.collection('turnos')
    .where('empresaId', '==', empresaId)
    .where('startTime', '>=', windowStart)
    .where('startTime', '<=', windowEnd)
    .limit(600)
    .get();

  const opCache = new ObjectiveOperationCache();
  const batch = db.batch();
  let presencias = 0;
  let ausenciasDemo = 0;
  let batchOps = 0;
  let skippedOutOfCc = 0;

  const isVacant = (t: Record<string, unknown>) =>
    !t.employeeId ||
    t.employeeId === 'VACANTE' ||
    t.employeeId === 'SIN_COBERTURA' ||
    !!t.isUnassigned ||
    !!t.isSinCobertura;

  const skipDemo = async (t: Record<string, unknown>) => {
    const reason = await simulableShiftSkipReasonResolved(db, t, opCache);
    if (reason === 'FUERA_OPERACION') skippedOutOfCc++;
    return reason;
  };

  const WINDOW_BEFORE_MS = 15 * 60 * 1000;
  const WINDOW_AFTER_MS = 5 * 60 * 1000;
  const LATE_DELAY_MS = 12 * 60 * 1000;
  type ShiftCat = 'puntual' | 'late' | 'absent';
  const argentinaDayKeyFromMs = (ms: number): string => {
    const ar = new Date(ms - 3 * 60 * 60 * 1000);
    return `${ar.getUTCFullYear()}-${String(ar.getUTCMonth() + 1).padStart(2, '0')}-${String(ar.getUTCDate()).padStart(2, '0')}`;
  };
  const shiftCategory = (empId: string, shiftId: string, startMs: number): ShiftCat => {
    const dayStr = argentinaDayKeyFromMs(startMs);
    const block = Math.floor(startMs / (6 * 3600000));
    const seed = `${empresaId}|${dayStr}|b${block}|${shiftId}|${empId}`;
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) & 0xffffff;
    const m = h % 10;
    if (m === 0) return 'absent';
    if (m <= 3) return 'late';
    return 'puntual';
  };

  for (const doc of snap.docs) {
    const t = doc.data() as Record<string, unknown>;
    if (isVacant(t) || (await skipDemo(t))) continue;
    if (t.isAbsent || t.isPresent || t.isCompleted) continue;
    const startMs = ((t.startTime as { seconds?: number })?.seconds ?? 0) * 1000;
    const empId = String(t.employeeId || '');
    const cat = shiftCategory(empId, doc.id, startMs);
    const oid = String(t.objectiveId || '');
    if (cat === 'absent') continue;

    if (cat === 'late') {
      if (startMs > now.getTime() + 10 * 60 * 1000) continue;
      if (startMs < now.getTime() - 15 * 60 * 1000) continue;
      const lateTs = admin.firestore.Timestamp.fromMillis(startMs + LATE_DELAY_MS);
      batch.update(doc.ref, {
        isPresent: true,
        status: 'PRESENT',
        presentAt: lateTs,
        realStartTime: lateTs,
        autoPresencia: true,
        llegadaTarde: true,
        modoDemoAt: nowTs,
      });
      const safeId = doc.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
      batch.set(db.collection('novedades').doc(`demo_late_${safeId}`), {
        type: 'LLEGADA_TARDE',
        status: 'pending',
        title: 'Llegada Tarde',
        description: `${t.employeeName || 'Guardia'} llegó ${LATE_DELAY_MS / 60000} min tarde — ${t.objectiveName || ''}`,
        shiftId: doc.id,
        clientId: t.clientId || null,
        objectiveId: oid || null,
        objectiveName: t.objectiveName || null,
        employeeId: empId || null,
        employeeName: t.employeeName || null,
        positionName: t.positionName || null,
        empresaId,
        createdAt: nowTs,
        reportedBy: 'SISTEMA_AUTO',
        source: 'MODO_DEMO',
        modoDemoAt: nowTs,
      }, { merge: true });
      batchOps += 2;
    } else {
      const isEarlyShift = t.isEarlyStart === true && !!t.adjustedStartTime;
      const actualStartTs = isEarlyShift ? t.adjustedStartTime : t.startTime;
      const actualStart = actualStartTs as { seconds?: number } | undefined;
      const actualStartMs = (actualStart?.seconds ?? 0) * 1000;
      const shiftEndMs = ((t.endTime as { seconds?: number })?.seconds ?? 0) * 1000;
      if (isEarlyShift) {
        if (actualStartMs > now.getTime() + WINDOW_BEFORE_MS) continue;
        if (shiftEndMs && shiftEndMs < now.getTime()) continue;
      } else {
        if (actualStartMs > now.getTime() + WINDOW_BEFORE_MS) continue;
        if (actualStartMs < now.getTime() - WINDOW_AFTER_MS) continue;
      }
      batch.update(doc.ref, {
        isPresent: true,
        status: 'PRESENT',
        presentAt: actualStartTs,
        realStartTime: actualStartTs,
        autoPresencia: true,
        modoDemoAt: nowTs,
      });
      batchOps += 1;
    }
    presencias++;
  }

  const covCreatedStart = admin.firestore.Timestamp.fromMillis(now.getTime() - 4 * 3600000);
  const covSnap = await db
    .collection('turnos')
    .where('empresaId', '==', empresaId)
    .where('origin', '==', 'OPERATIONS_COVERAGE')
    .where('createdAt', '>=', covCreatedStart)
    .limit(400)
    .get();
  for (const doc of covSnap.docs) {
    const t = doc.data() as Record<string, unknown>;
    if (await skipDemo(t)) continue;
    if (t.isPresent === true || t.isAbsent === true || t.isCompleted === true) continue;
    if (t.coverageSuperseded === true) continue;
    const createdMs = (t.createdAt as { seconds?: number })?.seconds
      ? (t.createdAt as { seconds: number }).seconds * 1000
      : 0;
    if (!createdMs) continue;
    const ageMin = (now.getTime() - createdMs) / 60000;
    if (ageMin < 5 || ageMin > 40) continue;
    const hashVal = doc.id.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0) % 10;
    if (hashVal === 0) continue;
    const presentAt = admin.firestore.Timestamp.fromMillis(createdMs + 8 * 60 * 1000);
    batch.update(doc.ref, {
      isPresent: true,
      status: 'PRESENT',
      presentAt,
      realStartTime: presentAt,
      checkInTime: presentAt,
      autoPresencia: true,
      modoDemoAt: nowTs,
    });
    batchOps += 1;
    presencias += 1;
  }

  const ABSENT_MIN_MS = 5 * 60 * 1000;
  for (const doc of snap.docs) {
    const t = doc.data() as Record<string, unknown>;
    if (isVacant(t) || (await skipDemo(t))) continue;
    if (t.isAbsent || t.isPresent || t.isCompleted) continue;
    const startMs = ((t.startTime as { seconds?: number })?.seconds ?? 0) * 1000;
    if (startMs > now.getTime() - ABSENT_MIN_MS) continue;
    const empId = String(t.employeeId || '');
    if (shiftCategory(empId, doc.id, startMs) !== 'absent') continue;

    batch.update(doc.ref, {
      isAbsent: true,
      status: 'ABSENT',
      absenceType: 'AA',
      absenceDetectedAt: nowTs,
      absenceDetectedBy: 'MODO_DEMO',
      modoDemoAt: nowTs,
    });

    const startMs2 = ((t.startTime as { seconds?: number })?.seconds ?? 0) * 1000;
    const arDate2 = new Date(startMs2 - 3 * 60 * 60 * 1000);
    const dateStr2 = `${arDate2.getUTCFullYear()}-${String(arDate2.getUTCMonth() + 1).padStart(2, '0')}-${String(arDate2.getUTCDate()).padStart(2, '0')}`;
    const st2 = (t.startTime as { toDate?: () => Date })?.toDate ? (t.startTime as { toDate: () => Date }).toDate() : new Date(startMs2);
    const endSec = (t.endTime as { seconds?: number })?.seconds;
    const et2 = endSec ? new Date(endSec * 1000) : null;
    const fmtT2 = (d: Date) => d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Cordoba' });
    const horario2 = et2 ? `${fmtT2(st2)} - ${fmtT2(et2)}` : fmtT2(st2);
    const safeId = doc.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);

    batch.set(db.collection('ausencias').doc(`demo_ausencia_${safeId}`), {
      employeeId: empId,
      employeeName: t.employeeName || '',
      startDate: dateStr2,
      endDate: dateStr2,
      type: 'No Presentacion',
      absenceType: 'AA',
      origin: 'AUTO_DEMO',
      shiftId: doc.id,
      objectiveId: t.objectiveId || null,
      objectiveName: t.objectiveName || '',
      clientId: t.clientId || null,
      empresaId,
      positionName: t.positionName || '',
      shiftCode: String(t.code || '').toUpperCase() || null,
      reason: `No presentacion al turno ${horario2} - ${t.objectiveName || ''} (${t.positionName || ''})`,
      status: 'Confirmada',
      hasCertificate: false,
      createdAt: nowTs,
      source: 'MODO_DEMO',
      modoDemoAt: nowTs,
    }, { merge: true });

    const shiftCodeDemo = String(t.code || '').trim().toUpperCase();
    batch.set(db.collection('novedades').doc(`demo_aus_${safeId}`), {
      type: 'AUSENCIA_AUTO',
      status: 'pending',
      title: 'Ausencia Automática (Demo)',
      description: `${t.employeeName || 'Empleado'} no se presentó — ${shiftCodeDemo || '—'} ${horario2} · ${t.positionName || 'Puesto'} · ${t.objectiveName || ''} (MODO DEMO)`,
      shiftId: doc.id,
      clientId: t.clientId || null,
      objectiveId: t.objectiveId || null,
      objectiveName: t.objectiveName || null,
      employeeId: empId || null,
      employeeName: t.employeeName || null,
      positionName: t.positionName || null,
      shiftCode: shiftCodeDemo || null,
      empresaId,
      createdAt: nowTs,
      reportedBy: 'MODO_DEMO',
      source: 'MODO_DEMO',
      modoDemoAt: nowTs,
    }, { merge: true });

    batchOps += 3;
    ausenciasDemo++;
  }

  if (batchOps > 0) {
    await batch.commit();
  }

  let convRespuestas = 0;
  try {
    convRespuestas = await simularRespuestasConvocatorias(db, empresaId, opCache);
  } catch (e8) {
    console.warn('[modoDemoCron] simularRespuestas error:', (e8 as Error)?.message);
  }

  if (skippedOutOfCc > 0) {
    console.log(`[modoDemoCron] ${empresaId}: omitidos ${skippedOutOfCc} turnos (objetivo fuera de operación)`);
  }
  return { presencias, ausenciasDemo, convRespuestas };
}
