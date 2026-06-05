import * as functions from 'firebase-functions/v1';
import { resolveBackupCaller } from '../backup/backup-auth.util';
import { lookupTaxpayerByCuit } from './lookupTaxpayer';

export async function lookupClientByCuitHandler(
  data: { cuit?: string; empresaId?: string },
  context: functions.https.CallableContext,
) {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Autenticación requerida.');
  }
  const caller = await resolveBackupCaller(context.auth.uid, context.auth.token?.role);
  if (!caller.isPanelUser) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Solo usuarios del panel de administración pueden consultar AFIP.',
    );
  }

  try {
    const empresaId = String(data?.empresaId ?? '').trim();
    const result = await lookupTaxpayerByCuit(data?.cuit, empresaId);
    return { ok: true, ...result };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/no encontrado|no existe persona|no está en el padrón|no figura en el padrón/i.test(msg)) {
      throw new functions.https.HttpsError('not-found', msg);
    }
    if (/inválido|invalido/i.test(msg)) {
      throw new functions.https.HttpsError('invalid-argument', msg);
    }
    if (/no configurado|certificado afip|AFIP rechazó|AFIP denegó|aún no vigente|vencido/i.test(msg)) {
      throw new functions.https.HttpsError('failed-precondition', msg);
    }
    console.error('[lookupClientByCuit]', e);
    throw new functions.https.HttpsError('failed-precondition', msg.slice(0, 400) || 'Error al consultar AFIP.');
  }
}
