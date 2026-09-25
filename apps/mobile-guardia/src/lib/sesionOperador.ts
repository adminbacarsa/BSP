import { httpsCallable } from 'firebase/functions';
import type {
  SesionOperadorAction,
  SesionOperadorRequest,
  SesionOperadorResponse,
} from '@cosp/ops-core';
import { getPortalFirebase } from './portal';

/**
 * Callable Plataforma `sesionOperador`.
 * La app NUNCA escribe `sesiones_operador` directo — solo lectura onSnapshot.
 */
export async function callSesionOperador(
  action: SesionOperadorAction,
  empresaId: string,
): Promise<SesionOperadorResponse> {
  const { functions } = getPortalFirebase();
  const payload: SesionOperadorRequest = {
    action,
    empresaId,
    writeOrigin: 'MOBILE',
  };
  const callable = httpsCallable<SesionOperadorRequest, SesionOperadorResponse>(
    functions,
    'sesionOperador',
  );
  const { data } = await callable(payload);
  if (!data || typeof data !== 'object' || data.success !== true) {
    throw new Error('La sala no respondió correctamente.');
  }
  return data;
}

export type { SesionOperadorAction };
