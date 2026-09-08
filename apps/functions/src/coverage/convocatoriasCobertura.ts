import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import {
  checkEligibility,
  CandidateType,
  CASCADE_ORDER,
  nextCascadeStep,
  getUrgency,
  findEmployeeUid,
} from './eligibilityFilter';

// ─── Tipos ───────────────────────────────────────────────────────────────────

// ConvocatoriaType amplía CandidateType con LLEGADA_TARDE (pregunta al guardia tardío)
export type ConvocatoriaType = CandidateType | 'LLEGADA_TARDE';

export interface ConvocatoriaCoberturaDoc {
  empresaId: string;
  shiftId: string;           // vacante que se quiere cubrir
  objectiveId: string;
  objectiveName?: string;
  clientId?: string;
  clientName?: string;
  shiftCode?: string;        // M/T/N/D12/N12
  startTime: Timestamp;
  endTime?: Timestamp;
  aptitudesRequeridas?: string[];

  type: ConvocatoriaType;
  urgency: 'URGENTE' | 'INTERMEDIO' | 'NORMAL';
  cascadeStep: number;       // índice en CASCADE_ORDER (0-based)

  candidateEmployeeId: string;
  candidateEmployeeName: string;
  candidateUid?: string;

  // Para EXTEND: el turno a extender (ya presente en obj)
  extendShiftId?: string;
  // Para ADVANCE: el próximo turno a adelantar
  advanceShiftId?: string;
  // Para FT: el turno franco del candidato que se convierte a FT
  ftShiftId?: string;

  // PENDING: esperando respuesta dentro del timeout
  // ESCALATED: timeout vencido, avanzamos al siguiente paso pero AÚN acepta respuesta
  // ACCEPTED / REJECTED / CANCELLED: estado final
  status: 'PENDING' | 'ESCALATED' | 'ACCEPTED' | 'REJECTED' | 'TIMEOUT' | 'CANCELLED';
  timeoutAt: Timestamp;

  createdAt: Timestamp;
  createdBy: string;
  createdByName?: string;
  respondedAt?: Timestamp;
  rejectionReason?: string;
  resolvedAt?: Timestamp;
}

// 3 min: tiempo de espera por paso antes de avanzar al siguiente.
// El paso anterior queda ESCALATED (sigue aceptando). El primero que confirma gana.
const TIMEOUT_MINUTES = 3;

// ─── Helper: crear notificación interna (dispara FCM via trigger) ─────────────

async function crearNotifConvocatoria(
  db: admin.firestore.Firestore,
  conv: ConvocatoriaCoberturaDoc & { id: string },
) {
  const urgencyLabel =
    conv.urgency === 'URGENTE' ? '⚡ URGENTE' : conv.urgency === 'INTERMEDIO' ? 'Intermedia' : 'Normal';

  const typeLabel: Record<ConvocatoriaType, string> = {
    RET: 'Retención (RET)',
    VOLANTE: 'Cobertura volante',
    SIN_TURNO_CON_EXP: 'Cobertura disponible',
    EXTEND: 'Extensión de jornada',
    ADVANCE: 'Adelanto de turno',
    SIN_TURNO: 'Cobertura disponible',
    FT: 'Franco Trabajado (FT)',
    LLEGADA_TARDE: '¿Estás en camino?',
  };

  const startDate =
    conv.startTime instanceof Timestamp
      ? conv.startTime.toDate().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' })
      : '--:--';

  const isLlegadaTarde = conv.type === 'LLEGADA_TARDE';
  const title = isLlegadaTarde ? '⏰ ¿Estás en camino?' : `[${urgencyLabel}] Cobertura requerida`;
  const body  = isLlegadaTarde
    ? `Tu turno ${conv.shiftCode || ''} en ${conv.objectiveName || 'el puesto'} comenzó a las ${startDate}. Confirmá si estás en camino en los próximos ${TIMEOUT_MINUTES} min.`
    : `${typeLabel[conv.type]} en ${conv.objectiveName || 'el puesto'} — turno ${conv.shiftCode || ''} ${startDate}. Respondé en los próximos ${TIMEOUT_MINUTES} min.`;

  await db.collection('user_notifications').add({
    uid: conv.candidateUid || null,
    employeeId: conv.candidateEmployeeId,
    type: 'CONVOCATORIA_COBERTURA',
    title,
    body,
    empresaId: conv.empresaId,
    convocatoriaId: conv.id,
    shiftId: conv.shiftId,
    objectiveId: conv.objectiveId,
    read: false,
    readAt: null,
    createdAt: FieldValue.serverTimestamp(),
  });
}

// ─── Helper: avanzar cascada ──────────────────────────────────────────────────

async function avanzarCascada(
  db: admin.firestore.Firestore,
  conv: ConvocatoriaCoberturaDoc & { id: string },
  reason: 'REJECTED' | 'TIMEOUT',
): Promise<void> {
  // LLEGADA_TARDE no participa en la cascada de cobertura
  if (conv.type === 'LLEGADA_TARDE') return;
  const nextType = nextCascadeStep(conv.type as CandidateType);
  if (!nextType) {
    // Cascada agotada: notificar a ops
    await db.collection('novedades').add({
      type: 'VACANTE_SIN_COBERTURA',
      shiftId: conv.shiftId,
      objectiveId: conv.objectiveId,
      objectiveName: conv.objectiveName || '',
      empresaId: conv.empresaId,
      message: `Cascada de cobertura agotada para turno ${conv.shiftCode || ''} en ${conv.objectiveName || 'objetivo'}. Sin candidatos disponibles.`,
      resolved: false,
      createdAt: FieldValue.serverTimestamp(),
    });
    return;
  }

  // FT: broadcast — buscar múltiples candidatos de franco en objetivo
  if (nextType === 'FT') {
    await dispararBroadcastFT(db, conv);
    return;
  }

  // Para otros pasos: buscar el mejor candidato disponible
  const candidate = await findBestCandidate(db, conv, nextType);
  if (!candidate) {
    // No hay candidato en este paso: saltar al siguiente
    const fakeConv = { ...conv, type: nextType };
    await avanzarCascada(db, fakeConv as any, reason);
    return;
  }

  // Obtener teléfono del candidato anterior para WhatsApp directo desde la novedad
  let candidatePhone: string | null = null;
  if (conv.candidateEmployeeId) {
    const empSnap = await db.collection('empleados').doc(conv.candidateEmployeeId).get();
    if (empSnap.exists) candidatePhone = empSnap.data()?.telefono || null;
  }

  // Novedad para ops: el candidato anterior no respondió / rechazó
  await db.collection('novedades').add({
    type: 'CONVOCATORIA_ESCALADA',
    shiftId: conv.shiftId,
    objectiveId: conv.objectiveId,
    objectiveName: conv.objectiveName || '',
    clientId: conv.clientId || null,
    empresaId: conv.empresaId,
    title: reason === 'REJECTED' ? 'Convocatoria rechazada' : 'Sin respuesta — escalando',
    message: `${conv.candidateEmployeeName} ${reason === 'REJECTED' ? 'rechazó' : 'no respondió'} — escalando a ${nextType} en ${conv.objectiveName || 'objetivo'}`,
    coverageType: conv.type,
    nextCoverageType: nextType,
    candidateEmployeeId: conv.candidateEmployeeId,
    candidateEmployeeName: conv.candidateEmployeeName,
    candidatePhone,
    status: 'unread',
    resolved: false,
    createdAt: FieldValue.serverTimestamp(),
  });

  await crearConvocatoriaDoc(db, {
    ...conv,
    type: nextType,
    cascadeStep: CASCADE_ORDER.indexOf(nextType),
    candidateEmployeeId: candidate.id,
    candidateEmployeeName: candidate.name,
    candidateUid: candidate.uid,
    extendShiftId: candidate.extendShiftId,
    advanceShiftId: candidate.advanceShiftId,
    createdBy: 'AUTO',
  });
}

// ─── Helper: crear doc convocatoria + notificación ───────────────────────────

async function crearConvocatoriaDoc(
  db: admin.firestore.Firestore,
  data: Omit<ConvocatoriaCoberturaDoc, 'createdAt' | 'status' | 'timeoutAt' | 'urgency'> & {
    createdBy: string;
    createdByName?: string;
  },
): Promise<string> {
  const now = Timestamp.now();
  const timeoutAt = Timestamp.fromMillis(now.toMillis() + TIMEOUT_MINUTES * 60 * 1000);

  const urgency = getUrgency(data.startTime);

  const docData: ConvocatoriaCoberturaDoc = {
    ...data,
    urgency,
    status: 'PENDING',
    timeoutAt,
    createdAt: now,
  };

  const ref = await db.collection('convocatorias_cobertura').add(docData);
  await crearNotifConvocatoria(db, { ...docData, id: ref.id });

  // Novedad para ops — trazabilidad en Bitácora
  const typeLabel: Record<string, string> = {
    RET: 'RET', EXTEND: 'Extender jornada', ADVANCE: 'Adelantar turno',
    FT: 'Franco Trabajado', VOLANTE: 'Volante',
    SIN_TURNO: 'Sin turno', SIN_TURNO_CON_EXP: 'Sin turno (con exp.)',
  };
  await db.collection('novedades').add({
    type: 'CONVOCATORIA_ENVIADA',
    convocatoriaId: ref.id,
    shiftId: data.shiftId,
    objectiveId: data.objectiveId,
    objectiveName: data.objectiveName || '',
    clientId: data.clientId || null,
    empresaId: data.empresaId,
    title: 'Convocatoria enviada',
    message: `${typeLabel[data.type] || data.type} → ${data.candidateEmployeeName} — turno ${data.shiftCode || ''} en ${data.objectiveName || 'objetivo'}`,
    coverageType: data.type,
    candidateEmployeeId: data.candidateEmployeeId,
    candidateEmployeeName: data.candidateEmployeeName,
    status: 'unread',
    resolved: false,
    createdAt: now,
  });

  return ref.id;
}

// ─── Helper: encontrar mejor candidato para un paso ──────────────────────────

interface CandidateResult {
  id: string;
  name: string;
  uid?: string;
  extendShiftId?: string;
  advanceShiftId?: string;
}

async function findBestCandidate(
  db: admin.firestore.Firestore,
  conv: ConvocatoriaCoberturaDoc,
  type: CandidateType,
): Promise<CandidateResult | null> {
  const ctx = {
    objectiveId: conv.objectiveId,
    clientId: conv.clientId,
    aptitudesRequeridas: conv.aptitudesRequeridas || [],
  };

  if (type === 'EXTEND') {
    // Buscar turno activo en el objetivo que sea 8h (convertible a 12h)
    const active = await db.collection('turnos')
      .where('objectiveId', '==', conv.objectiveId)
      .where('empresaId', '==', conv.empresaId)
      .where('isPresent', '==', true)
      .where('isCompleted', '==', false)
      .limit(10)
      .get();

    for (const d of active.docs) {
      const t = d.data();
      const code = String(t.code || '').toUpperCase();
      if (code !== 'M' && code !== 'T' && code !== 'N') continue;
      const empSnap = await db.collection('empleados').doc(t.employeeId).get();
      if (!empSnap.exists) continue;
      const emp = empSnap.data()!;
      const check = checkEligibility(emp, ctx, 'EXTEND');
      if (check.eligible) {
        return {
          id: t.employeeId,
          name: t.employeeName || '',
          uid: emp.uid,
          extendShiftId: d.id,
        };
      }
    }
    return null;
  }

  if (type === 'ADVANCE') {
    // Buscar el próximo turno planificado del objetivo para hoy
    const now = Timestamp.now();
    const endOfDay = Timestamp.fromMillis(
      new Date(new Date().setHours(23, 59, 59, 0)).getTime(),
    );
    const next = await db.collection('turnos')
      .where('objectiveId', '==', conv.objectiveId)
      .where('empresaId', '==', conv.empresaId)
      .where('startTime', '>', now)
      .where('startTime', '<=', endOfDay)
      .where('isCompleted', '==', false)
      .orderBy('startTime')
      .limit(5)
      .get();

    for (const d of next.docs) {
      const t = d.data();
      if (!t.employeeId || t.employeeId === 'VACANTE') continue;
      const empSnap = await db.collection('empleados').doc(t.employeeId).get();
      if (!empSnap.exists) continue;
      const emp = empSnap.data()!;
      const check = checkEligibility(emp, ctx, 'ADVANCE');
      if (check.eligible) {
        return {
          id: t.employeeId,
          name: t.employeeName || '',
          uid: emp.uid,
          advanceShiftId: d.id,
        };
      }
    }
    return null;
  }

  // Para RET, VOLANTE, SIN_TURNO_CON_EXP, SIN_TURNO: buscar en empleados activos
  // status puede ser 'ACTIVE', 'active' o 'activo' según cómo fue cargado el legajo
  const empSnap = await db.collection('empleados')
    .where('empresaId', '==', conv.empresaId)
    .where('status', 'in', ['ACTIVE', 'active', 'activo', 'ACTIVO'])
    .limit(200)
    .get();

  // Turnos de hoy para detectar quién ya tiene turno
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 0);

  const todayShiftsSnap = await db.collection('turnos')
    .where('objectiveId', '==', conv.objectiveId)
    .where('empresaId', '==', conv.empresaId)
    .where('startTime', '>=', Timestamp.fromDate(todayStart))
    .where('startTime', '<=', Timestamp.fromDate(todayEnd))
    .limit(100)
    .get();

  const shiftsByEmp = new Map<string, string>(); // employeeId → code
  for (const d of todayShiftsSnap.docs) {
    const t = d.data();
    if (t.employeeId) shiftsByEmp.set(t.employeeId, String(t.code || ''));
  }

  // También turnos en cualquier objetivo para detectar ocupados
  const allTodaySnap = await db.collection('turnos')
    .where('empresaId', '==', conv.empresaId)
    .where('startTime', '>=', Timestamp.fromDate(todayStart))
    .where('startTime', '<=', Timestamp.fromDate(todayEnd))
    .limit(500)
    .get();

  const busyEmpIds = new Set<string>();
  const francoEmpIds = new Set<string>(); // tienen F/FF/FP hoy
  const retEmpIds = new Map<string, string>(); // employeeId → shiftId (RET)

  for (const d of allTodaySnap.docs) {
    const t = d.data();
    if (!t.employeeId || t.employeeId === 'VACANTE') continue;
    const code = String(t.code || '').toUpperCase();
    if (['F', 'FF', 'FP'].includes(code)) {
      francoEmpIds.add(t.employeeId);
    } else if (code === 'RET') {
      if (t.objectiveId === conv.objectiveId) {
        retEmpIds.set(t.employeeId, d.id);
      }
    } else if (!['FT'].includes(code)) {
      busyEmpIds.add(t.employeeId);
    }
  }

  // Empleados que ya tienen convocatoria PENDING/ESCALATED en OTRO turno.
  // Evita que la misma persona sea convocada a múltiples objetivos simultáneamente.
  const activeConvSnap = await db.collection('convocatorias_cobertura')
    .where('empresaId', '==', conv.empresaId)
    .where('status', 'in', ['PENDING', 'ESCALATED'])
    .get();
  const alreadyConvocadoIds = new Set<string>();
  for (const d of activeConvSnap.docs) {
    const c = d.data();
    if (c.shiftId !== conv.shiftId && c.candidateEmployeeId) {
      alreadyConvocadoIds.add(String(c.candidateEmployeeId));
    }
  }

  for (const empDoc of empSnap.docs) {
    const emp = empDoc.data();
    const empId = empDoc.id;

    if (type === 'RET') {
      if (!retEmpIds.has(empId)) continue;
      const check = checkEligibility(emp, ctx, 'RET');
      if (check.eligible) {
        const uid = await findEmployeeUid(db, empId, emp);
        return { id: empId, name: `${emp.lastName || ''} ${emp.firstName || ''}`.trim() || empId, uid: uid || undefined };
      }
    }

    if (type === 'VOLANTE') {
      if (busyEmpIds.has(empId) || alreadyConvocadoIds.has(empId)) continue;
      if (!(emp.volante || []).includes(conv.objectiveId)) continue;
      const check = checkEligibility(emp, ctx, 'VOLANTE');
      if (check.eligible) {
        const uid = await findEmployeeUid(db, empId, emp);
        return { id: empId, name: `${emp.lastName || ''} ${emp.firstName || ''}`.trim() || empId, uid: uid || undefined };
      }
    }

    if (type === 'SIN_TURNO_CON_EXP') {
      if (busyEmpIds.has(empId) || francoEmpIds.has(empId) || retEmpIds.has(empId) || alreadyConvocadoIds.has(empId)) continue;
      const isTitular = emp.preferredObjectiveId === conv.objectiveId;
      const hasExp = !!(emp.experienciaObjetivos || {})[conv.objectiveId];
      if (!isTitular && !hasExp) continue;
      const check = checkEligibility(emp, ctx, 'SIN_TURNO_CON_EXP');
      if (check.eligible) {
        const uid = await findEmployeeUid(db, empId, emp);
        return { id: empId, name: `${emp.lastName || ''} ${emp.firstName || ''}`.trim() || empId, uid: uid || undefined };
      }
    }

    if (type === 'SIN_TURNO') {
      if (busyEmpIds.has(empId) || francoEmpIds.has(empId) || retEmpIds.has(empId) || alreadyConvocadoIds.has(empId)) continue;
      const check = checkEligibility(emp, ctx, 'SIN_TURNO');
      if (check.eligible) {
        const uid = await findEmployeeUid(db, empId, emp);
        return { id: empId, name: `${emp.lastName || ''} ${emp.firstName || ''}`.trim() || empId, uid: uid || undefined };
      }
    }
  }

  return null;
}

// ─── Helper: broadcast FT ─────────────────────────────────────────────────────

async function dispararBroadcastFT(
  db: admin.firestore.Firestore,
  conv: ConvocatoriaCoberturaDoc,
): Promise<void> {
  const ctx = { objectiveId: conv.objectiveId, clientId: conv.clientId, aptitudesRequeridas: conv.aptitudesRequeridas };

  const empSnap = await db.collection('empleados')
    .where('empresaId', '==', conv.empresaId)
    .where('status', 'in', ['ACTIVE', 'active', 'activo', 'ACTIVO'])
    .limit(200)
    .get();

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 0);

  const allTodaySnap = await db.collection('turnos')
    .where('empresaId', '==', conv.empresaId)
    .where('startTime', '>=', Timestamp.fromDate(todayStart))
    .where('startTime', '<=', Timestamp.fromDate(todayEnd))
    .limit(500)
    .get();

  // Mapa empId → shiftId del turno franco para poder actualizar el turno cuando acepte
  const francoShiftByEmp = new Map<string, string>();
  for (const d of allTodaySnap.docs) {
    const t = d.data();
    if (!t.employeeId) continue;
    const code = String(t.code || '').toUpperCase();
    if (['F', 'FF', 'FP'].includes(code)) francoShiftByEmp.set(t.employeeId, d.id);
  }

  const batch: Promise<string>[] = [];
  for (const empDoc of empSnap.docs) {
    if (!francoShiftByEmp.has(empDoc.id)) continue;
    const emp = empDoc.data();
    const check = checkEligibility(emp, ctx as any, 'FT');
    if (!check.eligible) continue;
    const uid = await findEmployeeUid(db, empDoc.id, emp);
    batch.push(
      crearConvocatoriaDoc(db, {
        ...conv,
        type: 'FT',
        cascadeStep: 6,
        candidateEmployeeId: empDoc.id,
        candidateEmployeeName: `${emp.lastName || ''} ${emp.firstName || ''}`.trim() || empDoc.id,
        candidateUid: uid || undefined,
        ftShiftId: francoShiftByEmp.get(empDoc.id),
        createdBy: 'AUTO',
      }),
    );
    if (batch.length >= 5) break; // máx 5 en broadcast simultáneo
  }

  if (batch.length > 0) await Promise.all(batch);
}

// ─── Helper: resolver cobertura cuando un guardia acepta ─────────────────────

async function resolverCobertura(
  db: admin.firestore.Firestore,
  conv: ConvocatoriaCoberturaDoc & { id: string },
): Promise<void> {
  const batch = db.batch();

  // Trazabilidad: quién/qué resolvió la cobertura
  const resolvedBy = conv.createdBy === 'MODO_DEMO' ? 'MODO_DEMO'
                   : conv.createdBy === 'AUTO' ? 'AUTO'
                   : 'OPERACIONES';

  if (conv.type === 'EXTEND' && conv.extendShiftId) {
    const shiftRef = db.collection('turnos').doc(conv.extendShiftId);
    const newCode = String(conv.shiftCode || 'M').toUpperCase().startsWith('N') ? 'N12' : 'D12';
    batch.update(shiftRef, {
      code: newCode,
      isExtended: true,
      extendedBy: 'CONVOCATORIA',
      extendedAt: FieldValue.serverTimestamp(),
      resolvedBy,
    });
    batch.update(db.collection('turnos').doc(conv.shiftId), {
      coveredByEmployeeId: conv.candidateEmployeeId,
      coveredByEmployeeName: conv.candidateEmployeeName,
      coverageType: 'EXTEND',
      coverageResolvedAt: FieldValue.serverTimestamp(),
      coverageConvocatoriaId: conv.id,
    });
  } else if (conv.type === 'ADVANCE' && conv.advanceShiftId) {
    const nextRef = db.collection('turnos').doc(conv.advanceShiftId);
    batch.update(nextRef, {
      startTime: conv.startTime,
      isAdvanced: true,
      advancedBy: 'CONVOCATORIA',
      advancedAt: FieldValue.serverTimestamp(),
      resolvedBy,
    });
    batch.update(db.collection('turnos').doc(conv.shiftId), {
      coveredByEmployeeId: conv.candidateEmployeeId,
      coveredByEmployeeName: conv.candidateEmployeeName,
      coverageType: 'ADVANCE',
      coverageResolvedAt: FieldValue.serverTimestamp(),
      coverageConvocatoriaId: conv.id,
    });
  } else if (conv.type === 'RET') {
    const vacantRef = db.collection('turnos').doc(conv.shiftId);
    batch.update(vacantRef, {
      employeeId: conv.candidateEmployeeId,
      employeeName: conv.candidateEmployeeName,
      origin: 'OPERATIONS_COVERAGE',
      resolvedBy,
      isRetentionActivated: true,
      retentionActivatedAt: FieldValue.serverTimestamp(),
    });
  } else if (conv.type === 'FT') {
    if (conv.ftShiftId) {
      const ftRef = db.collection('turnos').doc(conv.ftShiftId);
      batch.update(ftRef, {
        code: 'FT',
        isFranco: false,
        isFrancoTrabajado: true,
        isPresent: true,
        presentAt: conv.startTime,
        realStartTime: conv.startTime,
        realEndTime: conv.endTime || null,
        resolvedBy,
        coveredShiftId: conv.shiftId,
        assignedByConvocatoria: conv.id,
        assignedAt: FieldValue.serverTimestamp(),
      });
    }
  } else {
    // VOLANTE, SIN_TURNO, SIN_TURNO_CON_EXP
    const vacantRef = db.collection('turnos').doc(conv.shiftId);
    batch.update(vacantRef, {
      employeeId: conv.candidateEmployeeId,
      employeeName: conv.candidateEmployeeName,
      code: String(conv.shiftCode || 'M'),
      origin: 'OPERATIONS_COVERAGE',
      resolvedBy,
      assignedByConvocatoria: conv.id,
      assignedAt: FieldValue.serverTimestamp(),
    });
  }

  // Cancelar todas las convocatorias activas del mismo shiftId (PENDING y ESCALATED)
  // — el primero que confirma de cualquier paso gana; los demás quedan cancelados
  const [pendingSnap, escalatedSnap] = await Promise.all([
    db.collection('convocatorias_cobertura').where('shiftId', '==', conv.shiftId).where('status', '==', 'PENDING').get(),
    db.collection('convocatorias_cobertura').where('shiftId', '==', conv.shiftId).where('status', '==', 'ESCALATED').get(),
  ]);

  for (const d of [...pendingSnap.docs, ...escalatedSnap.docs]) {
    if (d.id !== conv.id) {
      batch.update(d.ref, { status: 'CANCELLED', cancelledAt: FieldValue.serverTimestamp() });
    }
  }

  // Novedad para ops — aparece en Bitácora
  const novedadRef = db.collection('novedades').doc();
  const typeLabel: Record<string, string> = {
    RET: 'RET activado', EXTEND: 'Jornada extendida', ADVANCE: 'Turno adelantado',
    FT: 'Franco Trabajado', VOLANTE: 'Cobertura volante',
    SIN_TURNO: 'Guardia disponible', SIN_TURNO_CON_EXP: 'Guardia con experiencia',
  };
  batch.set(novedadRef, {
    type: 'COBERTURA_RESUELTA',
    shiftId: conv.shiftId,
    objectiveId: conv.objectiveId,
    objectiveName: conv.objectiveName || '',
    clientId: conv.clientId || null,
    empresaId: conv.empresaId,
    title: 'Cobertura resuelta',
    message: `${typeLabel[conv.type] || conv.type}: ${conv.candidateEmployeeName} cubre turno ${conv.shiftCode || ''} en ${conv.objectiveName || 'objetivo'}`,
    coverageType: conv.type,
    candidateEmployeeId: conv.candidateEmployeeId,
    candidateEmployeeName: conv.candidateEmployeeName,
    status: 'unread',
    resolved: false,
    createdAt: FieldValue.serverTimestamp(),
  });

  await batch.commit();
}

// ═══════════════════════════════════════════════════════════════════════════════
// CALLABLE: crearConvocatoriaCobertura
// Crea una convocatoria para un candidato específico y tipo de cobertura.
// Puede llamarse desde CoverageModal (manual) o desde la cascada automática.
// ═══════════════════════════════════════════════════════════════════════════════

export const crearConvocatoriaCobertura = functions
  .runWith({ timeoutSeconds: 60, memory: '256MB' })
  .https.onCall(async (data, context) => {
    if (!context.auth?.uid) {
      throw new functions.https.HttpsError('unauthenticated', 'Login requerido.');
    }
    const db = admin.firestore();

    const {
      shiftId,
      candidateEmployeeId,
      type,
      empresaId,
      advanceShiftId,
      extendShiftId,
    } = data as {
      shiftId: string;
      candidateEmployeeId: string;
      type: CandidateType;
      empresaId: string;
      advanceShiftId?: string;
      extendShiftId?: string;
    };

    if (!shiftId || !candidateEmployeeId || !type || !empresaId) {
      throw new functions.https.HttpsError('invalid-argument', 'shiftId, candidateEmployeeId, type y empresaId son requeridos.');
    }

    // Cargar turno vacante
    const shiftSnap = await db.collection('turnos').doc(shiftId).get();
    if (!shiftSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Turno no encontrado.');
    }
    const shift = shiftSnap.data()!;

    // Cargar candidato
    const empSnap = await db.collection('empleados').doc(candidateEmployeeId).get();
    if (!empSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Empleado no encontrado.');
    }
    const emp = empSnap.data()!;

    // Validar elegibilidad
    const ctx = {
      objectiveId: String(shift.objectiveId || ''),
      clientId: String(shift.clientId || ''),
      aptitudesRequeridas: [],
    };
    const eligibility = checkEligibility(emp, ctx, type);
    if (!eligibility.eligible) {
      throw new functions.https.HttpsError('failed-precondition', `Candidato no elegible: ${eligibility.reason}`);
    }

    // Verificar que no haya ya una PENDING para este shiftId/candidato
    const existing = await db.collection('convocatorias_cobertura')
      .where('shiftId', '==', shiftId)
      .where('candidateEmployeeId', '==', candidateEmployeeId)
      .where('status', '==', 'PENDING')
      .limit(1)
      .get();
    if (!existing.empty) {
      throw new functions.https.HttpsError('already-exists', 'Ya hay una convocatoria pendiente para este guardia y turno.');
    }

    const empName = `${emp.lastName || ''} ${emp.firstName || ''}`.trim() || candidateEmployeeId;
    const uid = await findEmployeeUid(db, candidateEmployeeId, emp);

    const callerSnap = await db.collection('system_users').doc(context.auth.uid).get();
    const callerName = callerSnap.exists ? String(callerSnap.data()?.displayName || callerSnap.data()?.name || '') : '';

    const convId = await crearConvocatoriaDoc(db, {
      empresaId,
      shiftId,
      objectiveId: String(shift.objectiveId || ''),
      objectiveName: String(shift.objectiveName || ''),
      clientId: String(shift.clientId || ''),
      clientName: String(shift.clientName || ''),
      shiftCode: String(shift.code || ''),
      startTime: shift.startTime,
      endTime: shift.endTime,
      aptitudesRequeridas: [],
      type,
      cascadeStep: CASCADE_ORDER.indexOf(type),
      candidateEmployeeId,
      candidateEmployeeName: empName,
      candidateUid: uid || undefined,
      ...(advanceShiftId ? { advanceShiftId } : {}),
      ...(extendShiftId ? { extendShiftId } : {}),
      createdBy: context.auth.uid,
      createdByName: callerName,
    });

    return { success: true, convocatoriaId: convId };
  });

// ═══════════════════════════════════════════════════════════════════════════════
// CALLABLE: responderConvocatoriaCobertura
// El guardia acepta o rechaza una convocatoria desde el portal.
// ═══════════════════════════════════════════════════════════════════════════════

export const responderConvocatoriaCobertura = functions
  .runWith({ timeoutSeconds: 60, memory: '256MB' })
  .https.onCall(async (data, context) => {
    if (!context.auth?.uid) {
      throw new functions.https.HttpsError('unauthenticated', 'Login requerido.');
    }
    const db = admin.firestore();

    const { convocatoriaId, response, rejectionReason } = data as {
      convocatoriaId: string;
      response: 'ACCEPTED' | 'REJECTED';
      rejectionReason?: string;
    };

    if (!convocatoriaId || !response) {
      throw new functions.https.HttpsError('invalid-argument', 'convocatoriaId y response son requeridos.');
    }

    const convRef = db.collection('convocatorias_cobertura').doc(convocatoriaId);
    const convSnap = await convRef.get();
    if (!convSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Convocatoria no encontrada.');
    }
    const conv = convSnap.data() as ConvocatoriaCoberturaDoc;

    // Acepta PENDING y ESCALATED — el paso anterior sigue activo incluso si ya avanzamos
    if (conv.status !== 'PENDING' && conv.status !== 'ESCALATED') {
      throw new functions.https.HttpsError('failed-precondition', `La convocatoria ya fue ${conv.status}.`);
    }

    // Verificar que quien responde es el candidato
    const uid = context.auth.uid;
    const empByUid = await db.collection('empleados').where('uid', '==', uid).limit(1).get();
    const empId = empByUid.empty ? uid : empByUid.docs[0].id;

    if (conv.candidateUid && conv.candidateUid !== uid && conv.candidateEmployeeId !== empId) {
      throw new functions.https.HttpsError('permission-denied', 'No podés responder una convocatoria que no te pertenece.');
    }

    const now = Timestamp.now();

    if (conv.type === 'LLEGADA_TARDE') {
      // Caso especial: el guardia tardío confirma si viene o no
      if (response === 'ACCEPTED') {
        await convRef.update({ status: 'ACCEPTED', respondedAt: now, resolvedAt: now });
        await db.collection('turnos').doc(conv.shiftId).update({
          lateArrivalConfirmed: true,
          lateArrivalConfirmedAt: now,
        });
      } else {
        await convRef.update({ status: 'REJECTED', respondedAt: now, rejectionReason: rejectionReason || null });
        // No viene → marcar ausente → onTurnoAbsenciaDetectada dispara cascade
        await db.collection('turnos').doc(conv.shiftId).update({
          isAbsent: true,
          status: 'ABSENT',
          absenceType: 'AA',
          absenceDetectedBy: 'LLEGADA_TARDE_RECHAZADA',
        });
      }
      return { success: true };
    }

    if (response === 'ACCEPTED') {
      await convRef.update({
        status: 'ACCEPTED',
        respondedAt: now,
        resolvedAt: now,
      });
      await resolverCobertura(db, { ...conv, id: convocatoriaId });
    } else {
      await convRef.update({
        status: 'REJECTED',
        respondedAt: now,
        rejectionReason: rejectionReason || null,
      });
      await db.collection('novedades').add({
        type: 'CONVOCATORIA_RECHAZADA',
        shiftId: conv.shiftId,
        objectiveId: conv.objectiveId,
        objectiveName: conv.objectiveName || '',
        empresaId: conv.empresaId,
        message: `${conv.candidateEmployeeName} rechazó la convocatoria (${conv.type}). Avanzando cascada.`,
        resolved: false,
        createdAt: FieldValue.serverTimestamp(),
      });
      await avanzarCascada(db, { ...conv, id: convocatoriaId }, 'REJECTED');
    }

    return { success: true };
  });

// ═══════════════════════════════════════════════════════════════════════════════
// CALLABLE: cancelarConvocatoriaCobertura
// Operaciones cancela una convocatoria activa.
// ═══════════════════════════════════════════════════════════════════════════════

export const cancelarConvocatoriaCobertura = functions
  .runWith({ timeoutSeconds: 30, memory: '128MB' })
  .https.onCall(async (data, context) => {
    if (!context.auth?.uid) {
      throw new functions.https.HttpsError('unauthenticated', 'Login requerido.');
    }
    const db = admin.firestore();

    const { convocatoriaId } = data as { convocatoriaId: string };
    if (!convocatoriaId) throw new functions.https.HttpsError('invalid-argument', 'convocatoriaId requerido.');

    const ref = db.collection('convocatorias_cobertura').doc(convocatoriaId);
    const snap = await ref.get();
    if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Convocatoria no encontrada.');

    if (snap.data()?.status !== 'PENDING') {
      throw new functions.https.HttpsError('failed-precondition', 'Solo se pueden cancelar convocatorias PENDING.');
    }

    await ref.update({
      status: 'CANCELLED',
      cancelledAt: Timestamp.now(),
      cancelledBy: context.auth.uid,
    });

    return { success: true };
  });

// ═══════════════════════════════════════════════════════════════════════════════
// CALLABLE: getCandidatosCobertura
// Devuelve la lista de candidatos elegibles para una vacante, por tipo.
// Usada por CoverageModal para mostrar opciones antes de convocar.
// ═══════════════════════════════════════════════════════════════════════════════

export const getCandidatosCobertura = functions
  .runWith({ timeoutSeconds: 60, memory: '256MB' })
  .https.onCall(async (data, context) => {
    if (!context.auth?.uid) throw new functions.https.HttpsError('unauthenticated', 'Login requerido.');
    const db = admin.firestore();

    const { shiftId, empresaId, type } = data as {
      shiftId: string;
      empresaId: string;
      type?: CandidateType;
    };

    const shiftSnap = await db.collection('turnos').doc(shiftId).get();
    if (!shiftSnap.exists) throw new functions.https.HttpsError('not-found', 'Turno no encontrado.');
    const shift = shiftSnap.data()!;

    const ctx = {
      objectiveId: String(shift.objectiveId || ''),
      clientId: String(shift.clientId || ''),
      aptitudesRequeridas: [],
    };

    const empSnap = await db.collection('empleados')
      .where('empresaId', '==', empresaId)
      .where('status', '==', 'ACTIVE')
      .limit(200)
      .get();

    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 0);

    const allTodaySnap = await db.collection('turnos')
      .where('empresaId', '==', empresaId)
      .where('startTime', '>=', Timestamp.fromDate(todayStart))
      .where('startTime', '<=', Timestamp.fromDate(todayEnd))
      .limit(500)
      .get();

    const empShiftCode = new Map<string, string>();
    for (const d of allTodaySnap.docs) {
      const t = d.data();
      if (t.employeeId) empShiftCode.set(t.employeeId, String(t.code || ''));
    }

    const results: {
      employeeId: string;
      employeeName: string;
      candidateType: CandidateType;
      eligibility: { eligible: boolean; reason?: string };
      distanceKm?: number;
    }[] = [];

    for (const empDoc of empSnap.docs) {
      const emp = empDoc.data();
      const empId = empDoc.id;
      const shiftCode = empShiftCode.get(empId);

      let derivedType: CandidateType | null = null;
      if (shiftCode === 'RET' && shift.objectiveId === emp.preferredObjectiveId) {
        derivedType = 'RET';
      } else if (shiftCode && ['F', 'FF', 'FP'].includes(shiftCode)) {
        derivedType = 'FT';
      } else if (!shiftCode) {
        derivedType = (emp.volante || []).includes(shift.objectiveId)
          ? 'VOLANTE'
          : (emp.preferredObjectiveId === shift.objectiveId || !!(emp.experienciaObjetivos || {})[shift.objectiveId])
          ? 'SIN_TURNO_CON_EXP'
          : 'SIN_TURNO';
      }

      if (!derivedType) continue;
      if (type && derivedType !== type) continue;

      const eligibility = checkEligibility(emp, ctx, derivedType);
      results.push({
        employeeId: empId,
        employeeName: `${emp.lastName || ''} ${emp.firstName || ''}`.trim() || empId,
        candidateType: derivedType,
        eligibility,
      });
    }

    // Ordenar: RET → VOLANTE → SIN_TURNO_CON_EXP → SIN_TURNO → FT, elegibles primero
    const order = ['RET', 'VOLANTE', 'SIN_TURNO_CON_EXP', 'SIN_TURNO', 'FT'];
    results.sort((a, b) => {
      if (a.eligibility.eligible !== b.eligibility.eligible) return a.eligibility.eligible ? -1 : 1;
      return order.indexOf(a.candidateType) - order.indexOf(b.candidateType);
    });

    return { candidates: results };
  });

// ─── Helper: asignación directa RET (obligatorio, sin flujo accept/reject) ───

async function asignarRETDirecto(
  db: admin.firestore.Firestore,
  baseConv: ConvocatoriaCoberturaDoc,
  candidate: { id: string; name: string; uid?: string | null },
  createdBy: string,
): Promise<void> {
  const convId = db.collection('convocatorias_cobertura').doc().id;
  const now = Timestamp.now();
  const retConv: ConvocatoriaCoberturaDoc & { id: string } = {
    ...baseConv,
    id: convId,
    type: 'RET',
    cascadeStep: CASCADE_ORDER.indexOf('RET'),
    candidateEmployeeId: candidate.id,
    candidateEmployeeName: candidate.name,
    candidateUid: candidate.uid ?? undefined,
    status: 'ACCEPTED',
    timeoutAt: now,
    createdAt: now,
    createdBy,
    resolvedAt: now,
  };

  await db.collection('convocatorias_cobertura').doc(convId).set({
    ...retConv,
    createdAt: FieldValue.serverTimestamp(),
    resolvedAt: FieldValue.serverTimestamp(),
  });

  await resolverCobertura(db, retConv);

  const startTime = retConv.startTime instanceof Timestamp
    ? retConv.startTime.toDate().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Argentina/Buenos_Aires' })
    : '--:--';
  await db.collection('user_notifications').add({
    uid: candidate.uid || null,
    employeeId: candidate.id,
    type: 'CONVOCATORIA_COBERTURA',
    title: '⚡ Turno RET asignado',
    body: `Fuiste asignado para cubrir turno ${baseConv.shiftCode || ''} en ${baseConv.objectiveName || 'el puesto'} desde las ${startTime}. Confirmá lectura.`,
    empresaId: baseConv.empresaId,
    convocatoriaId: convId,
    shiftId: baseConv.shiftId,
    objectiveId: baseConv.objectiveId,
    isReadReceipt: true,
    read: false,
    readAt: null,
    createdAt: FieldValue.serverTimestamp(),
  });
}

// ─── MODO DEMO: arrancar cascada desde step 0 para un turno ausente ──────────

export interface ShiftDataForCascade {
  id: string;
  objectiveId: string;
  objectiveName?: string;
  clientId?: string;
  clientName?: string;
  code?: string;
  startTime: Timestamp;
  endTime?: Timestamp;
  empresaId: string;
}

export async function iniciarCascadaCobertura(
  db: admin.firestore.Firestore,
  shift: ShiftDataForCascade,
  createdBy = 'AUTO',
): Promise<void> {
  // Si ya hay una convocatoria activa para este turno, no crear otra
  const existing = await db.collection('convocatorias_cobertura')
    .where('shiftId', '==', shift.id)
    .where('status', 'in', ['PENDING', 'ESCALATED'])
    .limit(1)
    .get();
  if (!existing.empty) return;

  const baseConvData: ConvocatoriaCoberturaDoc = {
    empresaId: shift.empresaId,
    shiftId: shift.id,
    objectiveId: String(shift.objectiveId || ''),
    objectiveName: String(shift.objectiveName || ''),
    clientId: String(shift.clientId || ''),
    clientName: String(shift.clientName || ''),
    shiftCode: String(shift.code || ''),
    startTime: shift.startTime,
    endTime: shift.endTime,
    aptitudesRequeridas: [],
    type: 'RET',
    urgency: getUrgency(shift.startTime),
    cascadeStep: 0,
    candidateEmployeeId: '',
    candidateEmployeeName: '',
    status: 'PENDING',
    timeoutAt: Timestamp.now(),
    createdAt: Timestamp.now(),
    createdBy,
  };

  // Iterar la cascada desde el primer paso hasta encontrar candidato
  for (const type of CASCADE_ORDER) {
    if (type === 'FT') {
      await dispararBroadcastFT(db, baseConvData);
      return;
    }
    const candidate = await findBestCandidate(db, baseConvData, type);
    if (!candidate) continue;

    if (type === 'RET') {
      await asignarRETDirecto(db, baseConvData, candidate, createdBy);
      return;
    }

    await crearConvocatoriaDoc(db, {
      ...baseConvData,
      type,
      cascadeStep: CASCADE_ORDER.indexOf(type),
      candidateEmployeeId: candidate.id,
      candidateEmployeeName: candidate.name,
      candidateUid: candidate.uid,
      ...(candidate.extendShiftId ? { extendShiftId: candidate.extendShiftId } : {}),
      ...(candidate.advanceShiftId ? { advanceShiftId: candidate.advanceShiftId } : {}),
      createdBy,
    });
    return;
  }

  // Sin candidatos en ningún paso
  await db.collection('novedades').add({
    type: 'VACANTE_SIN_COBERTURA',
    shiftId: shift.id,
    objectiveId: shift.objectiveId,
    objectiveName: shift.objectiveName || '',
    empresaId: shift.empresaId,
    message: `Sin candidatos para turno ${shift.code || ''} en ${shift.objectiveName || 'objetivo'} (MODO DEMO).`,
    resolved: false,
    createdAt: FieldValue.serverTimestamp(),
  });
}

// ─── MODO DEMO: simular respuestas de guardias a convocatorias ────────────────

export async function simularRespuestasConvocatorias(
  db: admin.firestore.Firestore,
  empresaId: string,
): Promise<number> {
  const THINK_TIME_MS = 90 * 1000; // guardia "piensa" 90 s antes de responder
  const now = Timestamp.now();
  const cutoffMs = now.toMillis() - THINK_TIME_MS;

  const snap = await db.collection('convocatorias_cobertura')
    .where('empresaId', '==', empresaId)
    .where('status', 'in', ['PENDING', 'ESCALATED'])
    .limit(50)
    .get();

  let respondidas = 0;
  for (const convDoc of snap.docs) {
    const conv = convDoc.data() as ConvocatoriaCoberturaDoc;
    const createdMs = conv.createdAt instanceof Timestamp ? conv.createdAt.toMillis() : 0;
    if (createdMs > cutoffMs) continue; // aún en el tiempo de "pensado"

    // Determinístico por id: chars % 10 → 0-7 acepta (80%), 8-9 rechaza (20%)
    const hashVal = convDoc.id.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0) % 10;
    const accept = hashVal <= 7;

    try {
      if (accept) {
        await convDoc.ref.update({ status: 'ACCEPTED', respondedAt: now, respondedBy: 'MODO_DEMO' });
        await resolverCobertura(db, { ...conv, id: convDoc.id });
      } else {
        await convDoc.ref.update({ status: 'REJECTED', respondedAt: now, rejectionReason: 'MODO_DEMO_AUTO', respondedBy: 'MODO_DEMO' });
        await avanzarCascada(db, { ...conv, id: convDoc.id }, 'REJECTED');
      }
      respondidas++;
    } catch (e) {
      console.warn('[simularRespuestasConvocatorias]', convDoc.id, (e as Error)?.message);
    }
  }
  return respondidas;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCHEDULER: checkConvocatoriaTimeouts
// Cada 5 min: detecta convocatorias PENDING vencidas y avanza la cascada.
// ═══════════════════════════════════════════════════════════════════════════════

export const checkConvocatoriaTimeouts = onSchedule(
  {
    schedule: 'every 1 minutes',
    timeZone: 'America/Argentina/Buenos_Aires',
    timeoutSeconds: 60,
    memory: '256MiB',
  },
  async () => {
    const db = admin.firestore();
    const now = Timestamp.now();

    const timedOut = await db.collection('convocatorias_cobertura')
      .where('status', '==', 'PENDING')
      .where('timeoutAt', '<=', now)
      .limit(50)
      .get();

    if (timedOut.empty) return;

    for (const d of timedOut.docs) {
      const conv = d.data() as ConvocatoriaCoberturaDoc;
      try {
        if (conv.type === 'LLEGADA_TARDE') {
          // Guardia no confirmó que viene → marcar ausente → trigger cascade
          await d.ref.update({ status: 'TIMEOUT', escalatedAt: now });
          await db.collection('turnos').doc(conv.shiftId).update({
            isAbsent: true,
            status: 'ABSENT',
            absenceType: 'AA',
            absenceDetectedBy: 'LLEGADA_TARDE_TIMEOUT',
          });
          console.log(`[checkConvocatoriaTimeouts] LLEGADA_TARDE timeout → isAbsent=true en ${conv.shiftId}`);
        } else {
          // Cascada regular: ESCALATED sigue activa, avanzar al siguiente paso
          await d.ref.update({ status: 'ESCALATED', escalatedAt: now });
          await avanzarCascada(db, { ...conv, id: d.id }, 'TIMEOUT');
        }
      } catch (e) {
        console.error(`[checkConvocatoriaTimeouts] Error en ${d.id}:`, (e as Error).message);
      }
    }
  },
);

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER EXPORTADO: crearConvocatoriaLlegadaTarde
// Pregunta al guardia tardío si viene antes de marcarlo ausente.
// Lo llama detectarAusencias BLOQUE 1 cuando detecta T+0 sin check-in.
// ═══════════════════════════════════════════════════════════════════════════════

export async function crearConvocatoriaLlegadaTarde(
  db: admin.firestore.Firestore,
  shift: {
    id: string;
    empresaId: string;
    objectiveId: string;
    objectiveName: string;
    clientId: string;
    shiftCode: string;
    startTime: Timestamp;
    endTime?: Timestamp;
    employeeId: string;
    employeeName: string;
    employeeUid?: string;
  },
): Promise<void> {
  // Idempotencia: no crear segunda convocatoria LLEGADA_TARDE para el mismo turno
  const existing = await db.collection('convocatorias_cobertura')
    .where('shiftId', '==', shift.id)
    .where('type', '==', 'LLEGADA_TARDE')
    .where('status', 'in', ['PENDING', 'ESCALATED'])
    .limit(1)
    .get();
  if (!existing.empty) return;

  const now = Timestamp.now();
  const timeoutAt = Timestamp.fromMillis(now.toMillis() + TIMEOUT_MINUTES * 60 * 1000);

  const convRef = db.collection('convocatorias_cobertura').doc();
  const convData: ConvocatoriaCoberturaDoc = {
    empresaId: shift.empresaId,
    shiftId: shift.id,
    objectiveId: shift.objectiveId,
    objectiveName: shift.objectiveName,
    clientId: shift.clientId,
    shiftCode: shift.shiftCode,
    startTime: shift.startTime,
    endTime: shift.endTime,
    type: 'LLEGADA_TARDE',
    urgency: getUrgency(shift.startTime),
    cascadeStep: -1,
    candidateEmployeeId: shift.employeeId,
    candidateEmployeeName: shift.employeeName,
    candidateUid: shift.employeeUid,
    aptitudesRequeridas: [],
    status: 'PENDING',
    timeoutAt,
    createdAt: now,
    createdBy: 'AUTO',
  };

  await convRef.set(convData);
  await crearNotifConvocatoria(db, { ...convData, id: convRef.id });
  console.log(`[crearConvocatoriaLlegadaTarde] Enviada a ${shift.employeeName} para turno ${shift.id}`);
}
