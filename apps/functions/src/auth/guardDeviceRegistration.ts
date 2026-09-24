import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import * as functions from 'firebase-functions/v1';

type DeviceInfo = Record<string, string>;

async function resolveEmployeeIdForUid(
  db: admin.firestore.Firestore,
  uid: string,
  email?: string | null,
): Promise<{ employeeId: string; empresaId: string | null } | null> {
  const byUid = await db.collection('empleados').where('uid', '==', uid).limit(1).get();
  if (!byUid.empty) {
    const d = byUid.docs[0];
    return {
      employeeId: d.id,
      empresaId: (d.data()?.empresaId as string) || null,
    };
  }
  // Mismo respaldo que la app y el portal viejo: legajo con el email del usuario pero sin uid
  // (nunca activó el acceso por mail). Solo si hay un único legajo con ese email y sin otro uid.
  const mail = String(email || '').trim();
  if (!mail) return null;
  const byEmail = await db.collection('empleados').where('email', '==', mail).limit(2).get();
  if (byEmail.size !== 1) return null;
  const d = byEmail.docs[0];
  const existingUid = String(d.data()?.uid || '').trim();
  if (existingUid && existingUid !== uid) return null;
  if (!existingUid) await d.ref.update({ uid, uidLinkedAt: FieldValue.serverTimestamp(), uidLinkedBy: 'DEVICE_REGISTRATION' });
  return {
    employeeId: d.id,
    empresaId: (d.data()?.empresaId as string) || null,
  };
}

async function notifySupervisorsDeviceRequest(
  db: admin.firestore.Firestore,
  params: {
    employeeId: string;
    empresaId: string | null;
    employeeName: string;
    platform: string;
  },
): Promise<number> {
  const empSnap = await db.collection('empleados').doc(params.employeeId).get();
  const objectiveIds: string[] = [];
  const pref = empSnap.data()?.preferredObjectiveId;
  if (typeof pref === 'string' && pref.trim()) objectiveIds.push(pref.trim());

  let notified = 0;
  const seen = new Set<string>();

  for (const oid of objectiveIds) {
    const supSnap = await db
      .collection('system_users')
      .where('objetivosAsignados', 'array-contains', oid)
      .limit(15)
      .get();
    for (const d of supSnap.docs) {
      const supUid = d.id;
      if (seen.has(supUid)) continue;
      seen.add(supUid);
      await db.collection('user_notifications').add({
        uid: supUid,
        employeeId: params.employeeId,
        title: 'Nuevo dispositivo — guardia',
        body: `${params.employeeName} solicita vincular un dispositivo (${params.platform}). Revisá RRHH / portal.`,
        type: 'DEVICE_REGISTRATION_REQUEST',
        target: 'supervisor',
        empresaId: params.empresaId,
        read: false,
        readAt: null,
        createdAt: FieldValue.serverTimestamp(),
      });
      notified += 1;
    }
  }

  return notified;
}

/** Guardia ya activado pide cambiar de dispositivo (web o app). Un dispositivo por legajo (doc device_tokens/{uid}). */
export const requestGuardDeviceRegistration = functions.https.onCall(async (data, context) => {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Debés iniciar sesión.');
  }
  const uid = context.auth.uid;
  const { deviceId, deviceInfo, platform } = data as {
    deviceId?: string;
    deviceInfo?: DeviceInfo;
    platform?: 'web' | 'ios' | 'android';
  };

  const trimmedDeviceId = String(deviceId ?? '').trim();
  if (trimmedDeviceId.length < 8) {
    throw new functions.https.HttpsError('invalid-argument', 'deviceId inválido.');
  }

  const db = admin.firestore();
  const legajo = await resolveEmployeeIdForUid(db, uid, context.auth.token.email);
  if (!legajo) {
    throw new functions.https.HttpsError('failed-precondition', 'No hay legajo vinculado a tu usuario.');
  }

  const empSnap = await db.collection('empleados').doc(legajo.employeeId).get();
  if (empSnap.data()?.bypassDeviceCheck === true) {
    await db.collection('device_tokens').doc(uid).set(
      {
        uid,
        employeeId: legajo.employeeId,
        verified: true,
        deviceId: trimmedDeviceId,
        deviceInfo: deviceInfo || {},
        platform: platform || 'web',
        source: 'bypass_device_check',
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    return { status: 'approved', bypass: true };
  }

  const bindingRef = db.collection('device_tokens').doc(uid);
  const binding = await bindingRef.get();
  if (!binding.exists || binding.data()?.verified !== true) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Activá tu cuenta con el mail de acceso antes de registrar un dispositivo nuevo.',
    );
  }

  const currentDeviceId = String(binding.data()?.deviceId ?? '').trim();
  if (currentDeviceId && currentDeviceId === trimmedDeviceId) {
    return { status: 'already_bound' };
  }

  const resolvedPlatform =
    platform === 'ios' || platform === 'android' || platform === 'web' ? platform : 'web';

  const reqRef = db.collection('device_registration_requests').doc(uid);
  await reqRef.set({
    uid,
    employeeId: legajo.employeeId,
    empresaId: legajo.empresaId,
    status: 'PENDING',
    requestedDeviceId: trimmedDeviceId,
    previousDeviceId: currentDeviceId || null,
    deviceInfo: deviceInfo || {},
    platform: resolvedPlatform,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  const name =
    [empSnap.data()?.firstName, empSnap.data()?.lastName].filter(Boolean).join(' ') ||
    String(empSnap.data()?.nombre || 'Guardia');

  const supervisorsNotified = await notifySupervisorsDeviceRequest(db, {
    employeeId: legajo.employeeId,
    empresaId: legajo.empresaId,
    employeeName: name,
    platform: resolvedPlatform,
  });

  return { status: 'pending', supervisorsNotified };
});

/** Admin / RRHH aprueba cambio de dispositivo (misma regla que activación por mail). */
export const approveGuardDeviceRegistration = functions.https.onCall(async (data, context) => {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Debés iniciar sesión.');
  }

  const callerUid = context.auth.uid;
  const db = admin.firestore();
  await assertAdminCaller(db, context);

  const { targetUid: targetUidArg, employeeId: employeeIdArg } = data as {
    targetUid?: string;
    employeeId?: string;
  };
  let targetUid = String(targetUidArg ?? '').trim();
  let employeeId = String(employeeIdArg ?? '').trim();

  if (!targetUid && employeeId) {
    const emp = await db.collection('empleados').doc(employeeId).get();
    targetUid = String(emp.data()?.uid ?? '').trim();
  }
  if (!targetUid) {
    throw new functions.https.HttpsError('invalid-argument', 'targetUid o employeeId requerido.');
  }

  const reqRef = db.collection('device_registration_requests').doc(targetUid);
  const reqSnap = await reqRef.get();
  if (!reqSnap.exists || reqSnap.data()?.status !== 'PENDING') {
    throw new functions.https.HttpsError('not-found', 'No hay solicitud pendiente para este usuario.');
  }

  const req = reqSnap.data()!;
  employeeId = employeeId || String(req.employeeId || '').trim();
  const requestedDeviceId = String(req.requestedDeviceId || '').trim();
  if (!requestedDeviceId) {
    throw new functions.https.HttpsError('failed-precondition', 'Solicitud sin deviceId.');
  }

  await db.collection('device_tokens').doc(targetUid).set(
    {
      uid: targetUid,
      employeeId: employeeId || null,
      verified: true,
      deviceId: requestedDeviceId,
      deviceInfo: req.deviceInfo || {},
      platform: req.platform || 'web',
      source: 'supervisor_approval',
      approvedBy: callerUid,
      approvedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );

  await reqRef.update({
    status: 'APPROVED',
    approvedBy: callerUid,
    approvedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return { success: true, targetUid, employeeId, deviceId: requestedDeviceId };
});

async function assertAdminCaller(
  db: admin.firestore.Firestore,
  context: functions.https.CallableContext,
): Promise<void> {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Debés iniciar sesión.');
  }
  const callerSnap = await db.collection('system_users').doc(context.auth.uid).get();
  const callerRole = String(callerSnap.data()?.role ?? context.auth.token?.role ?? '').toLowerCase();
  const isSuperAdmin = callerRole === 'superadmin';
  const isAdmin =
    isSuperAdmin ||
    ['admin', 'manager', 'hrmanager', 'supervisor', 'operator'].includes(callerRole.replace(/_/g, ''));
  if (!isAdmin) {
    throw new functions.https.HttpsError('permission-denied', 'Solo personal autorizado.');
  }
}

/** Lista solicitudes PENDING (Admin SDK — no requiere reglas Firestore en cliente). */
export const listPendingGuardDeviceRegistrations = functions.https.onCall(async (data, context) => {
  const db = admin.firestore();
  await assertAdminCaller(db, context);

  const { empresaId, limit: limitArg } = data as { empresaId?: string; limit?: number };
  const max = Math.min(Math.max(Number(limitArg) || 40, 1), 100);
  const snap = await db.collection('device_registration_requests').where('status', '==', 'PENDING').limit(max).get();

  const rows: Array<Record<string, unknown>> = [];
  for (const d of snap.docs) {
    const row = d.data();
    const eid = String(row.empresaId ?? '').trim();
    if (empresaId && eid && eid !== empresaId) continue;

    const empId = String(row.employeeId ?? '').trim();
    let employeeName = '';
    let fileNumber = '';
    if (empId) {
      const emp = await db.collection('empleados').doc(empId).get();
      if (emp.exists) {
        const ed = emp.data()!;
        employeeName = [ed.lastName, ed.firstName].filter(Boolean).join(', ') || String(ed.nombre ?? '');
        fileNumber = String(ed.fileNumber ?? ed.legajo ?? '');
      }
    }

    rows.push({
      uid: d.id,
      employeeId: empId || null,
      employeeName,
      fileNumber,
      empresaId: eid || null,
      platform: row.platform ?? null,
      requestedDeviceId: row.requestedDeviceId ?? null,
      previousDeviceId: row.previousDeviceId ?? null,
      deviceInfo: row.deviceInfo ?? {},
      createdAt: row.createdAt ?? null,
    });
  }

  rows.sort((a, b) => {
    const as = (a.createdAt as { seconds?: number })?.seconds ?? 0;
    const bs = (b.createdAt as { seconds?: number })?.seconds ?? 0;
    return bs - as;
  });

  return { requests: rows };
});

/** Estado de la solicitud del guardia autenticado (sin lectura directa Firestore). */
export const getGuardDeviceRegistrationStatus = functions.https.onCall(async (_data, context) => {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Debés iniciar sesión.');
  }
  const uid = context.auth.uid;
  const db = admin.firestore();
  const reqSnap = await db.collection('device_registration_requests').doc(uid).get();
  if (!reqSnap.exists) {
    const bind = await db.collection('device_tokens').doc(uid).get();
    return {
      status: bind.exists && bind.data()?.verified ? 'bound' : 'none',
      deviceId: bind.data()?.deviceId ?? null,
    };
  }
  const d = reqSnap.data()!;
  return {
    status: d.status === 'PENDING' ? 'pending' : String(d.status || 'unknown').toLowerCase(),
    requestedDeviceId: d.requestedDeviceId ?? null,
    platform: d.platform ?? null,
  };
});
