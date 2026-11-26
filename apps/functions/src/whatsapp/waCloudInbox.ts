import type { Firestore } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import type { WaCloudNormalizedMessage } from './waCloudTypes';

export const WA_CLOUD_INBOX = 'wa_cloud_inbox';
export const WA_CLOUD_PHONE_INDEX = 'wa_cloud_phone_index';

export async function encolarMensajeWaCloud(
  db: Firestore,
  msg: WaCloudNormalizedMessage,
): Promise<{ written: boolean; id: string }> {
  const empresaId = String(msg.empresaId || '').trim();
  const id = String(msg.id || '').trim();
  if (!empresaId || !id) return { written: false, id };
  const ref = db.collection(WA_CLOUD_INBOX).doc(empresaId).collection('messages').doc(id);
  const prev = await ref.get();
  if (prev.exists) return { written: false, id };
  await ref.set({
    ...msg,
    createdAt: FieldValue.serverTimestamp(),
  });
  return { written: true, id };
}

export async function resolverEmpresaPorPhoneNumberId(
  db: Firestore,
  phoneNumberId: string,
): Promise<string | null> {
  const pid = String(phoneNumberId || '').trim();
  if (!pid) return null;
  const idx = await db.collection(WA_CLOUD_PHONE_INDEX).doc(pid).get();
  if (idx.exists) {
    const eid = String(idx.data()?.empresaId || '').trim();
    if (eid) return eid;
  }
  // Fallback: scan configs (pocas empresas). Útil antes de que se guarde el índice.
  const empresas = await db.collection('empresas').limit(80).get();
  for (const emp of empresas.docs) {
    const cfg = await emp.ref.collection('config').doc('whatsapp').get();
    const cloud = cfg.data()?.cloud as { phoneNumberId?: string } | undefined;
    if (String(cloud?.phoneNumberId || '').trim() === pid) {
      await db.collection(WA_CLOUD_PHONE_INDEX).doc(pid).set(
        { empresaId: emp.id, updatedAt: FieldValue.serverTimestamp() },
        { merge: true },
      );
      return emp.id;
    }
  }
  return null;
}

export async function upsertPhoneIndex(
  db: Firestore,
  phoneNumberId: string,
  empresaId: string,
): Promise<void> {
  const pid = String(phoneNumberId || '').trim();
  const eid = String(empresaId || '').trim();
  if (!pid || !eid) return;
  await db.collection(WA_CLOUD_PHONE_INDEX).doc(pid).set(
    { empresaId: eid, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
}
