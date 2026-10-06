import { httpsCallable } from 'firebase/functions';
import { getPortalFirebase } from './portal';

export async function responderConsultaDisponibilidad(invitacionId: string, respuesta: 'SI' | 'NO') {
  const call = httpsCallable<{ invitacionId: string; respuesta: 'SI' | 'NO' }, { ok: boolean; codigo?: string; motivo?: string }>(
    getPortalFirebase().functions,
    'responderConsultaDisponibilidad',
  );
  const res = await call({ invitacionId, respuesta });
  return res.data;
}
