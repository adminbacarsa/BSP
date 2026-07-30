import { collection, doc, getDoc, getDocs, query, where, type Firestore } from 'firebase/firestore';
import type { User } from 'firebase/auth';

function emailCandidates(user: User): string[] {
  const raw = user.email?.trim();
  if (!raw) return [];
  const lower = raw.toLowerCase();
  return raw === lower ? [raw] : [raw, lower];
}

export async function resolveEmpDocId(db: Firestore, user: User): Promise<string | null> {
  const direct = await getDoc(doc(db, 'empleados', user.uid));
  if (direct.exists()) {
    return direct.id;
  }

  const byUid = await getDocs(query(collection(db, 'empleados'), where('uid', '==', user.uid)));
  if (!byUid.empty) {
    const emailMatch = user.email
      ? byUid.docs.find((d) => (d.data().email || '').toLowerCase() === user.email!.toLowerCase())
      : null;
    return (emailMatch || byUid.docs[0]).id;
  }

  for (const email of emailCandidates(user)) {
    const byEmail = await getDocs(query(collection(db, 'empleados'), where('email', '==', email)));
    if (!byEmail.empty) return byEmail.docs[0].id;
  }

  return null;
}

export async function resolveEmpDocIdWithRetry(
  db: Firestore,
  user: User,
  maxAttempts = 3,
): Promise<string | null> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const id = await resolveEmpDocId(db, user);
      if (id) return id;
      if (attempt < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, 350 * (attempt + 1)));
      }
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  }
  if (lastError) throw lastError;
  return null;
}
