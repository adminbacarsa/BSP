/**
 * La app llama `acusarReciboContrato({ contratoId })`.
 * El eventual solo acusa el contrato de su CUIL. SuperAdmin (preview) puede cualquiera.
 */
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import * as functions from 'firebase-functions/v1';

const SUPER = ['superadmin', 'super_admin', 'sp'];

function db() {
  return admin.firestore();
}

function esSuperAdmin(token: Record<string, unknown> | undefined): boolean {
  const role = String(token?.role || '').toLowerCase();
  const type = String(token?.type || '').toLowerCase();
  return SUPER.includes(role) || SUPER.includes(type);
}

function clientIp(raw: { headers?: Record<string, unknown>; ip?: string } | undefined): string {
  const fwd = String(raw?.headers?.['x-forwarded-for'] || '');
  const first = fwd.split(',')[0].trim();
  return first || String(raw?.ip || '').trim() || 'desconocida';
}

function dispositivoDe(
  data: { dispositivo?: unknown; deviceId?: unknown },
  raw: { headers?: Record<string, unknown> } | undefined,
): string {
  const explicit = String(data?.dispositivo || data?.deviceId || '').trim();
  if (explicit) return explicit.slice(0, 300);
  return String(raw?.headers?.['user-agent'] || '').trim().slice(0, 300);
}

function hashPdf(contrato: Record<string, unknown>): string | null {
  const doc = (contrato.documento || null) as { sha256?: unknown; hash?: unknown } | null;
  const hash = String(doc?.sha256 || doc?.hash || '').trim();
  return hash || null;
}

async function esDelEventual(
  uid: string,
  token: Record<string, unknown>,
  contrato: Record<string, unknown>,
): Promise<boolean> {
  const cuil = String(contrato.bolsaCuil || '').trim();
  if (cuil && String(token.bolsaCuil || '') === cuil) return true;
  if (cuil) {
    const bolsa = await db().collection('eventuales_bolsa').doc(cuil).get();
    if (bolsa.exists && String(bolsa.data()?.uid || '') === uid) return true;
  }
  const employeeId = String(contrato.employeeId || '').trim();
  if (employeeId) {
    const emp = await db().collection('empleados').doc(employeeId).get();
    if (emp.exists && String(emp.data()?.uid || '') === uid) return true;
  }
  return false;
}

export async function acusarReciboContratoHandler(
  data: { contratoId?: unknown; dispositivo?: unknown; deviceId?: unknown },
  context: functions.https.CallableContext,
): Promise<{ ok: true; already?: boolean; pdfHash: string | null }> {
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Tenés que iniciar sesión.');
  const contratoId = String(data?.contratoId || '').trim();
  if (!contratoId) throw new functions.https.HttpsError('invalid-argument', 'contratoId requerido.');

  const ref = db().collection('contratos_eventuales').doc(contratoId);
  const snap = await ref.get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Contrato inexistente.');
  const contrato = snap.data() as Record<string, unknown>;
  const token = (context.auth.token || {}) as Record<string, unknown>;
  if (!esSuperAdmin(token) && !(await esDelEventual(context.auth.uid, token, contrato))) {
    throw new functions.https.HttpsError('permission-denied', 'Este contrato no es tuyo.');
  }

  if (contrato.acuseReciboAt) return { ok: true, already: true, pdfHash: hashPdf(contrato) };

  const pdfHash = hashPdf(contrato);
  const ip = clientIp(context.rawRequest as { headers?: Record<string, unknown>; ip?: string });
  const dispositivo = dispositivoDe(data, context.rawRequest as { headers?: Record<string, unknown> });
  const estado = String(contrato.estado || '');
  const patch: Record<string, unknown> = {
    acuseReciboAt: FieldValue.serverTimestamp(),
    dispositivo,
    ip,
    acuse: {
      at: FieldValue.serverTimestamp(),
      uid: context.auth.uid,
      deviceId: dispositivo,
      metodo: 'SESION',
      docSha256: pdfHash,
      ip,
    },
  };
  if (pdfHash) patch.pdfHash = pdfHash;
  if (estado === 'BORRADOR' || estado === 'DOCUMENTADO' || !estado) patch.estado = 'ACUSE_RECIBIDO';

  await ref.set(patch, { merge: true });
  await db().collection('audit_logs').add({
    action: 'EVENTUAL_ACUSE_RECIBO',
    module: 'EVENTUALES',
    actorUid: context.auth.uid,
    actorName: String(token.name || token.email || context.auth.uid),
    empresaId: contrato.empresaId || null,
    bolsaCuil: contrato.bolsaCuil || null,
    contratoId,
    dispositivo,
    ip,
    pdfHash,
    details: `Acuse de recibo del contrato ${contratoId}`,
    timestamp: FieldValue.serverTimestamp(),
  });
  return { ok: true, pdfHash };
}

export const acusarReciboContrato = functions.https.onCall(acusarReciboContratoHandler);
