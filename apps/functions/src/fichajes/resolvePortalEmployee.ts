import type { auth } from 'firebase-admin';

type AuthContext = Pick<auth.DecodedIdToken, 'uid' | 'email'>;

function emailCandidates(token: AuthContext): string[] {
  const raw = token.email?.trim();
  if (!raw) return [];
  const lower = raw.toLowerCase();
  return raw === lower ? [raw] : [raw, lower];
}

/**
 * Misma estrategia que packages/portal-core resolveEmpDocId (doc id, uid, email).
 * Evita "Empleado no encontrado" cuando el legajo está vinculado por email pero el uid en Firestore quedó desfasado tras seed/recrear Auth.
 */
export async function resolvePortalEmployeeDocId(
  db: FirebaseFirestore.Firestore,
  token: AuthContext,
): Promise<string | null> {
  const uid = token.uid;

  const direct = await db.collection('empleados').doc(uid).get();
  if (direct.exists) return direct.id;

  const byUid = await db.collection('empleados').where('uid', '==', uid).limit(5).get();
  if (!byUid.empty) {
    const email = token.email?.trim().toLowerCase();
    if (email) {
      const match = byUid.docs.find((d) => {
        const e = String(d.data().email ?? d.data().correo ?? '')
          .trim()
          .toLowerCase();
        return e === email;
      });
      if (match) return match.id;
    }
    return byUid.docs[0].id;
  }

  for (const email of emailCandidates(token)) {
    const byEmail = await db.collection('empleados').where('email', '==', email).limit(1).get();
    if (!byEmail.empty) return byEmail.docs[0].id;
  }

  return null;
}
