import { httpsCallable } from 'firebase/functions';
import { getPortalFirebase } from './portal';
import type { ConsultaPreviewArgs } from './consultasDisponibilidadQuery';

export async function responderConsultaDisponibilidad(
  invitacionId: string,
  respuesta: 'SI' | 'NO',
  preview?: ConsultaPreviewArgs,
) {
  const call = httpsCallable<
    { invitacionId: string; respuesta: 'SI' | 'NO'; asBolsaCuil?: string; asEmployeeId?: string },
    { ok: boolean; codigo?: string; motivo?: string }
  >(getPortalFirebase().functions, 'responderConsultaDisponibilidad');
  const res = await call({
    invitacionId,
    respuesta,
    ...(preview?.asBolsaCuil ? { asBolsaCuil: preview.asBolsaCuil } : {}),
    ...(preview?.asEmployeeId ? { asEmployeeId: preview.asEmployeeId } : {}),
  });
  return res.data;
}
