import type { Firestore } from 'firebase-admin/firestore';

const CRED_COL = 'empresa_wa_cloud_credentials';

export async function leerTokenWaCloud(
  db: Firestore,
  empresaId: string,
): Promise<string | null> {
  const snap = await db.collection(CRED_COL).doc(empresaId).get();
  const t = String(snap.data()?.accessToken || '').trim();
  return t || null;
}

export { CRED_COL as WA_CLOUD_CRED_COL };
