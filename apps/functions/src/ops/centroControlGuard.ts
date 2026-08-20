/**
 * Kill switch del Centro de Control (Operaciones).
 * Campo en empresas/{id}: centroControlEnabled !== false → activo (default ON).
 */
export function isCentroControlEnabled(data: FirebaseFirestore.DocumentData | undefined): boolean {
  if (!data) return true;
  return data.centroControlEnabled !== false;
}

export async function loadCentroControlState(db: FirebaseFirestore.Firestore): Promise<{
  anyEnabled: boolean;
  isEnabled: (empresaId: string | null | undefined) => boolean;
}> {
  const snap = await db.collection('empresas').get();
  const disabled = new Set<string>();
  snap.docs.forEach((d) => {
    if (!isCentroControlEnabled(d.data())) disabled.add(d.id);
  });
  const anyEnabled = snap.empty || snap.docs.some((d) => isCentroControlEnabled(d.data()));
  return {
    anyEnabled,
    isEnabled: (empresaId) => {
      const id = String(empresaId || '').trim() || 'bacarsa';
      return !disabled.has(id);
    },
  };
}
