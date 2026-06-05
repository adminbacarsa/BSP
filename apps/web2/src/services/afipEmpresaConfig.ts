import { httpsCallable } from 'firebase/functions';
import { auth, functions } from '@/lib/firebase';

export type EmpresaAfipStatus = {
  ok: boolean;
  configured: boolean;
  certCuit?: string;
  production?: boolean;
  certNotAfter?: string;
};

export async function fetchEmpresaAfipConfig(empresaId: string): Promise<EmpresaAfipStatus> {
  const fn = httpsCallable<{ empresaId: string }, EmpresaAfipStatus>(functions, 'getEmpresaAfipConfig');
  const res = await fn({ empresaId });
  return res.data;
}

export async function saveEmpresaAfipConfig(input: {
  empresaId: string;
  certCuit: string;
  cert: string;
  privateKey: string;
  production: boolean;
}): Promise<{ ok: boolean; certNotAfter?: string }> {
  if (!auth.currentUser) throw new Error('Sesión expirada');
  await auth.currentUser.getIdToken(true);
  const fn = httpsCallable<
    typeof input,
    { ok: boolean; certNotAfter?: string }
  >(functions, 'saveEmpresaAfipCredentials');
  const res = await fn(input);
  return res.data;
}
