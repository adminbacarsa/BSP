import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import * as functions from 'firebase-functions/v1';

export type BindGuardDeviceSource = 'email_link' | 'approval';

export type GuardDeviceBindErrorCode =
  | 'DEVICE_OWNED_BY_OTHER'
  | 'RETIRED_DEVICE_NEEDS_EMAIL'
  | 'DEVICE_ID_REQUIRED';

export class GuardDeviceBindError extends Error {
  readonly code: GuardDeviceBindErrorCode;

  constructor(code: GuardDeviceBindErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export function guardDeviceBindErrorToHttps(err: GuardDeviceBindError): functions.https.HttpsError {
  return new functions.https.HttpsError('failed-precondition', err.message, { code: err.code });
}

export function rethrowBindGuardDeviceError(err: unknown): never {
  if (err instanceof GuardDeviceBindError) {
    throw guardDeviceBindErrorToHttps(err);
  }
  throw err;
}

const DEVICE_OWNED_MSG =
  'Este dispositivo está vinculado a otro colaborador. Pedile a RRHH que lo desvincule.';
const RETIRED_MSG = 'Para volver a este dispositivo usá el mail de acceso.';

function normalizeRetiredIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => String(x).trim()).filter((x) => x.length >= 8);
}

function assertDeviceId(deviceId: string): string {
  const trimmed = String(deviceId ?? '').trim();
  if (trimmed.length < 8) {
    throw new GuardDeviceBindError('DEVICE_ID_REQUIRED', 'deviceId inválido.');
  }
  return trimmed;
}

/** Validación previa a pedido RRHH (mismas reglas que aprobación para retirados). */
export async function assertCanRequestGuardDeviceRegistration(
  db: admin.firestore.Firestore,
  uid: string,
  deviceId: string,
): Promise<void> {
  const did = assertDeviceId(deviceId);
  await assertDeviceNotOwnedByOther(db, uid, did);
  await assertNotRetiredForApproval(db, uid, did);
}

async function assertDeviceNotOwnedByOther(
  db: admin.firestore.Firestore,
  uid: string,
  deviceId: string,
): Promise<void> {
  const bindSnap = await db.collection('device_bindings').doc(deviceId).get();
  if (!bindSnap.exists) return;
  const ownerUid = String(bindSnap.data()?.uid ?? '').trim();
  if (ownerUid && ownerUid !== uid) {
    throw new GuardDeviceBindError('DEVICE_OWNED_BY_OTHER', DEVICE_OWNED_MSG);
  }
}

async function assertNotRetiredForApproval(
  db: admin.firestore.Firestore,
  uid: string,
  deviceId: string,
): Promise<void> {
  const tokenSnap = await db.collection('device_tokens').doc(uid).get();
  const retired = normalizeRetiredIds(tokenSnap.data()?.retiredDeviceIds);
  if (retired.includes(deviceId)) {
    throw new GuardDeviceBindError('RETIRED_DEVICE_NEEDS_EMAIL', RETIRED_MSG);
  }
}

export interface BindGuardDeviceParams {
  uid: string;
  employeeId: string;
  empresaId?: string | null;
  deviceId: string;
  source: BindGuardDeviceSource;
  deviceInfo?: Record<string, string>;
  platform?: string;
  /** Campos extra en device_tokens (approvedBy, activatedAt, etc.) */
  tokenExtras?: Record<string, unknown>;
}

/**
 * Único escritor de device_tokens/{uid} verificado + device_bindings/{deviceId}.
 */
export async function bindGuardDevice(
  db: admin.firestore.Firestore,
  params: BindGuardDeviceParams,
): Promise<void> {
  const deviceId = assertDeviceId(params.deviceId);
  const uid = String(params.uid).trim();
  const employeeId = String(params.employeeId).trim();
  if (!uid || !employeeId) {
    throw new GuardDeviceBindError('DEVICE_ID_REQUIRED', 'uid y employeeId requeridos.');
  }

  if (params.source === 'approval') {
    await assertNotRetiredForApproval(db, uid, deviceId);
  }

  const tokenRef = db.collection('device_tokens').doc(uid);
  const bindingRef = db.collection('device_bindings').doc(deviceId);

  await db.runTransaction(async (tx) => {
      const bindSnap = await tx.get(bindingRef);
      if (bindSnap.exists) {
        const ownerUid = String(bindSnap.data()?.uid ?? '').trim();
        if (ownerUid && ownerUid !== uid) {
          throw new GuardDeviceBindError('DEVICE_OWNED_BY_OTHER', DEVICE_OWNED_MSG);
        }
      }

      const userSnap = await tx.get(tokenRef);
      const userData = userSnap.data() || {};
      let retired = normalizeRetiredIds(userData.retiredDeviceIds);

      if (params.source === 'approval' && retired.includes(deviceId)) {
        throw new GuardDeviceBindError('RETIRED_DEVICE_NEEDS_EMAIL', RETIRED_MSG);
      }

      retired = retired.filter((id) => id !== deviceId);

      const currentDeviceId = String(userData.deviceId ?? '').trim();
      if (currentDeviceId && currentDeviceId !== deviceId) {
        const prevBindRef = db.collection('device_bindings').doc(currentDeviceId);
        const prevBindSnap = await tx.get(prevBindRef);
        if (prevBindSnap.exists && String(prevBindSnap.data()?.uid ?? '').trim() === uid) {
          tx.delete(prevBindRef);
        }
        if (!retired.includes(currentDeviceId)) {
          retired = [...retired, currentDeviceId];
        }
      }

      const tokenSource =
        params.source === 'email_link'
          ? 'email_link'
          : 'supervisor_approval';

      tx.set(
        bindingRef,
        {
          uid,
          employeeId,
          empresaId: params.empresaId ?? null,
          boundAt: FieldValue.serverTimestamp(),
          source: params.source,
        },
        { merge: true },
      );

      tx.set(
        tokenRef,
        {
          uid,
          employeeId,
          verified: true,
          deviceId,
          retiredDeviceIds: retired,
          source: tokenSource,
          deviceInfo: params.deviceInfo || {},
          platform: params.platform || 'web',
          updatedAt: FieldValue.serverTimestamp(),
          ...(params.tokenExtras || {}),
        },
        { merge: true },
      );
    });
}

/** RRHH/CC: libera dispositivo vigente del guardia (sin borrar legajo ni Auth). */
export async function unbindGuardDeviceForUid(
  db: admin.firestore.Firestore,
  targetUid: string,
  unboundBy?: string,
): Promise<{ hadDeviceId: string | null }> {
  const uid = String(targetUid).trim();
  if (!uid) {
    throw new functions.https.HttpsError('invalid-argument', 'targetUid requerido.');
  }

  let released: string | null = null;

  await db.runTransaction(async (tx) => {
    const tokenRef = db.collection('device_tokens').doc(uid);
    const tokenSnap = await tx.get(tokenRef);
    const deviceId = String(tokenSnap.data()?.deviceId ?? '').trim();
    released = deviceId || null;

    if (deviceId) {
      const bindRef = db.collection('device_bindings').doc(deviceId);
      const bindSnap = await tx.get(bindRef);
      if (bindSnap.exists && String(bindSnap.data()?.uid ?? '').trim() === uid) {
        tx.delete(bindRef);
      }
    }

    tx.set(
      tokenRef,
      {
        deviceId: FieldValue.delete(),
        verified: false,
        unboundAt: FieldValue.serverTimestamp(),
        unboundBy: unboundBy || 'admin',
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  });

  return { hadDeviceId: released };
}
