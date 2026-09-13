import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions/v1';
import { resolveBackupCaller } from '../backup/backup-auth.util';

export function docEmpresaId(data: FirebaseFirestore.DocumentData): string {
  return String(data?.empresaId ?? '').trim();
}

async function bacarsaLegacyOpen(db: admin.firestore.Firestore): Promise<boolean> {
  const snap = await db.collection('empresas').doc('bacarsa').get();
  return snap.exists && snap.data()?.migracionCompleta !== true;
}

function bacarsaTenantDocMatches(userEmpresaId: string, data: FirebaseFirestore.DocumentData): boolean {
  if (userEmpresaId !== 'bacarsa') return false;
  const docEmp = docEmpresaId(data);
  return docEmp === '' || docEmp === 'bacarsa';
}

async function tenantMatchesDoc(
  db: admin.firestore.Firestore,
  caller: Awaited<ReturnType<typeof resolveBackupCaller>>,
  uid: string,
  data: FirebaseFirestore.DocumentData,
  tokenEmpresaId?: string,
): Promise<boolean> {
  if (caller.isSuper) return true;

  const sysSnap = await db.collection('system_users').doc(uid).get();
  if (sysSnap.exists && sysSnap.data()?.allEmpresas === true) return true;

  const userEmpresaId = caller.profileEmpresa || String(tokenEmpresaId || '').trim();
  if (!userEmpresaId) return false;

  const docEmp = docEmpresaId(data);
  if (docEmp === userEmpresaId) return true;
  if (bacarsaTenantDocMatches(userEmpresaId, data)) return true;

  if (userEmpresaId === 'bacarsa' && docEmp === '' && (await bacarsaLegacyOpen(db))) {
    return true;
  }

  return false;
}

export async function assertPanelTenantCallable(
  context: functions.https.CallableContext,
  empresaId: string,
  resourceData?: FirebaseFirestore.DocumentData,
  deniedMessage = 'Solo usuarios del panel pueden ejecutar esta operación.',
): Promise<void> {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Login requerido.');
  }

  const caller = await resolveBackupCaller(context.auth.uid, context.auth.token?.role);
  if (!caller.isPanelUser) {
    throw new functions.https.HttpsError('permission-denied', deniedMessage);
  }

  const reqEmpresa = String(empresaId || '').trim();
  if (!reqEmpresa) {
    throw new functions.https.HttpsError('invalid-argument', 'empresaId requerido.');
  }

  const db = admin.firestore();
  const tokenEmpresaId = String(context.auth.token?.empresaId || '').trim();

  const canAccessReq = await tenantMatchesDoc(
    db,
    caller,
    context.auth.uid,
    { empresaId: reqEmpresa },
    tokenEmpresaId,
  );
  if (!canAccessReq) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Empresa no autorizada para este operador.',
    );
  }

  if (!resourceData) return;

  const resourceOk = await tenantMatchesDoc(
    db,
    caller,
    context.auth.uid,
    resourceData,
    tokenEmpresaId,
  );
  if (!resourceOk) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'No tenés acceso al recurso solicitado.',
    );
  }

  const resourceEmp = docEmpresaId(resourceData);
  if (resourceEmp && resourceEmp !== reqEmpresa) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'empresaId no coincide con el recurso.',
    );
  }
}

export async function loadDocAndAssertEmpresa(
  collection: string,
  docId: string,
  empresaId: string,
): Promise<FirebaseFirestore.DocumentData> {
  const db = admin.firestore();
  const snap = await db.collection(collection).doc(docId).get();
  if (!snap.exists) {
    throw new Error(`${collection}/${docId} no encontrado.`);
  }

  const data = snap.data()!;
  const reqEmp = String(empresaId || '').trim();
  const docEmp = docEmpresaId(data);

  if (docEmp && docEmp !== reqEmp) {
    throw new Error('El recurso no pertenece a la empresa indicada.');
  }

  if (!docEmp) {
    const legacyOpen = await bacarsaLegacyOpen(db);
    if (!(reqEmp === 'bacarsa' && legacyOpen)) {
      throw new Error('El recurso no tiene empresa asignada.');
    }
  }

  return data;
}
