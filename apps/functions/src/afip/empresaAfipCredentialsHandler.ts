import * as functions from 'firebase-functions/v1';
import { resolveBackupCaller, isAdminBackupRole } from '../backup/backup-auth.util';
import {
  getEmpresaAfipStatus,
  saveEmpresaAfipCredentials,
} from './empresaAfipStore';

function assertCanManageAfipCredentials(
  caller: Awaited<ReturnType<typeof resolveBackupCaller>>,
  tokenRole: unknown,
): void {
  if (!caller.isPanelUser) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Solo usuarios del panel pueden administrar certificados AFIP.',
    );
  }
  const role = caller.sysRole || tokenRole;
  if (!caller.isSuper && !isAdminBackupRole(role)) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Solo administradores pueden cargar certificados AFIP.',
    );
  }
}

export async function saveEmpresaAfipCredentialsHandler(
  data: {
    empresaId?: string;
    certCuit?: string;
    cert?: string;
    privateKey?: string;
    production?: boolean;
  },
  context: functions.https.CallableContext,
) {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Autenticación requerida.');
  }
  const caller = await resolveBackupCaller(context.auth.uid, context.auth.token?.role);
  assertCanManageAfipCredentials(caller, context.auth.token?.role);

  try {
    const result = await saveEmpresaAfipCredentials({
      empresaId: data?.empresaId ?? '',
      certCuit: data?.certCuit ?? '',
      cert: data?.cert ?? '',
      privateKey: data?.privateKey ?? '',
      production: !!data?.production,
    });
    return { ok: true, ...result };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new functions.https.HttpsError('invalid-argument', msg.slice(0, 400));
  }
}

export async function getEmpresaAfipConfigHandler(
  data: { empresaId?: string },
  context: functions.https.CallableContext,
) {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Autenticación requerida.');
  }
  const caller = await resolveBackupCaller(context.auth.uid, context.auth.token?.role);
  if (!caller.isPanelUser) {
    throw new functions.https.HttpsError('permission-denied', 'Acceso denegado.');
  }

  const status = await getEmpresaAfipStatus(String(data?.empresaId ?? '').trim());
  return { ok: true, ...status };
}
