import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';

const FRANCO_CODES = new Set(['F', 'FF', 'FP', 'FT']);

type ShiftDoc = admin.firestore.DocumentData & {
  employeeId?: string;
  employeeName?: string;
  objectiveId?: string;
  objectiveName?: string;
  clientName?: string;
  positionName?: string;
  empresaId?: string;
  startTime?: Timestamp;
  endTime?: Timestamp;
  code?: string;
  isFranco?: boolean;
  isCompleted?: boolean;
  isPresent?: boolean;
  status?: string;
};

async function resolveEmployeeIdForUid(
  db: admin.firestore.Firestore,
  uid: string,
): Promise<{ empId: string; empData: admin.firestore.DocumentData } | null> {
  const byUid = await db.collection('empleados').where('uid', '==', uid).limit(1).get();
  if (!byUid.empty) {
    const d = byUid.docs[0];
    return { empId: d.id, empData: d.data() };
  }
  const byId = await db.collection('empleados').doc(uid).get();
  if (byId.exists) {
    return { empId: byId.id, empData: byId.data()! };
  }
  return null;
}

function employeeDisplayName(data: admin.firestore.DocumentData | undefined): string {
  if (!data) return 'Empleado';
  const name = `${data.lastName || ''} ${data.firstName || ''}`.trim();
  return name || String(data.email || 'Empleado');
}

function dateKeyAr(ts: Timestamp | undefined): string {
  if (!ts) return '';
  const d = ts.toDate();
  const fmt = new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(d);
  const y = parts.find((p) => p.type === 'year')?.value ?? '';
  const m = parts.find((p) => p.type === 'month')?.value ?? '';
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  return `${y}-${m}-${day}`;
}

function shiftIsSwappable(shift: ShiftDoc): boolean {
  if (!shift.employeeId || shift.employeeId === 'VACANTE') return false;
  if (shift.isCompleted) return false;
  if (shift.isPresent) return false;
  const st = String(shift.status || '').toUpperCase();
  if (['COMPLETED', 'CANCELLED', 'INTERRUPTED', 'ABSENT'].includes(st)) return false;
  const code = String(shift.code || '').toUpperCase();
  if (FRANCO_CODES.has(code) || shift.isFranco) return true;
  return code.length > 0;
}

async function assertPortalEmployee(context: functions.https.CallableContext): Promise<{
  uid: string;
  empId: string;
  empData: admin.firestore.DocumentData;
}> {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Login requerido.');
  }
  const db = admin.firestore();
  const resolved = await resolveEmployeeIdForUid(db, context.auth.uid);
  if (!resolved) {
    throw new functions.https.HttpsError('permission-denied', 'Perfil de vigilador no encontrado.');
  }
  return { uid: context.auth.uid, empId: resolved.empId, empData: resolved.empData };
}

async function loadShift(db: admin.firestore.Firestore, shiftId: string): Promise<{
  ref: admin.firestore.DocumentReference;
  data: ShiftDoc;
}> {
  const ref = db.collection('turnos').doc(shiftId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new functions.https.HttpsError('not-found', 'Turno no encontrado.');
  }
  return { ref, data: snap.data() as ShiftDoc };
}

function mapCandidate(shiftId: string, data: ShiftDoc, empName: string) {
  return {
    shiftId,
    employeeId: data.employeeId,
    employeeName: data.employeeName || empName,
    objectiveId: data.objectiveId,
    objectiveName: data.objectiveName,
    clientName: data.clientName,
    positionName: data.positionName,
    startTime: data.startTime,
    endTime: data.endTime,
    code: data.code,
    isFranco: data.isFranco,
  };
}

async function notifySwapParties(
  db: admin.firestore.Firestore,
  request: admin.firestore.DocumentData,
  title: string,
  body: string,
) {
  const empresaId = request.empresaId || null;
  const batch: Promise<unknown>[] = [];
  const uids = [request.requesterUid, request.targetUid].filter((u): u is string => typeof u === 'string');
  for (const uid of uids) {
    batch.push(
      db.collection('user_notifications').add({
        uid,
        employeeId: uid === request.requesterUid ? request.requesterId : request.targetId,
        title,
        body,
        type: 'SWAP_REQUEST',
        target: 'employee',
        read: false,
        readAt: null,
        empresaId,
        createdAt: FieldValue.serverTimestamp(),
      }),
    );
  }
  await Promise.all(batch);
}

async function applySwapToTurnos(
  db: admin.firestore.Firestore,
  request: admin.firestore.DocumentData,
  supervisorName: string,
): Promise<void> {
  const myShiftId = String(request.requesterShiftId || '');
  const targetShiftId = String(request.targetShiftId || '');
  if (!myShiftId || !targetShiftId) {
    throw new functions.https.HttpsError('failed-precondition', 'Solicitud incompleta.');
  }

  const { data: shiftA } = await loadShift(db, myShiftId);
  const { data: shiftB } = await loadShift(db, targetShiftId);

  const empAId = String(request.requesterId || '');
  const empBId = String(request.targetId || '');
  const nameA = String(request.requesterName || shiftA.employeeName || '');
  const nameB = String(request.targetName || shiftB.employeeName || '');
  const dateA = dateKeyAr(shiftA.startTime as Timestamp);
  const dateB = dateKeyAr(shiftB.startTime as Timestamp);

  const batch = db.batch();

  batch.update(db.collection('turnos').doc(myShiftId), {
    employeeId: empBId,
    employeeName: nameB,
    swapWith: nameA,
    swapDate: dateB,
    isSwap: true,
    swapAuthorized: true,
    swapAuthorizedAt: FieldValue.serverTimestamp(),
    swapAuthorizedBy: supervisorName,
    swapRequestId: request.id || null,
    origin: shiftA.origin || 'PORTAL_SWAP',
  });

  batch.update(db.collection('turnos').doc(targetShiftId), {
    employeeId: empAId,
    employeeName: nameA,
    swapWith: nameB,
    swapDate: dateA,
    isSwap: true,
    swapAuthorized: true,
    swapAuthorizedAt: FieldValue.serverTimestamp(),
    swapAuthorizedBy: supervisorName,
    swapRequestId: request.id || null,
    origin: shiftB.origin || 'PORTAL_SWAP',
  });

  await batch.commit();
}

export const getSwapPeople = functions.https.onCall(async (_data, context) => {
  const { empId, empData } = await assertPortalEmployee(context);
  const db = admin.firestore();
  const empresaId = String(empData.empresaId || '').trim();
  const now = Timestamp.now();
  const horizon = Timestamp.fromMillis(now.toMillis() + 45 * 24 * 60 * 60 * 1000);

  let q = db.collection('turnos')
    .where('employeeId', '==', empId)
    .where('startTime', '>=', now)
    .where('startTime', '<=', horizon);

  if (empresaId) {
    q = q.where('empresaId', '==', empresaId);
  }

  const myShifts = await q.limit(40).get();
  const objectiveIds = new Set<string>();
  myShifts.docs.forEach((d) => {
    const oid = d.data().objectiveId;
    if (oid) objectiveIds.add(String(oid));
  });

  if (objectiveIds.size === 0) {
    return { data: [] };
  }

  const peopleMap = new Map<string, string>();
  for (const objectiveId of objectiveIds) {
    let oq = db.collection('turnos')
      .where('objectiveId', '==', objectiveId)
      .where('startTime', '>=', now)
      .where('startTime', '<=', horizon);
    if (empresaId) oq = oq.where('empresaId', '==', empresaId);
    const snap = await oq.limit(120).get();
    for (const doc of snap.docs) {
      const dat = doc.data() as ShiftDoc;
      const eid = dat.employeeId;
      if (!eid || eid === empId || eid === 'VACANTE') continue;
      if (!peopleMap.has(eid)) {
        peopleMap.set(eid, dat.employeeName || 'Empleado');
      }
    }
  }

  const data = Array.from(peopleMap.entries())
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));

  return { data };
});

export const getSwapCandidates = functions.https.onCall(async (data, context) => {
  const { empId, empData } = await assertPortalEmployee(context);
  const shiftId = String(data?.shiftId || '').trim();
  if (!shiftId) {
    throw new functions.https.HttpsError('invalid-argument', 'shiftId requerido.');
  }

  const db = admin.firestore();
  const { data: myShift } = await loadShift(db, shiftId);
  if (myShift.employeeId !== empId) {
    throw new functions.https.HttpsError('permission-denied', 'El turno no es tuyo.');
  }
  if (!shiftIsSwappable(myShift)) {
    throw new functions.https.HttpsError('failed-precondition', 'Este turno no admite permuta.');
  }

  const objectiveId = String(myShift.objectiveId || '');
  if (!objectiveId) {
    throw new functions.https.HttpsError('failed-precondition', 'Turno sin objetivo.');
  }

  const empresaId = String(myShift.empresaId || empData.empresaId || '').trim();
  const now = Timestamp.now();
  const horizon = Timestamp.fromMillis(now.toMillis() + 45 * 24 * 60 * 60 * 1000);

  let q = db.collection('turnos')
    .where('objectiveId', '==', objectiveId)
    .where('startTime', '>=', now)
    .where('startTime', '<=', horizon);
  if (empresaId) q = q.where('empresaId', '==', empresaId);

  const snap = await q.limit(150).get();
  const empNames = new Map<string, string>();

  const candidates: ReturnType<typeof mapCandidate>[] = [];
  for (const doc of snap.docs) {
    if (doc.id === shiftId) continue;
    const dat = doc.data() as ShiftDoc;
    if (dat.employeeId === empId) continue;
    if (!shiftIsSwappable(dat)) continue;
    const eid = dat.employeeId || '';
    if (eid && !empNames.has(eid)) {
      const empSnap = await db.collection('empleados').doc(eid).get();
      empNames.set(eid, employeeDisplayName(empSnap.data()));
    }
    candidates.push(mapCandidate(doc.id, dat, empNames.get(eid) || dat.employeeName || 'Empleado'));
  }

  return { data: candidates };
});

export const createSwapRequest = functions.https.onCall(async (data, context) => {
  const { uid, empId, empData } = await assertPortalEmployee(context);
  const myShiftId = String(data?.myShiftId || '').trim();
  const targetShiftId = String(data?.targetShiftId || '').trim();
  if (!myShiftId || !targetShiftId) {
    throw new functions.https.HttpsError('invalid-argument', 'myShiftId y targetShiftId requeridos.');
  }
  if (myShiftId === targetShiftId) {
    throw new functions.https.HttpsError('invalid-argument', 'Los turnos deben ser distintos.');
  }

  const db = admin.firestore();
  const { data: myShift } = await loadShift(db, myShiftId);
  const { data: targetShift } = await loadShift(db, targetShiftId);

  if (myShift.employeeId !== empId) {
    throw new functions.https.HttpsError('permission-denied', 'El turno origen no es tuyo.');
  }
  if (!shiftIsSwappable(myShift) || !shiftIsSwappable(targetShift)) {
    throw new functions.https.HttpsError('failed-precondition', 'Uno de los turnos no admite permuta.');
  }

  const targetEmpId = String(targetShift.employeeId || '');
  if (!targetEmpId || targetEmpId === 'VACANTE') {
    throw new functions.https.HttpsError('failed-precondition', 'Turno destino sin guardia asignado.');
  }

  const objectiveId = String(myShift.objectiveId || '');
  if (objectiveId && targetShift.objectiveId !== objectiveId) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Por ahora la permuta es solo dentro del mismo objetivo.',
    );
  }

  const targetEmpSnap = await db.collection('empleados').doc(targetEmpId).get();
  const targetUid = targetEmpSnap.data()?.uid as string | undefined;

  const requesterName = employeeDisplayName(empData);
  const targetName = employeeDisplayName(targetEmpSnap.data());

  const ref = await db.collection('swap_requests').add({
    status: 'PENDING_PEER',
    empresaId: myShift.empresaId || empData.empresaId || null,
    objectiveId,
    objectiveName: myShift.objectiveName || targetShift.objectiveName || '',
    requesterId: empId,
    requesterUid: uid,
    requesterName,
    targetId: targetEmpId,
    targetUid: targetUid || null,
    targetName,
    requesterShiftId: myShiftId,
    targetShiftId,
    requesterShiftDate: dateKeyAr(myShift.startTime as Timestamp),
    targetShiftDate: dateKeyAr(targetShift.startTime as Timestamp),
    requesterClientName: myShift.clientName || '',
    requesterObjectiveName: myShift.objectiveName || '',
    requesterPositionName: myShift.positionName || '',
    targetClientName: targetShift.clientName || '',
    targetObjectiveName: targetShift.objectiveName || '',
    targetPositionName: targetShift.positionName || '',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  await notifySwapParties(
    db,
    {
      requesterUid: uid,
      targetUid,
      requesterId: empId,
      targetId: targetEmpId,
      empresaId: myShift.empresaId,
    },
    'Solicitud de permuta',
    `${requesterName} quiere permutar turno contigo. Revisá en la app.`,
  );

  return { success: true, requestId: ref.id };
});

export const respondSwapRequest = functions.https.onCall(async (data, context) => {
  const { uid, empId } = await assertPortalEmployee(context);
  const requestId = String(data?.requestId || '').trim();
  const accept = data?.accept === true;
  if (!requestId) {
    throw new functions.https.HttpsError('invalid-argument', 'requestId requerido.');
  }

  const db = admin.firestore();
  const ref = db.collection('swap_requests').doc(requestId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new functions.https.HttpsError('not-found', 'Solicitud no encontrada.');
  }
  const req = snap.data()!;
  if (req.targetId !== empId && req.targetUid !== uid) {
    throw new functions.https.HttpsError('permission-denied', 'No sos el compañero destino.');
  }
  if (req.status !== 'PENDING_PEER') {
    throw new functions.https.HttpsError('failed-precondition', 'La solicitud ya no espera tu respuesta.');
  }

  if (!accept) {
    await ref.update({
      status: 'REJECTED',
      rejectedBy: 'TARGET',
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { success: true, status: 'REJECTED' };
  }

  await ref.update({
    status: 'PENDING_REQUESTER',
    peerAcceptedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  await notifySwapParties(
    db,
    req,
    'Permuta aceptada por compañero',
    `${req.targetName || 'Tu compañero'} aceptó. Confirmá la permuta en la app.`,
  );

  return { success: true, status: 'PENDING_REQUESTER' };
});

export const confirmSwapRequest = functions.https.onCall(async (data, context) => {
  const { uid, empId } = await assertPortalEmployee(context);
  const requestId = String(data?.requestId || '').trim();
  const confirm = data?.confirm === true;
  if (!requestId) {
    throw new functions.https.HttpsError('invalid-argument', 'requestId requerido.');
  }

  const db = admin.firestore();
  const ref = db.collection('swap_requests').doc(requestId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new functions.https.HttpsError('not-found', 'Solicitud no encontrada.');
  }
  const reqData = snap.data()!;
  const req = { id: snap.id, ...reqData };
  if (String(reqData.requesterId) !== empId && String(reqData.requesterUid) !== uid) {
    throw new functions.https.HttpsError('permission-denied', 'Solo el solicitante puede confirmar.');
  }
  if (reqData.status !== 'PENDING_REQUESTER') {
    throw new functions.https.HttpsError('failed-precondition', 'La solicitud no espera tu confirmación.');
  }

  if (!confirm) {
    await ref.update({
      status: 'CANCELLED',
      cancelledBy: 'REQUESTER',
      updatedAt: FieldValue.serverTimestamp(),
    });
    return { success: true, status: 'CANCELLED' };
  }

  await ref.update({
    status: 'PENDING_SUPERVISOR',
    requesterConfirmedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  await notifySwapParties(
    db,
    req,
    'Permuta pendiente de supervisor',
    'Ambos guardias confirmaron. Un supervisor debe autorizar en planificación.',
  );

  return { success: true, status: 'PENDING_SUPERVISOR' };
});

export const cancelSwapRequest = functions.https.onCall(async (data, context) => {
  const { uid, empId } = await assertPortalEmployee(context);
  const requestId = String(data?.requestId || '').trim();
  if (!requestId) {
    throw new functions.https.HttpsError('invalid-argument', 'requestId requerido.');
  }

  const db = admin.firestore();
  const ref = db.collection('swap_requests').doc(requestId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new functions.https.HttpsError('not-found', 'Solicitud no encontrada.');
  }
  const req = snap.data()!;
  const isRequester = req.requesterId === empId || req.requesterUid === uid;
  const isTarget = req.targetId === empId || req.targetUid === uid;
  if (!isRequester && !isTarget) {
    throw new functions.https.HttpsError('permission-denied', 'No participás en esta solicitud.');
  }
  const st = String(req.status || '');
  if (['APPROVED', 'REJECTED', 'CANCELLED'].includes(st)) {
    throw new functions.https.HttpsError('failed-precondition', 'La solicitud ya está cerrada.');
  }

  await ref.update({
    status: 'CANCELLED',
    cancelledBy: isRequester ? 'REQUESTER' : 'TARGET',
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { success: true, status: 'CANCELLED' };
});

async function assertSupervisorOrAdmin(
  context: functions.https.CallableContext,
): Promise<{ uid: string; name: string }> {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Login requerido.');
  }
  const userRecord = await admin.auth().getUser(context.auth.uid);
  const claims = userRecord.customClaims || {};
  const role = String(claims.role || '').toUpperCase().replace(/_/g, '');
  const adminRoles = ['SUPERADMIN', 'ADMIN', 'MANAGER', 'SCHEDULER', 'SUPERVISOR', 'OPERATOR'];
  if (!adminRoles.includes(role)) {
    throw new functions.https.HttpsError('permission-denied', 'Solo supervisores o planificación pueden autorizar.');
  }
  const snap = await admin.firestore().collection('system_users').doc(context.auth.uid).get();
  const d = snap.data();
  const name = d ? `${d.firstName || ''} ${d.lastName || ''}`.trim() : userRecord.email || 'Supervisor';
  return { uid: context.auth.uid, name: name || 'Supervisor' };
}

export const approveSwapRequest = functions.https.onCall(async (data, context) => {
  const supervisor = await assertSupervisorOrAdmin(context);
  const requestId = String(data?.requestId || '').trim();
  const pin = String(data?.supervisorPin || '').trim();
  if (!requestId) {
    throw new functions.https.HttpsError('invalid-argument', 'requestId requerido.');
  }

  const db = admin.firestore();
  if (pin.length === 4) {
    const pinSnap = await db.collection('system_users').where('supervisorPin', '==', pin).limit(1).get();
    if (pinSnap.empty) {
      throw new functions.https.HttpsError('permission-denied', 'PIN de supervisor inválido.');
    }
  }

  const ref = db.collection('swap_requests').doc(requestId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new functions.https.HttpsError('not-found', 'Solicitud no encontrada.');
  }
  const reqData = snap.data()!;
  const req = { id: snap.id, ...reqData };
  if (reqData.status !== 'PENDING_SUPERVISOR') {
    throw new functions.https.HttpsError('failed-precondition', 'La permuta no está pendiente de supervisor.');
  }

  await applySwapToTurnos(db, req, supervisor.name);

  await ref.update({
    status: 'APPROVED',
    approvedAt: FieldValue.serverTimestamp(),
    approvedByUid: supervisor.uid,
    approvedByName: supervisor.name,
    updatedAt: FieldValue.serverTimestamp(),
  });

  await notifySwapParties(
    db,
    req,
    'Permuta autorizada',
    'Un supervisor autorizó la permuta. Los turnos ya están actualizados.',
  );

  return { success: true, status: 'APPROVED' };
});

export const rejectSwapRequestSupervisor = functions.https.onCall(async (data, context) => {
  await assertSupervisorOrAdmin(context);
  const requestId = String(data?.requestId || '').trim();
  if (!requestId) {
    throw new functions.https.HttpsError('invalid-argument', 'requestId requerido.');
  }

  const db = admin.firestore();
  const ref = db.collection('swap_requests').doc(requestId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new functions.https.HttpsError('not-found', 'Solicitud no encontrada.');
  }
  const req = snap.data()!;
  if (req.status !== 'PENDING_SUPERVISOR') {
    throw new functions.https.HttpsError('failed-precondition', 'La permuta no está pendiente de supervisor.');
  }

  await ref.update({
    status: 'REJECTED',
    rejectedBy: 'SUPERVISOR',
    updatedAt: FieldValue.serverTimestamp(),
  });

  await notifySwapParties(
    db,
    req,
    'Permuta rechazada',
    'Un supervisor rechazó la permuta. Los turnos no se modificaron.',
  );

  return { success: true, status: 'REJECTED' };
});
