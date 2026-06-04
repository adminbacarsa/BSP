import { httpsCallable } from 'firebase/functions';
import { functions } from '@/lib/firebase';

export type AfipClientLookupResult = {
  taxId: string;
  legalName: string;
  name: string;
  address: string;
  city: string;
  state: string;
  ivaStatus: string;
  estadoClave?: string;
  tipoPersona?: string;
};

export async function lookupClientByCuitFromAfip(cuit: string): Promise<AfipClientLookupResult> {
  const fn = httpsCallable<{ cuit: string }, AfipClientLookupResult & { ok: boolean }>(
    functions,
    'lookupClientByCuit',
  );
  const res = await fn({ cuit });
  const data = res.data;
  if (!data?.ok) throw new Error('Consulta AFIP sin respuesta');
  return data;
}
