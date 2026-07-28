import { collection, getDocs, query, where, type Firestore } from 'firebase/firestore';
import type { User } from 'firebase/auth';

export async function resolveEmpDocId(db: Firestore, user: User): Promise<string | null> {
  const byUid = await getDocs(query(collection(db, 'empleados'), where('uid', '==', user.uid)));
  if (!byUid.empty) {
    const emailMatch = user.email
      ? byUid.docs.find((d) => (d.data().email || '').toLowerCase() === user.email!.toLowerCase())
      : null;
    return (emailMatch || byUid.docs[0]).id;
  }

  if (user.email?.trim()) {
    const byEmail = await getDocs(query(collection(db, 'empleados'), where('email', '==', user.email.trim())));
    if (!byEmail.empty) return byEmail.docs[0].id;
  }

  return null;
}
