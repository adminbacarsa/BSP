import * as functions from 'firebase-functions/v1';
import {
  isAdminBackupRole,
  resolveBackupCaller,
} from '../backup/backup-auth.util';
import { lookupTaxpayerByCuit } from './lookupTaxpayer';

export async function lookupClientByCuitHandler(
  data: { cuit?: string },
  context: functions.https.CallableContext,
) {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Autenticación requerida.');
  }
  const caller = await resolveBackupCaller(context.auth.uid, context.auth.token?.role);
  if (!caller.isPanelUser || !isAdminBackupRole(caller.sysRole || context.auth.token?.role)) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Solo administradores pueden consultar datos en AFIP.',
    );
  }

  try {
    const result = await lookupTaxpayerByCuit(data?.cuit);
    return { ok: true, ...result };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/no encontrado|no existe/i.test(msg)) {
      throw new functions.https.HttpsError('not-found', msg);
    }
    if (/inválido|invalido/i.test(msg)) {
      throw new functions.https.HttpsError('invalid-argument', msg);
    }
    if (/no configurado/i.test(msg)) {
      throw new functions.https.HttpsError('failed-precondition', msg);
    }
    console.error('[lookupClientByCuit]', e);
    throw new functions.https.HttpsError('internal', msg.slice(0, 400) || 'Error al consultar AFIP.');
  }
}
