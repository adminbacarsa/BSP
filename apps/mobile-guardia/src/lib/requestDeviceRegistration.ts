import { addDoc, collection, serverTimestamp, type Firestore } from 'firebase/firestore';
import { getDeviceInfo } from './deviceInfo';
import { getMobilePlatform, getOrCreateDeviceId, type MobilePlatform } from './deviceId';

/**
 * Solicitud de re-vinculación cuando se pierde el deviceId (p. ej. Safari 7 días)
 * o el legajo está atado a otro dispositivo.
 *
 * No hay callable de aprobación en CC hoy: crea una novedad para RRHH/ops
 * y deja constancia en el legajo. Pedido Plataforma: flujo CC «Aprobar dispositivo».
 */
export async function requestDeviceRegistration(params: {
  db: Firestore;
  uid: string;
  empDocId: string | null;
  empresaId: string | null;
  displayName?: string | null;
}): Promise<{ ok: true; novedadId: string; deviceId: string } | { ok: false; message: string }> {
  const { db, uid, empDocId, empresaId, displayName } = params;
  try {
    const deviceId = await getOrCreateDeviceId();
    const platform: MobilePlatform = getMobilePlatform();
    const deviceInfo = getDeviceInfo();

    const ref = await addDoc(collection(db, 'novedades'), {
      type: 'DEVICE_REGISTRATION_REQUEST',
      status: 'pending',
      title: 'Solicitud de registro de dispositivo',
      description:
        platform === 'web'
          ? 'El vigilador pide vincular este navegador (PWA/web). Puede haber perdido el deviceId (Safari) o tener otro dispositivo activo.'
          : 'El vigilador pide vincular este dispositivo móvil. Hay otro celular activo o se perdió el id local.',
      employeeId: empDocId || null,
      employeeName: displayName || null,
      uid,
      empresaId: empresaId || null,
      source: 'mobile_guardia',
      platform,
      requestedDeviceId: deviceId,
      deviceInfo,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    return { ok: true, novedadId: ref.id, deviceId };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'No se pudo enviar la solicitud.';
    return { ok: false, message };
  }
}
