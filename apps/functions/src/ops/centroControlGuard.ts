/**
 * Kill switch del Centro de Control (Operaciones).
 * Campo en empresas/{id}: centroControlEnabled !== false → activo (default ON).
 * modoDemoEnabled: true → generador Demo activo (eventos sintéticos).
 */
export function isCentroControlEnabled(data: FirebaseFirestore.DocumentData | undefined): boolean {
  if (!data) return true;
  return data.centroControlEnabled !== false;
}

export async function loadCentroControlState(db: FirebaseFirestore.Firestore): Promise<{
  anyEnabled: boolean;
  isEnabled: (empresaId: string | null | undefined) => boolean;
  /** Empresa con modoDemoEnabled — el generador Demo inventa eventos; no correr detección real de ausencias. */
  isDemo: (empresaId: string | null | undefined) => boolean;
}> {
  const snap = await db.collection('empresas').get();
  const disabled = new Set<string>();
  const demo = new Set<string>();
  snap.docs.forEach((d) => {
    const data = d.data();
    if (!isCentroControlEnabled(data)) disabled.add(d.id);
    if (data?.modoDemoEnabled === true) demo.add(d.id);
  });
  const anyEnabled = snap.empty || snap.docs.some((d) => isCentroControlEnabled(d.data()));
  return {
    anyEnabled,
    isEnabled: (empresaId) => {
      const id = String(empresaId || '').trim() || 'bacarsa';
      return !disabled.has(id);
    },
    isDemo: (empresaId) => {
      const id = String(empresaId || '').trim();
      return !!id && demo.has(id);
    },
  };
}
