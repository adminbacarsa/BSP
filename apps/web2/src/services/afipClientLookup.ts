import { httpsCallable } from 'firebase/functions';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, functions } from '@/lib/firebase';

export type AfipClientLookupResult = {
  taxId: string;
  legalName: string;
  name: string;
  address: string;
  city: string;
  state: string;
  postalCode?: string;
  ivaStatus: string;
  estadoClave?: string;
  tipoPersona?: string;
  actividadPrincipal?: string;
  mesCierre?: string;
  afipImpuestos?: string;
  afipWarning?: string;
};

function waitForSignedInUser(timeoutMs = 8000): Promise<typeof auth.currentUser> {
  if (auth.currentUser) return Promise.resolve(auth.currentUser);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsub();
      reject(new Error('Sesión no disponible. Volvé a iniciar sesión.'));
    }, timeoutMs);
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) return;
      clearTimeout(timer);
      unsub();
      resolve(u);
    });
  });
}

export async function lookupClientByCuitFromAfip(
  cuit: string,
  empresaId?: string,
): Promise<AfipClientLookupResult> {
  const user = await waitForSignedInUser();
  await user.getIdToken(true);

  const fn = httpsCallable<
    { cuit: string; empresaId?: string },
    AfipClientLookupResult & { ok: boolean }
  >(functions, 'lookupClientByCuit', { timeout: 90_000 });
  const digits = String(cuit ?? '').replace(/\D/g, '');
  const res = await fn({
    cuit: digits,
    ...(empresaId?.trim() ? { empresaId: empresaId.trim() } : {}),
  });
  const data = res.data;
  if (!data?.ok) throw new Error('Consulta AFIP sin respuesta');
  return data;
}
