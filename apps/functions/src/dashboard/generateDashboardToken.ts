import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import * as functions from 'firebase-functions/v1';
import { randomUUID } from 'crypto';
import { isSuperAdminRole, normalizeRoleId } from '../common/role.util';
import { resolvePanelUserForUid } from '../ops/staffPermissions';

function esAdminOSuper(role: unknown): boolean {
  const r = normalizeRoleId(role);
  return r === 'ADMIN' || isSuperAdminRole(r);
}

async function exigirAdminEmpresa(
  data: { empresaId?: string },
  context: functions.https.CallableContext,
): Promise<{ empresaId: string; db: admin.firestore.Firestore }> {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Autenticación requerida.');
  }
  const empresaId = String(data?.empresaId || '').trim();
  if (!empresaId) {
    throw new functions.https.HttpsError('invalid-argument', 'empresaId requerido');
  }
  const db = admin.firestore();
  const claimRole = context.auth.token?.role;
  const panel = await resolvePanelUserForUid(
    db,
    context.auth.uid,
    claimRole,
    String(context.auth.token?.email || context.auth.token?.name || ''),
  );
  const habilitado = esAdminOSuper(claimRole) || esAdminOSuper(panel?.roleName);
  if (!habilitado) {
    throw new functions.https.HttpsError('permission-denied', 'Solo admin o superadmin puede gestionar el token del dashboard.');
  }
  const superadmin = isSuperAdminRole(claimRole) || panel?.isSuperAdmin === true || panel?.allEmpresas === true;
  if (!superadmin) {
    const propia = String(panel?.empresaId || context.auth.token?.empresaId || '').trim();
    if (!propia || propia !== empresaId) {
      throw new functions.https.HttpsError('permission-denied', 'Empresa no permitida.');
    }
  }
  return { empresaId, db };
}

/** Genera o rota la API key del dashboard externo. Se devuelve una sola vez. */
export const generateDashboardToken = functions
  .region('us-central1')
  .runWith({ timeoutSeconds: 30, memory: '256MB' })
  .https.onCall(async (data, context) => {
    const payload = (data || {}) as { empresaId?: string; empresaName?: string };
    const { empresaId, db } = await exigirAdminEmpresa(payload, context);
    const empresaName = String(payload.empresaName || '').trim();
    const ref = db.collection('dashboard_tokens').doc(empresaId);
    const prev = await ref.get();
    const apiKey = randomUUID();
    const doc: Record<string, unknown> = {
      apiKey,
      enabled: true,
      updatedAt: FieldValue.serverTimestamp(),
      empresaName: empresaName || String(prev.data()?.empresaName || empresaId),
    };
    if (!prev.exists) doc.createdAt = FieldValue.serverTimestamp();
    await ref.set(doc, { merge: true });
    return { apiKey };
  });

export const revokeDashboardToken = functions
  .region('us-central1')
  .runWith({ timeoutSeconds: 30, memory: '256MB' })
  .https.onCall(async (data, context) => {
    const { empresaId, db } = await exigirAdminEmpresa((data || {}) as { empresaId?: string }, context);
    const ref = db.collection('dashboard_tokens').doc(empresaId);
    const prev = await ref.get();
    if (!prev.exists) {
      throw new functions.https.HttpsError('not-found', 'No hay token para esa empresa.');
    }
    await ref.set({
      enabled: false,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    return { ok: true };
  });
