import { getPortalCallables } from './portal';
import { mapPortalCallableError } from './mapPortalCallableError';
import { ACUSE_NO_DISPONIBLE_MESSAGE, isCallableMissingError } from './acusarReciboContratoState';

export { ACUSE_NO_DISPONIBLE_MESSAGE, isCallableMissingError };

/**
 * Acuse de recibo del contrato (docs/EVENTUALES-DISENO.md §3.3).
 * La callable `acusarReciboContrato` está preparada del lado de la app; si el servidor
 * no la tiene todavía se informa sin romper la pantalla.
 */
export async function acusarReciboContrato(
  contratoId: string,
  deviceId?: string | null,
): Promise<{ ok: true; message: string } | { ok: false; message: string; unavailable?: boolean }> {
  const { acusarReciboContrato: callable } = getPortalCallables();
  try {
    await callable({ contratoId, metodo: 'SESION', ...(deviceId ? { deviceId } : {}) });
    return { ok: true, message: 'Acuse registrado. El contrato queda como recibido.' };
  } catch (err) {
    if (isCallableMissingError(err)) return { ok: false, unavailable: true, message: ACUSE_NO_DISPONIBLE_MESSAGE };
    return { ok: false, message: mapPortalCallableError(err) };
  }
}
