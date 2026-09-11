import { db } from '@/lib/firebase';
import { collection, getDocs, query, where } from 'firebase/firestore';

export async function verifySupervisorPin(pin: string): Promise<{ ok: boolean; name: string }> {
  if (!/^\d{4}$/.test(String(pin || '').trim())) return { ok: false, name: '' };
  const snap = await getDocs(query(collection(db, 'system_users'), where('supervisorPin', '==', pin.trim())));
  if (snap.empty) return { ok: false, name: '' };
  const data = snap.docs[0].data();
  const name = String(data.displayName || data.name || data.email || 'Supervisor').trim();
  return { ok: true, name };
}
